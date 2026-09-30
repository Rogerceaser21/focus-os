import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireApprovedUser } from "../_shared/approval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const gate = await requireApprovedUser(req, corsHeaders);
    if (gate instanceof Response) return gate;
    const { user } = gate;
    const authHeader = `Bearer ${gate.token}`;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { mimeType } = await req.json();

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const gcsFolder = `${user.id}/${timestamp}`;

    const { data: session, error } = await supabase
      .from("focusos_recording_sessions")
      .insert({
        user_id: user.id,
        gcs_folder_path: gcsFolder,
        mime_type: mimeType || "audio/webm",
        status: "recording",
        chunk_count: 0,
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create session: ${error.message}`);

    console.log(`Recording session created: ${session.id}, folder: ${gcsFolder}`);

    return new Response(
      JSON.stringify({ sessionId: session.id, gcsFolder }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Start recording session error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
