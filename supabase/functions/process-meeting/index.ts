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
      description: "Only key decisions, action items, and major takeaways. Ruthlessly cut fluff. Merge related points.",
    },
    standard: {
      maxSections: durationMin < 5 ? 3 : durationMin < 30 ? 5 : 6,
      bulletGuidance: "2-5 bullets per section. Include key context.",
      overviewGuidance: "2-4 sentences. Key topics, decisions, and outcomes.",
      description: "Main discussion points and conclusions with supporting context. Still no repetition.",
    },
    detailed: {
      maxSections: durationMin < 5 ? 4 : durationMin < 30 ? 6 : 8,
      bulletGuidance: "Thorough but never redundant. Include nuances and supporting arguments.",
      overviewGuidance: "3-6 sentences. Comprehensive executive summary.",
      description: "Thorough capture including nuances, disagreements, and supporting arguments. Never repeat information.",
    },
  };

  const config = levelConfig[detailLevel] || levelConfig.concise;

  return `Analyze this meeting transcript and provide a structured summary.
Detail level: ${detailLevel} — ${config.description}

CRITICAL RULES:
1. Think like an executive assistant. Extract ONLY what matters: decisions, action items, key topics.
2. Do NOT repeat information. If a point was made once, it appears once in the most relevant section only.
3. Each bullet must convey a UNIQUE piece of information. Merge similar points into one.
4. Omit filler, greetings, small talk, and tangential comments entirely.
5. Do NOT use any markdown formatting. No **bold**, no *italic*, no # headers. Plain text only.
6. Headings should be short descriptive labels (3-6 words), not full sentences.
7. Maximum ${config.maxSections} sections. ${config.bulletGuidance}
8. Overview: ${config.overviewGuidance}
9. Return ONLY valid JSON — no code blocks, no extra text.

Return JSON with this structure:
{ "overview": "string", "outline": [{ "heading": "string", "points": ["string"] }] }

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
    let cleaned = rawText
      .replace(/```json\s*/gi, "")
      .replace(/```\s*/g, "")
      .trim();

    const jsonStart = cleaned.search(/[\{\[]/);
    const jsonEnd = cleaned.lastIndexOf("}");

    if (jsonStart !== -1 && jsonEnd !== -1) {
      cleaned = cleaned.substring(jsonStart, jsonEnd + 1)
        .replace(/,\s*}/g, "}")
        .replace(/,\s*]/g, "]")
        .replace(/[\x00-\x1F\x7F]/g, "");
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

async function handleResummarize(
  supabase: any,
  meetingId: string,
  transcript: string,
  detailLevel: string,
  durationSeconds: number,
  corsHeaders: Record<string, string>
): Promise<Response> {
  const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

  let transcriptText = transcript;
  if (!transcriptText) {
    const { data: meeting, error } = await supabase
      .from("focusos_meetings")
      .select("transcript_gcs_path, duration_seconds")
      .eq("id", meetingId)
      .single();

    if (error || !meeting) throw new Error("Meeting not found");
    if (meeting.duration_seconds) durationSeconds = meeting.duration_seconds;

    if (meeting.transcript_gcs_path) {
      const gcsKeyJson = Deno.env.get("GCS_SERVICE_ACCOUNT_KEY");
      if (!gcsKeyJson) throw new Error("GCS_SERVICE_ACCOUNT_KEY not configured");
      const sa: ServiceAccount = JSON.parse(gcsKeyJson);
      const token = await getGcsAccessToken(sa);
      const gcsBucket = Deno.env.get("GCS_BUCKET_NAME")!;

      const path = meeting.transcript_gcs_path.replace(`gs://${gcsBucket}/`, "");
      const encodedPath = encodeURIComponent(path);
      const gcsResp = await fetch(
        `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodedPath}?alt=media`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (gcsResp.ok) {
        const transcriptData = await gcsResp.json();
        transcriptText = transcriptData.transcript || "";
      }
    }
  }

  if (!transcriptText) throw new Error("No transcript available to re-summarize");

  console.log(`Re-summarizing meeting ${meetingId} at detail level: ${detailLevel}`);
  const summary = await generateSummary(GEMINI_API_KEY, transcriptText, detailLevel, durationSeconds);

  const { error: updateError } = await supabase
      .from("focusos_meetings")
    .update({ summary })
    .eq("id", meetingId);

  if (updateError) throw new Error(`Failed to update meeting: ${updateError.message}`);

  return new Response(
    JSON.stringify({ summary, detailLevel }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

/* ─── Gemini File API helpers ───────────────────────────────────── */

async function uploadToGeminiFileAPI(
  apiKey: string,
  gcsToken: string,
  gcsBucket: string,
  gcsObjectPath: string,
  mimeType: string,
  displayName: string
): Promise<string> {
  // Step 1: Get file size from GCS metadata (no download)
  const encodedPath = encodeURIComponent(gcsObjectPath);
  const metaResp = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodedPath}`,
    { headers: { Authorization: `Bearer ${gcsToken}` } }
  );
  if (!metaResp.ok) {
    const err = await metaResp.text();
    throw new Error(`GCS metadata fetch failed: ${err}`);
  }
  const metadata = await metaResp.json();
  const fileSize = parseInt(metadata.size, 10);
  console.log(`File size from GCS: ${fileSize} bytes (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  // Step 2: Initiate resumable upload to Gemini File API
  const initResp = await fetch(
    `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${apiKey}`,
    {
      method: "POST",
      headers: {
        "X-Goog-Upload-Protocol": "resumable",
        "X-Goog-Upload-Command": "start",
        "X-Goog-Upload-Header-Content-Length": String(fileSize),
        "X-Goog-Upload-Header-Content-Type": mimeType,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        file: { display_name: displayName },
      }),
    }
  );

  if (!initResp.ok) {
    const err = await initResp.text();
    throw new Error(`Gemini File API init failed: ${err}`);
  }

  const uploadUrl = initResp.headers.get("X-Goog-Upload-URL");
  if (!uploadUrl) throw new Error("No upload URL returned from Gemini File API");
  console.log("Got Gemini resumable upload URL");

  // Step 3: Stream from GCS → Gemini in chunks (never buffer full file)
  const CHUNK_SIZE = 8 * 1024 * 1024; // 8MB chunks
  const downloadResp = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodedPath}?alt=media`,
    { headers: { Authorization: `Bearer ${gcsToken}` } }
  );
  if (!downloadResp.ok || !downloadResp.body) {
    throw new Error(`GCS download failed: ${await downloadResp.text()}`);
  }

  const reader = downloadResp.body.getReader();
  let uploadOffset = 0;
  let buffer = new Uint8Array(0);

  while (true) {
    const { done, value } = await reader.read();

    if (value) {
      // Append to buffer
      const newBuffer = new Uint8Array(buffer.length + value.length);
      newBuffer.set(buffer);
      newBuffer.set(value, buffer.length);
      buffer = newBuffer;
    }

    // Send chunks when we have enough data, or on final read
    while (buffer.length >= CHUNK_SIZE || (done && buffer.length > 0)) {
      const isLast = done && buffer.length <= CHUNK_SIZE;
      const chunkSize = Math.min(buffer.length, CHUNK_SIZE);
      const chunk = buffer.slice(0, chunkSize);
      buffer = buffer.slice(chunkSize);

      const command = isLast ? "upload, finalize" : "upload";

      const uploadResp = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Length": String(chunk.length),
          "X-Goog-Upload-Offset": String(uploadOffset),
          "X-Goog-Upload-Command": command,
        },
        body: chunk,
      });

      if (!uploadResp.ok) {
        const err = await uploadResp.text();
        throw new Error(`Gemini chunked upload failed at offset ${uploadOffset}: ${err}`);
      }

      uploadOffset += chunk.length;
      console.log(`Uploaded ${(uploadOffset / 1024 / 1024).toFixed(1)} MB / ${(fileSize / 1024 / 1024).toFixed(1)} MB to Gemini`);

      if (isLast) {
        // Parse the final response
        const uploadResult = await uploadResp.json();
        const fileUri = uploadResult.file?.uri;
        if (!fileUri) throw new Error("No file URI returned from Gemini File API");
        console.log(`File uploaded to Gemini: ${fileUri}, state: ${uploadResult.file?.state}`);
        return fileUri;
      } else {
        await uploadResp.text(); // consume response body
      }
    }

    if (done) break;
  }

  throw new Error("Upload loop ended without finalizing");

}

/* ─── Main handler ──────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser(token);
    if (!user) throw new Error("Unauthorized");

    // Parse request
    const body = await req.json();
    const { audioBase64, mimeType, projectId, title, durationSeconds, participants, resummarize, meetingId, detailLevel, transcript: providedTranscript, sessionId } = body;

    // ─── Re-summarize flow ───
    if (resummarize && meetingId) {
      return await handleResummarize(supabase, meetingId, providedTranscript, detailLevel || "concise", durationSeconds || 0, corsHeaders);
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const gcsKeyJson = Deno.env.get("GCS_SERVICE_ACCOUNT_KEY");
    if (!gcsKeyJson) throw new Error("GCS_SERVICE_ACCOUNT_KEY not configured");
    const serviceAccount: ServiceAccount = JSON.parse(gcsKeyJson);

    const gcsBucket = Deno.env.get("GCS_BUCKET_NAME");
    if (!gcsBucket) throw new Error("GCS_BUCKET_NAME not configured");

    const gcsToken = await getGcsAccessToken(serviceAccount);

    const participantNames = (participants || [])
      .filter((p: any) => p.name?.trim())
      .map((p: any) => p.name.trim());

    let audioGcsPath: string;
    let actualMimeType = mimeType || "audio/webm";

    // ─── Session-based chunked flow (BULLETPROOF: Gemini File API) ───
    if (sessionId) {
      console.log(`Processing session ${sessionId} (chunked upload)...`);

      // Get session info
      const { data: session, error: sessionError } = await supabase
        .from("focusos_recording_sessions")
        .select("*")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .single();

      if (sessionError || !session) throw new Error("Recording session not found");

      actualMimeType = (session.mime_type || "audio/webm").split(";")[0];

      // Mark session as processing
      await supabase
        .from("focusos_recording_sessions")
        .update({ status: "processing" })
        .eq("id", sessionId);

      // Compose chunks using GCS Compose API
      console.log(`Composing ${session.chunk_count} chunks...`);
      const composedPath = `${session.gcs_folder_path}/recording.webm`;

      let sourceObjects: string[] = [];
      for (let i = 0; i < session.chunk_count; i++) {
        const paddedIndex = String(i).padStart(5, "0");
        sourceObjects.push(`${session.gcs_folder_path}/chunks/${paddedIndex}.webm`);
      }

      // Multi-pass compose if > 32 chunks
      while (sourceObjects.length > 1) {
        const batches: string[][] = [];
        for (let i = 0; i < sourceObjects.length; i += 32) {
          batches.push(sourceObjects.slice(i, i + 32));
        }

        const newSources: string[] = [];
        for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
          const batch = batches[batchIdx];
          if (batch.length === 1) {
            newSources.push(batch[0]);
            continue;
          }

          const destName = batches.length === 1 && sourceObjects.length <= 32
            ? composedPath
            : `${session.gcs_folder_path}/composed_${batchIdx}_${Date.now()}.webm`;

          const composeBody = {
            sourceObjects: batch.map((name) => ({ name })),
            destination: { contentType: actualMimeType },
          };

          const encodedDest = encodeURIComponent(destName);
          const composeResp = await fetch(
            `https://storage.googleapis.com/storage/v1/b/${gcsBucket}/o/${encodedDest}/compose`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${gcsToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(composeBody),
            }
          );

          if (!composeResp.ok) {
            const err = await composeResp.text();
            throw new Error(`GCS compose failed: ${err}`);
          }
          await composeResp.json();
          newSources.push(destName);
        }
        sourceObjects = newSources;
      }

      const composedObjectPath = sourceObjects[0] || composedPath;
      audioGcsPath = `gs://${gcsBucket}/${composedObjectPath}`;
      console.log("Composed audio at:", audioGcsPath);

      // ─── PHASE 1: Upload to Gemini File API (streaming from GCS) ───
      console.log("Uploading composed audio to Gemini File API...");
      const geminiFileUri = await uploadToGeminiFileAPI(
        GEMINI_API_KEY,
        gcsToken,
        gcsBucket,
        composedObjectPath,
        actualMimeType,
        title || "meeting-recording"
      );

      // Create the meeting record immediately with processing_status = 'transcribing'
      const meetingTitle = title || `Meeting ${new Date().toLocaleDateString()}`;
      const { data: meeting, error: dbError } = await supabase
        .from("focusos_meetings")
        .insert({
          user_id: user.id,
          project_id: projectId || null,
          title: meetingTitle,
          duration_seconds: durationSeconds || 0,
          summary: null,
          action_items: [],
          participants: participants || [],
          recording_gcs_path: audioGcsPath,
          transcript_gcs_path: null,
          processing_status: "transcribing",
          gemini_file_uri: geminiFileUri,
        })
        .select()
        .single();

      if (dbError) throw new Error(`Failed to save meeting: ${dbError.message}`);
      console.log("Meeting created with processing_status=transcribing:", meeting.id);

      // Mark recording session done
      await supabase
        .from("recording_sessions")
        .update({ status: "done" })
        .eq("id", sessionId);

      // Return all data needed for frontend to trigger transcribe-meeting
      return new Response(
        JSON.stringify({
          id: meeting.id,
          title: meetingTitle,
          processing_status: "transcribing",
          geminiFileUri,
          mimeType: actualMimeType,
          participantNames,
          durationSeconds: durationSeconds || 0,
          gcsBucket,
          gcsFolder: session.gcs_folder_path,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ─── Legacy single-payload flow (backward compat) ───
    if (!audioBase64) throw new Error("No audio data provided");

    console.log("Step 1: Getting GCS access token...");

    console.log("Step 2: Uploading audio to GCS...");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const audioPath = `${user.id}/${timestamp}/recording.webm`;
    const audioBytes = Uint8Array.from(atob(audioBase64), (c) =>
      c.charCodeAt(0)
    );
    audioGcsPath = await uploadToGcs(
      gcsToken,
      gcsBucket,
      audioPath,
      audioBytes,
      actualMimeType
    );
    console.log("Audio uploaded:", audioGcsPath);

    console.log("Step 3: Transcribing with Gemini...");
    const transcribeBody = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: actualMimeType,
                data: audioBase64,
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
    const transcript =
      transcribeData.candidates?.[0]?.content?.parts?.[0]?.text || "";
    console.log("Transcript length:", transcript.length);

    if (!transcript) {
      throw new Error("Empty transcript returned from Gemini");
    }

    console.log("Step 4: Uploading transcript to GCS...");
    const transcriptPath = `${user.id}/${timestamp}/transcript.json`;
    const transcriptJson = JSON.stringify({ transcript, timestamp });
    const transcriptGcsPath = await uploadToGcs(
      gcsToken,
      gcsBucket,
      transcriptPath,
      transcriptJson,
      "application/json"
    );

    console.log("Step 5: Generating structured summary...");
    const summary = await generateSummary(GEMINI_API_KEY, transcript, "concise", durationSeconds || 0);
    console.log("Summary generated");

    console.log("Step 6: Saving meeting to database...");

    const { data: meeting, error: dbError } = await supabase
      .from("meetings")
      .insert({
        user_id: user.id,
        project_id: projectId || null,
        title: title || `Meeting ${new Date().toLocaleDateString()}`,
        duration_seconds: durationSeconds || 0,
        summary,
        action_items: [],
        participants: participants || [],
        recording_gcs_path: audioGcsPath,
        transcript_gcs_path: transcriptGcsPath,
        processing_status: "done",
      })
      .select()
      .single();

    if (dbError) {
      console.error("DB error:", dbError);
      throw new Error(`Failed to save meeting: ${dbError.message}`);
    }

    console.log("Meeting saved:", meeting.id);

    return new Response(
      JSON.stringify({
        id: meeting.id,
        title: meeting.title,
        summary,
        transcript,
        duration_seconds: durationSeconds,
        processing_status: "done",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Process meeting error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
