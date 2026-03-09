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

async function deleteFromGcs(token: string, gcsPath: string): Promise<void> {
  // gcsPath format: gs://bucket/path/to/file
  const match = gcsPath.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!match) {
    console.warn("Invalid GCS path:", gcsPath);
    return;
  }
  const [, bucket, objectPath] = match;
  const encodedPath = encodeURIComponent(objectPath);
  const resp = await fetch(
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodedPath}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!resp.ok && resp.status !== 404) {
    const err = await resp.text();
    console.error(`GCS delete failed for ${gcsPath}:`, err);
  } else {
    console.log(`Deleted from GCS: ${gcsPath}`);
  }
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

    const { meetingId, deleteTasks } = await req.json();
    if (!meetingId) throw new Error("meetingId is required");

    // Fetch meeting to get GCS paths
    const { data: meeting, error: meetingError } = await supabase
      .from("focusos_meetings")
      .select("*")
      .eq("id", meetingId)
      .eq("user_id", user.id)
      .single();

    if (meetingError || !meeting) {
      throw new Error("Meeting not found or unauthorized");
    }

    // Delete GCS files
    const gcsKeyJson = Deno.env.get("GCS_SERVICE_ACCOUNT_KEY");
    if (gcsKeyJson) {
      try {
        const serviceAccount: ServiceAccount = JSON.parse(gcsKeyJson);
        const gcsToken = await getGcsAccessToken(serviceAccount);

        if (meeting.recording_gcs_path) {
          await deleteFromGcs(gcsToken, meeting.recording_gcs_path);
        }
        if (meeting.transcript_gcs_path) {
          await deleteFromGcs(gcsToken, meeting.transcript_gcs_path);
        }
      } catch (gcsErr) {
        console.error("GCS cleanup error (continuing):", gcsErr);
      }
    }

    // Optionally delete associated tasks
    if (deleteTasks) {
      const { error: taskError } = await supabase
        .from("tasks")
        .delete()
        .eq("meeting_id", meetingId)
        .eq("user_id", user.id);

      if (taskError) {
        console.error("Error deleting tasks:", taskError);
      } else {
        console.log("Deleted associated tasks for meeting:", meetingId);
      }
    } else {
      // Unlink tasks from the meeting but keep them
      const { error: unlinkError } = await supabase
        .from("tasks")
        .update({ meeting_id: null })
        .eq("meeting_id", meetingId)
        .eq("user_id", user.id);

      if (unlinkError) {
        console.error("Error unlinking tasks:", unlinkError);
      }
    }

    // Delete the meeting record
    const { error: deleteError } = await supabase
      .from("meetings")
      .delete()
      .eq("id", meetingId)
      .eq("user_id", user.id);

    if (deleteError) {
      throw new Error(`Failed to delete meeting: ${deleteError.message}`);
    }

    console.log("Meeting deleted:", meetingId);

    return new Response(
      JSON.stringify({ success: true }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Delete meeting error:", error);
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
