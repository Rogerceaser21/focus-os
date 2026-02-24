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

  // Import private key
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

/* ─── Main handler ──────────────────────────────────────────────── */

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // Parse request
    const { audioBase64, mimeType, projectId, title } = await req.json();
    if (!audioBase64) throw new Error("No audio data provided");

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const gcsKeyJson = Deno.env.get("GCS_SERVICE_ACCOUNT_KEY");
    if (!gcsKeyJson) throw new Error("GCS_SERVICE_ACCOUNT_KEY not configured");
    const serviceAccount: ServiceAccount = JSON.parse(gcsKeyJson);

    // Determine GCS bucket from service account project
    const gcsBucket = `focusos-meetings`;

    console.log("Step 1: Getting GCS access token...");
    const gcsToken = await getGcsAccessToken(serviceAccount);

    // Step 2: Upload audio to GCS
    console.log("Step 2: Uploading audio to GCS...");
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const audioPath = `${user.id}/${timestamp}/recording.webm`;
    const audioBytes = Uint8Array.from(atob(audioBase64), (c) =>
      c.charCodeAt(0)
    );
    const audioGcsPath = await uploadToGcs(
      gcsToken,
      gcsBucket,
      audioPath,
      audioBytes,
      mimeType || "audio/webm"
    );
    console.log("Audio uploaded:", audioGcsPath);

    // Step 3: Transcribe with Gemini
    console.log("Step 3: Transcribing with Gemini...");
    const transcribeBody = {
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: mimeType || "audio/webm",
                data: audioBase64,
              },
            },
            {
              text: `Transcribe this audio recording of a meeting. Include speaker diarization where possible (label speakers as Speaker 1, Speaker 2, etc.). 
              
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

    // Step 4: Upload transcript to GCS
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

    // Step 5: Summarize + extract action items with Gemini
    console.log("Step 5: Generating summary and action items...");
    const summarizeBody = {
      contents: [
        {
          parts: [
            {
              text: `Analyze this meeting transcript and extract:
1. A concise summary (2-4 sentences)
2. A list of action items with assignee (if mentioned) and priority

Transcript:
${transcript}`,
            },
          ],
        },
      ],
      tools: [
        {
          functionDeclarations: [
            {
              name: "save_meeting_analysis",
              description:
                "Save the meeting summary and action items",
              parameters: {
                type: "object",
                properties: {
                  summary: {
                    type: "string",
                    description: "Concise meeting summary",
                  },
                  action_items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: {
                          type: "string",
                          description: "Action item description",
                        },
                        assignee: {
                          type: "string",
                          description:
                            "Person responsible, or 'Unassigned'",
                        },
                        priority: {
                          type: "string",
                          enum: ["low", "medium", "high"],
                        },
                      },
                      required: ["title", "priority"],
                    },
                  },
                },
                required: ["summary", "action_items"],
              },
            },
          ],
        },
      ],
      toolConfig: {
        functionCallingConfig: {
          mode: "ANY",
          allowedFunctionNames: ["save_meeting_analysis"],
        },
      },
    };

    const summarizeResp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(summarizeBody),
      }
    );

    if (!summarizeResp.ok) {
      const errText = await summarizeResp.text();
      console.error("Gemini summary error:", errText);
      throw new Error(`Summary failed: ${errText}`);
    }

    const summarizeData = await summarizeResp.json();
    const functionCall = summarizeData.candidates?.[0]?.content?.parts?.find(
      (p: any) => p.functionCall
    )?.functionCall;

    const summary = functionCall?.args?.summary || "No summary available";
    const actionItems = functionCall?.args?.action_items || [];

    console.log("Summary:", summary);
    console.log("Action items:", actionItems.length);

    // Step 6: Save to database
    console.log("Step 6: Saving meeting to database...");
    const durationSeconds = Math.round(audioBytes.length / (16000 * 2)); // rough estimate

    const { data: meeting, error: dbError } = await supabase
      .from("meetings")
      .insert({
        user_id: user.id,
        project_id: projectId || null,
        title: title || `Meeting ${new Date().toLocaleDateString()}`,
        duration_seconds: durationSeconds,
        summary,
        action_items: actionItems,
        recording_gcs_path: audioGcsPath,
        transcript_gcs_path: transcriptGcsPath,
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
        action_items: actionItems,
        transcript,
        duration_seconds: durationSeconds,
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
