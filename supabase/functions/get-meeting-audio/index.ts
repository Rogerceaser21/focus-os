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
      scope: "https://www.googleapis.com/auth/devstorage.read_only",
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { meetingId } = await req.json();
    if (!meetingId) throw new Error("meetingId is required");

    // Fetch meeting
    const { data: meeting, error } = await supabase
      .from("meetings")
      .select("recording_gcs_path, user_id")
      .eq("id", meetingId)
      .single();

    if (error || !meeting) throw new Error("Meeting not found");
    if (meeting.user_id !== user.id) throw new Error("Unauthorized");
    if (!meeting.recording_gcs_path) throw new Error("No recording available");

    // Parse GCS path
    const match = meeting.recording_gcs_path.match(/^gs:\/\/([^/]+)\/(.+)$/);
    if (!match) throw new Error("Invalid GCS path");
    const [, bucket, objectPath] = match;

    // Get GCS token
    const gcsKeyJson = Deno.env.get("GCS_SERVICE_ACCOUNT_KEY");
    if (!gcsKeyJson) throw new Error("GCS not configured");
    const serviceAccount: ServiceAccount = JSON.parse(gcsKeyJson);
    const gcsToken = await getGcsAccessToken(serviceAccount);

    // Stream audio from GCS
    const encodedPath = encodeURIComponent(objectPath);
    const gcsResp = await fetch(
      `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodedPath}?alt=media`,
      {
        headers: { Authorization: `Bearer ${gcsToken}` },
      }
    );

    if (!gcsResp.ok) {
      const err = await gcsResp.text();
      throw new Error(`GCS fetch failed: ${err}`);
    }

    // Return the audio stream with proper headers
    return new Response(gcsResp.body, {
      headers: {
        ...corsHeaders,
        "Content-Type": gcsResp.headers.get("Content-Type") || "audio/webm",
        "Content-Length": gcsResp.headers.get("Content-Length") || "",
        "Content-Disposition": `attachment; filename="meeting-recording.webm"`,
      },
    });
  } catch (error) {
    console.error("Get meeting audio error:", error);
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
