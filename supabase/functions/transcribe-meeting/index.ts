import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/* ─── GCS helpers ───────────────────────────────────────────────── */

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri: string;
}

async function getGcsAccessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = btoa(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/devstorage.read_write",
      aud: sa.token_uri,
      exp: now + 3600,
      iat: now,
    })
  );
  const unsignedToken = `${header}.${claim}`;

  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\n/g, "");
  const keyData = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(unsignedToken)
  );
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const jwt = `${unsignedToken}.${signature}`;

  const resp = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const { access_token } = await resp.json();
  return access_token;
}

async function uploadToGcs(
  token: string,
  bucket: string,
  path: string,
  data: Uint8Array | string,
  contentType: string
): Promise<string> {
  const encodedPath = encodeURIComponent(path);
  const body = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const resp = await fetch(
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodedPath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": contentType,
      },
      body,
    }
  );
  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`GCS upload failed: ${err}`);
  }
  const result = await resp.json();
  return `gs://${bucket}/${result.name}`;
}

/* ─── Summary helpers ───────────────────────────────────────────── */

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1");
}

function getSummaryPrompt(transcript: string, detailLevel: string, durationSeconds: number): string {
  const durationMin = Math.round(durationSeconds / 60);
  const levelConfig: Record<string, { maxSections: number; bulletGuidance: string; overviewGuidance: string; description: string }> = {
    concise: {
      maxSections: durationMin < 5 ? 2 : durationMin < 30 ? 3 : 5,
      bulletGuidance: "1-3 SHORT bullets per section. Only decisions and action items.",
      overviewGuidance: "1-2 sentences. What happened and what is next.",
      description: "Only key decisions, action items, and major takeaways. Ruthlessly cut fluff.",
    },
    standard: {
      maxSections: durationMin < 5 ? 3 : durationMin < 30 ? 5 : 6,
      bulletGuidance: "2-5 bullets per section. Include key context.",
      overviewGuidance: "2-4 sentences. Key topics, decisions, and outcomes.",
      description: "Main discussion points and conclusions with supporting context.",
    },
    detailed: {
      maxSections: durationMin < 5 ? 4 : durationMin < 30 ? 6 : 8,
      bulletGuidance: "Thorough but never redundant.",
      overviewGuidance: "3-6 sentences. Comprehensive executive summary.",
      description: "Thorough capture including nuances, disagreements, and supporting arguments.",
    },
  };
  const config = levelConfig[detailLevel] || levelConfig.concise;

  return `Analyze this meeting transcript and provide a structured summary.
Detail level: ${detailLevel} — ${config.description}

CRITICAL RULES:
1. Think like an executive assistant. Extract ONLY what matters.
2. Do NOT repeat information.
3. Each bullet must convey a UNIQUE piece of information.
4. Omit filler, greetings, small talk entirely.
5. Do NOT use any markdown formatting. Plain text only.
6. Headings should be short descriptive labels (3-6 words).
7. Maximum ${config.maxSections} sections. ${config.bulletGuidance}
8. Overview: ${config.overviewGuidance}
9. Return ONLY valid JSON.

Return JSON: { "overview": "string", "outline": [{ "heading": "string", "points": ["string"] }] }

Transcript:
${transcript}`;
}

function parseGeminiSummaryResponse(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText);
    if (parsed.overview) {
      parsed.overview = stripMarkdown(parsed.overview);
      if (parsed.outline) {
        parsed.outline = parsed.outline.map((s: any) => ({
          heading: stripMarkdown(s.heading || ""),
          points: (s.points || []).map((p: string) => stripMarkdown(p)),
        }));
      }
      return JSON.stringify(parsed);
    }
    return JSON.stringify({ overview: stripMarkdown(rawText), outline: [] });
  } catch {
    let cleaned = rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const jsonStart = cleaned.search(/[\{\[]/);
    const jsonEnd = cleaned.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1)
        .replace(/,\s*}/g, "}").replace(/,\s*]/g, "]").replace(/[\x00-\x1F\x7F]/g, "");
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
      } catch {
        return JSON.stringify({ overview: stripMarkdown(rawText), outline: [] });
      }
    }
    return JSON.stringify({ overview: stripMarkdown(rawText), outline: [] });
  }
}

async function generateSummary(apiKey: string, transcript: string, detailLevel: string, durationSeconds: number): Promise<string> {
  const prompt = getSummaryPrompt(transcript, detailLevel, durationSeconds);
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
  return parseGeminiSummaryResponse(rawText);
}

/* ─── Main handler ──────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Use service role key so we can update the meeting regardless of RLS
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let meetingId: string | undefined;

  try {
    const body = await req.json();
    meetingId = body.meetingId;
    const geminiFileUri: string = body.geminiFileUri;
    const mimeType: string = body.mimeType || "audio/webm";
    const participantNames: string[] = body.participantNames || [];
    const durationSeconds: number = body.durationSeconds || 0;
    const gcsBucket: string = body.gcsBucket;
    const gcsFolder: string = body.gcsFolder;

    if (!meetingId || !geminiFileUri) throw new Error("Missing meetingId or geminiFileUri");

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    // Step 1: Poll Gemini file until ACTIVE
    console.log(`Polling Gemini file status for: ${geminiFileUri}`);
    const fileNameMatch = geminiFileUri.match(/files\/([^\/]+)$/);
    const fileName = fileNameMatch ? fileNameMatch[1] : null;
    if (!fileName) throw new Error(`Cannot parse file name from URI: ${geminiFileUri}`);

    let fileState = "PROCESSING";
    let pollAttempts = 0;
    const maxPollAttempts = 60; // 5 minutes max (5s intervals)

    while (fileState === "PROCESSING" && pollAttempts < maxPollAttempts) {
      const statusResp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/files/${fileName}?key=${GEMINI_API_KEY}`
      );
      if (!statusResp.ok) {
        const err = await statusResp.text();
        throw new Error(`Failed to check file status: ${err}`);
      }
      const statusData = await statusResp.json();
      fileState = statusData.state;
      console.log(`File state: ${fileState} (attempt ${pollAttempts + 1})`);

      if (fileState === "ACTIVE") break;
      if (fileState === "FAILED") throw new Error("Gemini file processing failed");

      pollAttempts++;
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (fileState !== "ACTIVE") throw new Error("Gemini file did not become ACTIVE in time");

    // Step 2: Transcribe using file URI
    console.log("Transcribing with Gemini using file URI...");
    await supabase
      .from("focusos_meetings")
      .update({ processing_status: "transcribing" })
      .eq("id", meetingId);

    const transcribeBody = {
      contents: [
        {
          parts: [
            {
              fileData: {
                mimeType,
                fileUri: geminiFileUri,
              },
            },
            {
              text: `Transcribe this audio recording of a meeting.${
                participantNames.length > 0
                  ? ` The participants are: ${participantNames.join(", ")}. Label each speaker by their name where possible.`
                  : " Include speaker diarization where possible (label speakers as Speaker 1, Speaker 2, etc.)."
              }
              
Format the output as a clean transcript with speaker labels and timestamps where detectable. Be thorough and accurate.`,
            },
          ],
        },
      ],
    };

    // Use non-streaming call — edge function timeout is the constraint,
    // but Gemini processes the file server-side and returns the full result
    const transcribeResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(transcribeBody),
      }
    );

    if (!transcribeResp.ok) {
      const errText = await transcribeResp.text();
      console.error("Gemini transcription error:", errText);
      throw new Error(`Transcription failed: ${errText}`);
    }

    const transcribeData = await transcribeResp.json();
    const transcript = transcribeData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!transcript) throw new Error("Empty transcript returned from Gemini");
    console.log("Transcript length:", transcript.length);

    // Step 3: Upload transcript to GCS
    const gcsKeyJson = Deno.env.get("GCS_SERVICE_ACCOUNT_KEY");
    if (!gcsKeyJson) throw new Error("GCS_SERVICE_ACCOUNT_KEY not configured");
    const sa: ServiceAccount = JSON.parse(gcsKeyJson);
    const gcsToken = await getGcsAccessToken(sa);

    const transcriptPath = `${gcsFolder}/transcript.json`;
    const transcriptJson = JSON.stringify({ transcript, timestamp: new Date().toISOString() });
    const transcriptGcsPath = await uploadToGcs(gcsToken, gcsBucket, transcriptPath, transcriptJson, "application/json");

    // Step 4: Summarize
    console.log("Generating summary...");
    await supabase
      .from("focusos_meetings")
      .update({ processing_status: "summarizing" })
      .eq("id", meetingId);

    const summary = await generateSummary(GEMINI_API_KEY, transcript, "concise", durationSeconds);
    console.log("Summary generated");

    // Step 5: Save everything to meeting
    const { error: updateError } = await supabase
      .from("focusos_meetings")
      .update({
        summary,
        transcript_gcs_path: transcriptGcsPath,
        processing_status: "done",
        processing_error: null,
        gemini_file_uri: null, // Clear it
      })
      .eq("id", meetingId);

    if (updateError) throw new Error(`Failed to update meeting: ${updateError.message}`);
    console.log("Meeting fully processed:", meetingId);

    // Step 6: Cleanup - delete file from Gemini
    try {
      await fetch(
        `https://generativelanguage.googleapis.com/v1beta/files/${fileName}?key=${GEMINI_API_KEY}`,
        { method: "DELETE" }
      );
      console.log("Gemini file deleted");
    } catch (e) {
      console.warn("Failed to delete Gemini file (non-critical):", e);
    }

    return new Response(
      JSON.stringify({ success: true, meetingId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Transcribe-meeting error:", error);

    // Update meeting with error status
    if (meetingId) {
      try {
        await supabase
          .from("meetings")
          .update({
            processing_status: "error",
            processing_error: error instanceof Error ? error.message : "Unknown error",
          })
          .eq("id", meetingId);
      } catch (dbErr) {
        console.error("Failed to update meeting error status:", dbErr);
      }
    }

    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
