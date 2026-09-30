import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { requireApprovedUser } from "../_shared/approval.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const gate = await requireApprovedUser(req, corsHeaders);
    if (gate instanceof Response) return gate;
    const { user } = gate;
    const userId = user.id;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Best-effort revoke at Google
    const { data: tokenRow } = await admin
      .from("focusos_google_tokens")
      .select("refresh_token, access_token")
      .eq("user_id", userId)
      .maybeSingle();

    if (tokenRow?.refresh_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenRow.refresh_token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });
      } catch (e) {
        console.warn("revoke failed (continuing)", e);
      }
    }

    await admin.from("focusos_google_tokens").delete().eq("user_id", userId);
    await admin.from("focusos_tasks").update({ google_calendar_event_id: null })
      .eq("user_id", userId).not("google_calendar_event_id", "is", null);
    await admin.from("focusos_meetings").update({ google_calendar_event_id: null })
      .eq("user_id", userId).not("google_calendar_event_id", "is", null);

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("disconnect error", e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});