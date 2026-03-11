import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Missing authorization header");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { sessionId, chunkIndex, audioBase64 } = await req.json();
    if (!sessionId || chunkIndex === undefined || !audioBase64) {
      throw new Error("Missing sessionId, chunkIndex, or audioBase64");
    }

    // Verify session belongs to user
    const { data: session, error: sessionError } = await supabase
      .from("focusos_recording_sessions")
      .select("*")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .single();

    if (sessionError || !session) throw new Error("Session not found");
    if (session.status !== "recording") throw new Error("Session is not in recording state");

    // Upload chunk to GCS
    const gcsKeyJson = Deno.env.get("GCS_SERVICE_ACCOUNT_JSON");
    if (!gcsKeyJson) throw new Error("GCS_SERVICE_ACCOUNT_JSON not configured");
    const sa: ServiceAccount = JSON.parse(gcsKeyJson);
    const token = await getGcsAccessToken(sa);

    const gcsBucket = Deno.env.get("GCS_BUCKET_NAME");
    if (!gcsBucket) throw new Error("GCS_BUCKET_NAME not configured");

    const paddedIndex = String(chunkIndex).padStart(5, "0");
    const chunkPath = `${session.gcs_folder_path}/chunks/${paddedIndex}.webm`;

    const audioBytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
    const encodedPath = encodeURIComponent(chunkPath);

    const uploadResp = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${gcsBucket}/o?uploadType=media&name=${encodedPath}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": session.mime_type || "audio/webm",
        },
        body: audioBytes,
      }
    );

    if (!uploadResp.ok) {
      const err = await uploadResp.text();
      throw new Error(`GCS upload failed: ${err}`);
    }

    // Update chunk count
    const newCount = Math.max(session.chunk_count, chunkIndex + 1);
    await supabase
      .from("focusos_recording_sessions")
      .update({ chunk_count: newCount })
      .eq("id", sessionId);

    console.log(`Chunk ${chunkIndex} uploaded for session ${sessionId} (${audioBytes.length} bytes)`);

    return new Response(
      JSON.stringify({ success: true, chunkIndex, bytesUploaded: audioBytes.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Upload chunk error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
