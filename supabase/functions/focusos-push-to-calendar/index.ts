import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APP_URL = Deno.env.get("APP_BASE_URL") ?? "https://focusos.tech";

type TokenRow = {
  user_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: string;
  focusos_calendar_id: string | null;
};

type CalendarPlacement = {
  allDay: boolean;
  date?: string;
  startDateTime?: string;
  endDateTime?: string;
  timeZone?: string;
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

async function getOrCreateFocusosCalendar(admin: any, row: TokenRow, accessToken: string): Promise<string> {
  if (row.focusos_calendar_id) return row.focusos_calendar_id;
  // Try to find one named "Focus OS"
  const listRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const listJson = await listRes.json();
  let calId: string | undefined = (listJson.items ?? []).find((c: any) => c.summary === "Focus OS")?.id;
  if (!calId) {
    const createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Focus OS", description: "Synced from Focus OS", timeZone: "UTC" }),
    });
    const createJson = await createRes.json();
    if (!createRes.ok) throw new Error(`calendar create failed: ${JSON.stringify(createJson)}`);
    calId = createJson.id;
  }
  await admin.from("focusos_google_tokens").update({ focusos_calendar_id: calId }).eq("user_id", row.user_id);
  return calId!;
}

function taskToEvent(task: any, attendees?: string[], placement?: CalendarPlacement, overrides?: { title?: string; description?: string }) {
  const description = [
    overrides?.description ?? task.description ?? "",
    "",
    `— Open in Focus OS: ${APP_URL}/app`,
  ].join("\n");

  if (placement) {
    if (placement.allDay) {
      if (!placement.date) throw new Error("Calendar date is required");
      const [yyyy, mm, dd] = placement.date.split("-").map(Number);
      const next = new Date(Date.UTC(yyyy, mm - 1, dd + 1));
      const nextDate = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
      return {
        summary: overrides?.title ?? task.title,
        description,
        start: { date: placement.date },
        end: { date: nextDate },
        attendees: attendees?.map((email) => ({ email })),
      };
    }
    if (!placement.startDateTime || !placement.endDateTime) throw new Error("Calendar start and end times are required");
    return {
      summary: overrides?.title ?? task.title,
      description,
      start: { dateTime: placement.startDateTime, timeZone: placement.timeZone },
      end: { dateTime: placement.endDateTime, timeZone: placement.timeZone },
      attendees: attendees?.map((email) => ({ email })),
    };
  }

  // Timed if start_date+end_date present, else all-day on due_date.
  if (task.start_date && task.end_date) {
    return {
      summary: overrides?.title ?? task.title,
      description,
      start: { dateTime: new Date(task.start_date).toISOString() },
      end: { dateTime: new Date(task.end_date).toISOString() },
      attendees: attendees?.map((email) => ({ email })),
    };
  }
  const day = task.due_date ? new Date(task.due_date) : new Date();
  const yyyy = day.getUTCFullYear();
  const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(day.getUTCDate()).padStart(2, "0");
  const next = new Date(Date.UTC(yyyy, day.getUTCMonth(), day.getUTCDate() + 1));
  const nyyyy = next.getUTCFullYear();
  const nmm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const ndd = String(next.getUTCDate()).padStart(2, "0");
  return {
    summary: overrides?.title ?? task.title,
    description,
    start: { date: `${yyyy}-${mm}-${dd}` },
    end: { date: `${nyyyy}-${nmm}-${ndd}` },
    attendees: attendees?.map((email) => ({ email })),
  };
}

function meetingToEvent(meeting: any, attendees?: string[]) {
  const durationSec = meeting.duration_seconds ?? 30 * 60;
  const end = new Date(meeting.created_at);
  const start = new Date(end.getTime() - durationSec * 1000);
  return {
    summary: meeting.title || "Meeting",
    description: [
      meeting.summary ?? "",
      "",
      `— Open in Focus OS: ${APP_URL}/meetings/${meeting.id}`,
    ].join("\n"),
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    attendees: attendees?.map((email) => ({ email })),
  };
}

async function gcalRequest(method: string, url: string, accessToken: string, body?: any) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google API ${res.status}: ${JSON.stringify(json)}`);
  return json;
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
      taskIds = [],
      meetingIds = [],
      action = "sync",
      attendees = [],
      sendInvites = false,
      recipientUserId,
      calendarPlacement,
      title,
      description,
    }: {
      taskIds?: string[];
      meetingIds?: string[];
      action?: "sync" | "unsync";
      attendees?: string[];
      sendInvites?: boolean;
      recipientUserId?: string;
      calendarPlacement?: CalendarPlacement;
      title?: string;
      description?: string;
    } = body ?? {};

    if (taskIds.length === 0 && meetingIds.length === 0) {
      return new Response(JSON.stringify({ error: "Provide taskIds or meetingIds" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "sync" && taskIds.length === 1 && meetingIds.length === 0 && calendarPlacement) {
      if (calendarPlacement.allDay && !calendarPlacement.date) {
        return new Response(JSON.stringify({ error: "Calendar date is required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (!calendarPlacement.allDay && (!calendarPlacement.startDateTime || !calendarPlacement.endDateTime)) {
        return new Response(JSON.stringify({ error: "Calendar start and end times are required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Determine whose calendar we're targeting
    const targetUserId = recipientUserId ?? callerId;

    // Load tokens for target user
    const { data: tokenRow, error: tokErr } = await admin
      .from("focusos_google_tokens").select("*")
      .eq("user_id", targetUserId).maybeSingle();
    if (tokErr || !tokenRow) {
      return new Response(JSON.stringify({
        error: recipientUserId
          ? "Recipient has not connected Google Calendar"
          : "Connect Google Calendar in Settings first",
      }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // If pushing to a recipient, ensure caller has shared at least one of these items with them
    if (recipientUserId && recipientUserId !== callerId) {
      const { data: shared } = await admin
        .from("focusos_shared_items")
        .select("id")
        .eq("sender_user_id", callerId)
        .eq("recipient_user_id", recipientUserId)
        .eq("status", "accepted")
        .limit(1);
      if (!shared || shared.length === 0) {
        return new Response(JSON.stringify({ error: "Not authorized to push to this user" }), {
          status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const accessToken = await refreshIfNeeded(admin, tokenRow as TokenRow);
    const calendarId = await getOrCreateFocusosCalendar(admin, tokenRow as TokenRow, accessToken);

    const sendUpdates = sendInvites ? "all" : "none";
    const results: any[] = [];

    // Tasks
    if (taskIds.length > 0) {
      const { data: tasks } = await admin
        .from("focusos_tasks").select("*")
        .in("id", taskIds).eq("user_id", callerId);
      for (const t of (tasks ?? [])) {
        try {
          if (action === "unsync") {
            if (t.google_calendar_event_id) {
              await gcalRequest("DELETE",
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${t.google_calendar_event_id}?sendUpdates=${sendUpdates}`,
                accessToken);
            }
            await admin.from("focusos_tasks").update({ google_calendar_event_id: null }).eq("id", t.id);
            results.push({ taskId: t.id, ok: true, action: "unsync" });
          } else {
            const evt = taskToEvent(t, attendees, calendarPlacement, { title, description });
            if (t.google_calendar_event_id) {
              await gcalRequest("PATCH",
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${t.google_calendar_event_id}?sendUpdates=${sendUpdates}`,
                accessToken, evt);
              results.push({ taskId: t.id, ok: true, action: "patch" });
            } else {
              const created = await gcalRequest("POST",
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`,
                accessToken, evt);
              await admin.from("focusos_tasks").update({ google_calendar_event_id: created.id }).eq("id", t.id);
              results.push({ taskId: t.id, ok: true, action: "insert", eventId: created.id });
            }
          }
        } catch (e: any) {
          console.error("task push error", t.id, e?.message);
          results.push({ taskId: t.id, ok: false, error: e?.message });
        }
      }
    }

    // Meetings
    if (meetingIds.length > 0) {
      const { data: meetings } = await admin
        .from("focusos_meetings").select("*")
        .in("id", meetingIds).eq("user_id", callerId);
      for (const m of (meetings ?? [])) {
        try {
          if (action === "unsync") {
            if (m.google_calendar_event_id) {
              await gcalRequest("DELETE",
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${m.google_calendar_event_id}?sendUpdates=${sendUpdates}`,
                accessToken);
            }
            await admin.from("focusos_meetings").update({ google_calendar_event_id: null }).eq("id", m.id);
            results.push({ meetingId: m.id, ok: true, action: "unsync" });
          } else {
            const evt = meetingToEvent(m, attendees);
            if (m.google_calendar_event_id) {
              await gcalRequest("PATCH",
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${m.google_calendar_event_id}?sendUpdates=${sendUpdates}`,
                accessToken, evt);
              results.push({ meetingId: m.id, ok: true, action: "patch" });
            } else {
              const created = await gcalRequest("POST",
                `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=${sendUpdates}`,
                accessToken, evt);
              await admin.from("focusos_meetings").update({ google_calendar_event_id: created.id }).eq("id", m.id);
              results.push({ meetingId: m.id, ok: true, action: "insert", eventId: created.id });
            }
          }
        } catch (e: any) {
          console.error("meeting push error", m.id, e?.message);
          results.push({ meetingId: m.id, ok: false, error: e?.message });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("push-to-calendar error", e);
    return new Response(JSON.stringify({ error: e?.message ?? String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});