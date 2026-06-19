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

// Compute free intervals = working window minus busy blocks
function computeFree(
  windowStart: Date,
  windowEnd: Date,
  busy: { start: Date; end: Date }[],
): { start: Date; end: Date }[] {
  const sorted = [...busy]
    .map((b) => ({
      start: new Date(Math.max(b.start.getTime(), windowStart.getTime())),
      end: new Date(Math.min(b.end.getTime(), windowEnd.getTime())),
    }))
    .filter((b) => b.end > b.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  // Merge overlapping
  const merged: { start: Date; end: Date }[] = [];
  for (const b of sorted) {
    const last = merged[merged.length - 1];
    if (last && b.start <= last.end) {
      if (b.end > last.end) last.end = b.end;
    } else {
      merged.push({ ...b });
    }
  }

  const free: { start: Date; end: Date }[] = [];
  let cursor = windowStart;
  for (const b of merged) {
    if (b.start > cursor) free.push({ start: cursor, end: b.start });
    if (b.end > cursor) cursor = b.end;
  }
  if (cursor < windowEnd) free.push({ start: cursor, end: windowEnd });
  return free;
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

    const body = await req.json();
    const {
      targetUserId,
      date,
      timeZone,
      durationMinutes = 30,
      workdayStartHour = 8,
      workdayEndHour = 20,
    }: {
      targetUserId?: string;
      date: string;
      timeZone: string;
      durationMinutes?: number;
      workdayStartHour?: number;
      workdayEndHour?: number;
    } = body ?? {};

    if (!date || !timeZone) {
      return new Response(JSON.stringify({ error: "date and timeZone are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const tgt = targetUserId ?? callerId;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Resolve the calendar ID we'll query:
    //   - self: "primary" via the caller's own token
    //   - other: the target's email, queried with the CALLER's token so
    //     Google Workspace sharing rules decide visibility (just like
    //     calendar.google.com does).
    let calendarId = "primary";
    if (tgt !== callerId) {
      const { data: targetProfile } = await admin
        .from("focusos_profiles")
        .select("user_email")
        .eq("user_id", tgt)
        .maybeSingle();
      if (!targetProfile?.user_email) {
        return new Response(JSON.stringify({ connected: false, reason: "no_email" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      calendarId = targetProfile.user_email;
    }

    // Always use the CALLER's Google token.
    const { data: callerTokenRow } = await admin
      .from("focusos_google_tokens").select("*")
      .eq("user_id", callerId).maybeSingle();
    if (!callerTokenRow) {
      return new Response(JSON.stringify({ connected: false, reason: "caller_not_connected" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const accessToken = await refreshIfNeeded(admin, callerTokenRow as TokenRow);

    // Build day window in target timezone. Use UTC instants spanning the day in tz.
    // Simpler: query the entire 36-hour span around the date and trim later in tz.
    const [yy, mm, dd] = date.split("-").map(Number);
    // Approximate window: start = date 00:00 UTC - 12h, end = next day 00:00 UTC + 12h
    const dayStartUtc = new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0));
    const timeMin = new Date(dayStartUtc.getTime() - 12 * 3600 * 1000).toISOString();
    const timeMax = new Date(dayStartUtc.getTime() + 36 * 3600 * 1000).toISOString();

    const fbRes = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        timeMin,
        timeMax,
        timeZone,
        items: [{ id: calendarId }],
      }),
    });
    const fbJson = await fbRes.json();
    if (!fbRes.ok) throw new Error(`freeBusy failed: ${JSON.stringify(fbJson)}`);

    const calBlock = fbJson.calendars?.[calendarId];
    // Workspace sharing denial / unknown calendar surfaces in `errors`
    if (calBlock?.errors?.length) {
      const reason = calBlock.errors[0]?.reason || "not_visible";
      return new Response(JSON.stringify({ connected: false, reason }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const rawBusy: { start: string; end: string }[] = calBlock?.busy ?? [];

    // Compute the working window in the target timezone for the requested date.
    // Use Intl to figure out the UTC offset for noon on that day in tz.
    const noonUtc = new Date(Date.UTC(yy, mm - 1, dd, 12, 0, 0));
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
    });
    const parts = dtf.formatToParts(noonUtc).reduce<Record<string, string>>((acc, p) => {
      if (p.type !== "literal") acc[p.type] = p.value; return acc;
    }, {});
    // local clock time at this UTC instant, in tz
    const localHour = Number(parts.hour);
    const offsetHours = 12 - localHour; // UTC = local + offsetHours

    const windowStart = new Date(Date.UTC(yy, mm - 1, dd, workdayStartHour + offsetHours, 0, 0));
    const windowEnd = new Date(Date.UTC(yy, mm - 1, dd, workdayEndHour + offsetHours, 0, 0));

    const busy = rawBusy
      .map((b) => ({ start: new Date(b.start), end: new Date(b.end) }))
      .filter((b) => b.end > windowStart && b.start < windowEnd);

    const free = computeFree(windowStart, windowEnd, busy);
    const suggested = free.filter(
      (f) => (f.end.getTime() - f.start.getTime()) / 60_000 >= durationMinutes,
    );

    // Privacy: don't include event titles for cross-user lookups
    const isSelf = tgt === callerId;

    return new Response(JSON.stringify({
      connected: true,
      date,
      timeZone,
      workdayStartHour,
      workdayEndHour,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      busy: busy.map((b) => ({
        start: b.start.toISOString(),
        end: b.end.toISOString(),
        summary: isSelf ? undefined : undefined, // freeBusy doesn't return titles
      })),
      free: free.map((f) => ({
        start: f.start.toISOString(),
        end: f.end.toISOString(),
        durationMinutes: Math.round((f.end.getTime() - f.start.getTime()) / 60_000),
      })),
      suggested: suggested.map((f) => ({
        start: f.start.toISOString(),
        end: f.end.toISOString(),
        durationMinutes: Math.round((f.end.getTime() - f.start.getTime()) / 60_000),
      })),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("freebusy error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});