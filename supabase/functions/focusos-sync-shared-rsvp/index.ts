import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  focusos_calendar_id: string | null;
};

async function refreshIfNeeded(admin: any, row: TokenRow): Promise<string> {
  const exp = new Date(row.expires_at).getTime();
  if (exp - Date.now() > 60_000) return row.access_token;
  const clientId = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID")!;
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET")!;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: row.refresh_token,
    }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`refresh failed: ${json.error_description || res.status}`);
  const newAccess: string = json.access_token;
  const expiresAt = new Date(Date.now() + (json.expires_in ?? 3600) * 1000).toISOString();
  await admin.from("focusos_google_tokens").update({
    access_token: newAccess,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq("user_id", row.user_id);
  return newAccess;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: claimsErr } = await userClient.auth.getClaims(token);
    if (claimsErr || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerId = claimsData.claims.sub as string;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tokenRow } = await admin
      .from("focusos_google_tokens").select("*")
      .eq("user_id", callerId).maybeSingle();
    if (!tokenRow || !(tokenRow as TokenRow).focusos_calendar_id) {
      return new Response(JSON.stringify({ updated: 0, skipped: "no_google_connection" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const accessToken = await refreshIfNeeded(admin, tokenRow as TokenRow);
    const calendarId = (tokenRow as TokenRow).focusos_calendar_id!;

    const { data: rows } = await admin
      .from("focusos_shared_items")
      .select("id, item_id, recipient_email")
      .eq("sender_user_id", callerId)
      .eq("status", "pending")
      .eq("item_type", "task");

    let updated = 0;
    let checked = 0;
    for (const row of rows ?? []) {
      try {
        const { data: task } = await admin
          .from("focusos_tasks")
          .select("google_calendar_event_id")
          .eq("id", row.item_id)
          .eq("user_id", callerId)
          .maybeSingle();
        const eventId = task?.google_calendar_event_id;
        if (!eventId) continue;
        checked += 1;
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!res.ok) continue;
        const evt = await res.json();
        const target = (row.recipient_email ?? "").toLowerCase();
        const attendee = (evt.attendees ?? []).find(
          (a: any) => (a.email ?? "").toLowerCase() === target,
        );
        const rs = attendee?.responseStatus;
        let newStatus: string | null = null;
        if (rs === "accepted") newStatus = "accepted";
        else if (rs === "declined") newStatus = "declined";
        if (!newStatus) continue;
        const { error: upErr } = await admin
          .from("focusos_shared_items")
          .update({ status: newStatus })
          .eq("id", row.id);
        if (!upErr) updated += 1;
      } catch (e: any) {
        console.error("rsvp sync row error", row.id, e?.message);
      }
    }

    return new Response(JSON.stringify({ ok: true, updated, checked }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("sync-shared-rsvp error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});