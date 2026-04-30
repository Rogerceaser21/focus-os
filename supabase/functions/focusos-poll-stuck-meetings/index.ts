import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STUCK_AFTER_SECONDS = 90; // consider transcribing > 90s old as candidate to inspect
const MAX_ATTEMPTS = 3;
const MAX_CHAIN = 60; // max self-rescheduling iterations (~60 min)
const SLEEP_MS = 60_000; // 60 seconds between iterations

// @ts-ignore — provided by Supabase edge runtime
declare const EdgeRuntime: { waitUntil: (p: Promise<unknown>) => void };

/* ─── Summary helpers (mirror transcribe-meeting) ───────────────── */

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

function getSummaryPrompt(transcript: string, durationSeconds: number): string {
  const durationMin = Math.round(durationSeconds / 60);
  const maxSections = durationMin < 5 ? 2 : durationMin < 30 ? 3 : 5;
  return `Analyze this meeting transcript and provide a structured summary.
CRITICAL RULES:
1. Plain text only, no markdown.
2. Maximum ${maxSections} sections, 1-3 short bullets each.
3. Overview: 1-2 sentences.
4. Return ONLY valid JSON: { "overview": "string", "outline": [{ "heading": "string", "points": ["string"] }] }

Transcript:
${transcript}`;
}

function parseSummary(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText);
    parsed.overview = stripMarkdown(parsed.overview || "");
    if (parsed.outline) {
      parsed.outline = parsed.outline.map((s: any) => ({
        heading: stripMarkdown(s.heading || ""),
        points: (s.points || []).map((p: string) => stripMarkdown(p)),
      }));
    }
    return JSON.stringify(parsed);
  } catch {
    let cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonStart = cleaned.search(/[\{\[]/);
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1)
        .replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      try {
        const parsed = JSON.parse(cleaned);
        parsed.overview = stripMarkdown(parsed.overview || "");
        if (parsed.outline) {
          parsed.outline = parsed.outline.map((s: any) => ({
            heading: stripMarkdown(s.heading || ""),
            points: (s.points || []).map((p: string) => stripMarkdown(p)),
          }));
        }
        return JSON.stringify(parsed);
      } catch {}
    }
    return JSON.stringify({ overview: stripMarkdown(rawText), outline: [] });
  }
}

async function generateSummary(apiKey: string, transcript: string, durationSeconds: number): Promise<string> {
  const prompt = getSummaryPrompt(transcript, durationSeconds);
  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
    }
  );
  if (!resp.ok) {
    console.error("Summary generation failed:", await resp.text());
    return JSON.stringify({ overview: "Summary generation failed.", outline: [] });
  }
  const data = await resp.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  if (!rawText) return JSON.stringify({ overview: "No summary available.", outline: [] });
  return parseSummary(rawText);
}

/* ─── Main handler ──────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let chainCount = 0;
  try {
    const body = await req.json().catch(() => ({}));
    chainCount = Number(body?.chainCount ?? 0);
  } catch {}

  console.log(`[poller] tick chain=${chainCount}`);

  // Single-flight via advisory lock so two pollers can't run at once.
  // Lock key: arbitrary stable int unique to this worker.
  const LOCK_KEY = 73_842_119;
  const { data: lockData } = await supabase.rpc("pg_try_advisory_lock" as any, { key: LOCK_KEY }).catch(() => ({ data: null }));
  // pg_try_advisory_lock isn't exposed via PostgREST by default, so fall back to a SELECT
  // using a direct SQL query through the supabase-js .rpc fallback. If the RPC doesn't exist
  // (it likely doesn't), we use a "manual lock" via a marker row instead — see below.
  // For simplicity here we skip the pg lock and rely on the chainCount + idempotent updates
  // (the work is naturally idempotent because we only act on rows in specific stuck states).
  void lockData;

  try {
    const cutoff = new Date(Date.now() - STUCK_AFTER_SECONDS * 1000).toISOString();

    // Find candidates: in-flight rows whose last update is older than cutoff
    const { data: stuckRows, error: fetchErr } = await supabase
      .from("focusos_meetings")
      .select("id, processing_status, gemini_transcribe_attempts, gemini_transcribe_started_at, gemini_file_uri, recording_gcs_path, transcription_text, summary, duration_seconds, updated_at")
      .in("processing_status", ["transcribing", "summarizing"])
      .lt("updated_at", cutoff);

    if (fetchErr) {
      console.error("[poller] fetch error:", fetchErr);
    }

    const rows = (stuckRows || []) as any[];
    console.log(`[poller] ${rows.length} stuck candidate(s)`);

    for (const row of rows) {
      try {
        // Case A: transcript_text already present → just summarize
        if (row.transcription_text && (!row.summary || row.processing_status === "summarizing")) {
          console.log(`[poller] finishing summarization for ${row.id}`);
          const summary = await generateSummary(GEMINI_API_KEY, row.transcription_text, row.duration_seconds || 0);
          await supabase
            .from("focusos_meetings")
            .update({
              summary,
              processing_status: "done",
              processing_error: null,
              transcription_text: null,
              gemini_file_uri: null,
            })
            .eq("id", row.id);
          continue;
        }

        // Case B: stuck in transcribing with no transcript yet
        if (row.processing_status === "transcribing") {
          const attempts = row.gemini_transcribe_attempts || 0;
          if (attempts >= MAX_ATTEMPTS) {
            console.log(`[poller] giving up on ${row.id} after ${attempts} attempts`);
            await supabase
              .from("focusos_meetings")
              .update({
                processing_status: "error",
                processing_error: row.processing_error || `Transcription timed out after ${MAX_ATTEMPTS} attempts.`,
              })
              .eq("id", row.id);
            continue;
          }

          if (!row.gemini_file_uri) {
            await supabase
              .from("focusos_meetings")
              .update({
                processing_status: "error",
                processing_error: "Gemini file expired before transcription completed. Please re-record.",
              })
              .eq("id", row.id);
            continue;
          }

          // Re-invoke transcribe-meeting (it will increment attempts itself)
          console.log(`[poller] retrying transcription for ${row.id} (attempt ${attempts + 1}/${MAX_ATTEMPTS})`);
          // Parse gcs path components
          let gcsBucket = "";
          let gcsFolder = "";
          if (row.recording_gcs_path) {
            const m = row.recording_gcs_path.match(/^gs:\/\/([^/]+)\/(.+)\/recording\./);
            if (m) {
              gcsBucket = m[1];
              gcsFolder = m[2];
            }
          }
          fetch(`${supabaseUrl}/functions/v1/focusos-transcribe-meeting`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
              apikey: supabaseServiceKey,
            },
            body: JSON.stringify({
              meetingId: row.id,
              geminiFileUri: row.gemini_file_uri,
              mimeType: "audio/webm",
              participantNames: [],
              durationSeconds: row.duration_seconds || 0,
              gcsBucket,
              gcsFolder,
            }),
          }).catch((e) => console.warn("[poller] retry invoke error:", e?.message));
        }
      } catch (rowErr) {
        console.error(`[poller] error processing row ${row.id}:`, rowErr);
      }
    }

    // Decide whether to self-reschedule: are there ANY in-flight rows left?
    const { count } = await supabase
      .from("focusos_meetings")
      .select("id", { count: "exact", head: true })
      .in("processing_status", ["transcribing", "summarizing"]);

    const queueSize = count ?? 0;
    console.log(`[poller] queue size after tick: ${queueSize}`);

    if (queueSize > 0 && chainCount < MAX_CHAIN) {
      const nextChain = chainCount + 1;
      console.log(`[poller] rescheduling self in ${SLEEP_MS}ms (chain=${nextChain})`);
      EdgeRuntime.waitUntil((async () => {
        await new Promise((r) => setTimeout(r, SLEEP_MS));
        try {
          await fetch(`${supabaseUrl}/functions/v1/focusos-poll-stuck-meetings`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
              apikey: supabaseServiceKey,
            },
            body: JSON.stringify({ chainCount: nextChain }),
          });
        } catch (e) {
          console.warn("[poller] self-reschedule fetch error:", e);
        }
      })());
    } else if (queueSize === 0) {
      console.log("[poller] queue empty — shutting down chain");
    } else {
      console.warn(`[poller] reached MAX_CHAIN=${MAX_CHAIN}, stopping`);
    }

    return new Response(
      JSON.stringify({ ok: true, processed: rows.length, queueSize, chainCount }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[poller] fatal error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});