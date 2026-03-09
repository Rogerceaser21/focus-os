import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "resend";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMeetingEmailHtml(
  meeting: any,
  summary: { overview: string; outline: { heading: string; points: string[] }[] },
  senderName: string,
  recordingUrl: string | null
) {
  const date = new Date(meeting.created_at).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
  });
  const duration = meeting.duration_seconds
    ? `${Math.floor(meeting.duration_seconds / 60)}m ${meeting.duration_seconds % 60}s`
    : null;

  const outlineSections = summary.outline
    .map(
      (s) => `
      <tr><td style="padding:0 0 12px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#f0f0f0;">${escapeHtml(s.heading)}</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${s.points
            .map(
              (p) => `
          <tr><td style="padding:2px 0 2px 0;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:top;padding-right:8px;padding-top:7px;">
                <div style="width:6px;height:6px;border-radius:50%;background:#0ea5e9;"></div>
              </td>
              <td style="font-size:13px;color:#9ca3af;line-height:1.5;">${escapeHtml(p)}</td>
            </tr></table>
          </td></tr>`
            )
            .join("")}
        </table>
      </td></tr>`
    )
    .join("");

  const recordingBlock = recordingUrl
    ? `
  <tr><td style="padding:20px 0 0;">
    <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
      <a href="${recordingUrl}" style="display:inline-block;padding:10px 24px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:#9ca3af;font-size:13px;border-radius:8px;text-decoration:none;">
        🎙️ Download Recording
      </a>
    </td></tr></table>
  </td></tr>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0e1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e1117;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

  <!-- Header -->
  <tr><td style="padding-bottom:20px;">
    <h1 style="margin:0;font-size:20px;color:#f0f0f0;">📋 Meeting Summary</h1>
    <p style="margin:6px 0 0;font-size:14px;color:#9ca3af;">${escapeHtml(senderName)} shared meeting notes with you</p>
  </td></tr>

  <!-- Meeting Title Card -->
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(30,35,50,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <tr><td style="padding:20px;">
        <h2 style="margin:0 0 8px;font-size:17px;color:#f0f0f0;">${escapeHtml(meeting.title)}</h2>
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:16px;">
            <span style="font-size:12px;color:#6b7280;">📅 ${date}</span>
          </td>
          ${duration ? `<td><span style="font-size:12px;color:#6b7280;">⏱️ ${duration}</span></td>` : ""}
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- Overview -->
  ${summary.overview ? `
  <tr><td style="padding-top:20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(30,35,50,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
      <tr><td style="padding:20px;">
        <p style="margin:0 0 10px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Overview</p>
        <p style="margin:0;font-size:14px;color:#d1d5db;line-height:1.6;">${escapeHtml(summary.overview)}</p>
      </td></tr>
    </table>
  </td></tr>` : ""}

  <!-- Outline -->
  ${summary.outline.length > 0 ? `
  <tr><td style="padding-top:20px;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(30,35,50,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:12px;">
      <tr><td style="padding:20px;">
        <p style="margin:0 0 14px;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Outline</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${outlineSections}
        </table>
      </td></tr>
    </table>
  </td></tr>` : ""}

  <!-- Recording Link -->
  ${recordingBlock}

  <!-- Footer -->
  <tr><td style="padding-top:24px;border-top:1px solid rgba(255,255,255,0.06);margin-top:24px;">
    <p style="margin:16px 0 0;font-size:11px;color:#6b7280;text-align:center;">
      Sent via Focus OS
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) throw new Error("RESEND_API_KEY not configured");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get sender name
    let senderName = user.email || "Someone";
    const { data: profile } = await supabase
      .from("focusos_profiles")
      .select("first_name, last_name")
      .eq("user_id", user.id)
      .single();
    if (profile?.first_name || profile?.last_name) {
      senderName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
    }

    const { meetingId, recipientEmail, includeRecordingLink } = await req.json();

    if (!meetingId || !recipientEmail) {
      return new Response(JSON.stringify({ error: "meetingId and recipientEmail required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch meeting
    const { data: meeting, error: meetingError } = await supabase
      .from("focusos_meetings")
      .select("*")
      .eq("id", meetingId)
      .eq("user_id", user.id)
      .single();

    if (meetingError || !meeting) {
      return new Response(JSON.stringify({ error: "Meeting not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse summary
    let summary = { overview: "", outline: [] as { heading: string; points: string[] }[] };
    if (meeting.summary) {
      try {
        const parsed = JSON.parse(meeting.summary);
        if (parsed.overview || parsed.outline) {
          summary = {
            overview: parsed.overview || "",
            outline: (parsed.outline || []).map((s: any) => ({
              heading: s.heading || "",
              points: s.points || [],
            })),
          };
        }
      } catch {
        summary.overview = meeting.summary;
      }
    }

    // Build recording URL if requested
    let recordingUrl: string | null = null;
    if (includeRecordingLink && meeting.recording_gcs_path && meeting.share_token) {
      recordingUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/get-shared-meeting-audio?token=${meeting.share_token}`;
    }

    const resend = new Resend(RESEND_API_KEY);

    const { error: emailError } = await resend.emails.send({
      from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
      to: [recipientEmail],
      subject: `Meeting Notes: ${meeting.title}`,
      html: buildMeetingEmailHtml(meeting, summary, senderName, recordingUrl),
    });

    if (emailError) {
      console.error("Resend error:", emailError);
      throw new Error(`Email send failed: ${emailError.message}`);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in send-meeting-email:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
