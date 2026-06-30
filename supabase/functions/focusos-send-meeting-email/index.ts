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
  recordingUrl: string | null,
  logoUrl: string,
  userNote?: string
) {
  const date = new Date(meeting.created_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  const duration = meeting.duration_seconds ? `${Math.floor(meeting.duration_seconds / 60)}m ${meeting.duration_seconds % 60}s` : null;

  const outlineSections = summary.outline.map((s) => `
      <tr><td style="padding:0 0 12px;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#292119;">${escapeHtml(s.heading)}</p>
        <table cellpadding="0" cellspacing="0" width="100%">
          ${s.points.map((p) => `
          <tr><td style="padding:2px 0;">
            <table cellpadding="0" cellspacing="0"><tr>
              <td style="vertical-align:top;padding-right:8px;padding-top:7px;"><div style="width:6px;height:6px;border-radius:50%;background:#B8572E;"></div></td>
              <td style="font-size:13px;color:#6E6256;line-height:1.5;">${escapeHtml(p)}</td>
            </tr></table>
          </td></tr>`).join("")}
        </table>
      </td></tr>`).join("");

  const recordingBlock = recordingUrl ? `
  <tr><td style="padding:20px 30px 0;" align="center">
    <a href="${recordingUrl}" style="display:inline-block;padding:11px 26px;background:#FBF7F1;border:1px solid #B8572E;color:#B8572E;font-size:13px;font-weight:600;border-radius:10px;text-decoration:none;">Download recording</a>
  </td></tr>` : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#FFFFFF;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FFFFFF;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#FBF7F1;border:1px solid #E7DCCB;border-radius:16px;overflow:hidden;">
  <tr><td style="padding:30px 30px 0;">
    <table cellpadding="0" cellspacing="0" align="center"><tr>
      <td style="vertical-align:middle;padding-right:9px;"><img src="${logoUrl}" width="28" height="28" alt="" style="display:block;border:0;"></td>
      <td style="vertical-align:middle;font-size:16px;font-weight:600;color:#292119;">Focus<span style="color:#B8572E;"> OS</span></td>
    </tr></table>
    <div style="border-top:1px solid #ECE3D6;margin:18px 0 0;"></div>
  </td></tr>
  <tr><td style="padding:18px 30px 0;">
    <div style="font-size:20px;font-weight:600;color:#292119;">Meeting notes shared with you</div>
    <p style="margin:6px 0 0;font-size:14px;color:#6E6256;">${escapeHtml(senderName)} shared meeting notes with you</p>
  </td></tr>
  <tr><td style="padding:18px 30px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3ECE0;border:1px solid #E7DCCB;border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#292119;">${escapeHtml(meeting.title)}</p>
        <span style="font-size:12px;color:#9C9082;">${date}</span>${duration ? `<span style="font-size:12px;color:#9C9082;"> &nbsp;&middot;&nbsp; ${duration}</span>` : ""}
      </td></tr>
    </table>
  </td></tr>
  ${userNote ? `
  <tr><td style="padding:14px 30px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FFF9F0;border:1px solid #E7DCCB;border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0;font-size:14px;color:#4A4138;line-height:1.6;white-space:pre-wrap;">${escapeHtml(userNote)}</p>
      </td></tr>
    </table>
  </td></tr>` : ""}
  ${summary.overview ? `
  <tr><td style="padding:14px 30px 0;">
    <p style="margin:0 0 8px;font-size:11px;font-weight:600;color:#9C9082;text-transform:uppercase;letter-spacing:0.5px;">Overview</p>
    <p style="margin:0;font-size:14px;color:#4A4138;line-height:1.6;">${escapeHtml(summary.overview)}</p>
  </td></tr>` : ""}
  ${summary.outline.length > 0 ? `
  <tr><td style="padding:18px 30px 0;">
    <p style="margin:0 0 12px;font-size:11px;font-weight:600;color:#9C9082;text-transform:uppercase;letter-spacing:0.5px;">Outline</p>
    <table cellpadding="0" cellspacing="0" width="100%">${outlineSections}</table>
  </td></tr>` : ""}
  ${recordingBlock}
  <tr><td style="padding:24px 30px;">
    <div style="border-top:1px solid #ECE3D6;padding-top:14px;"><p style="margin:0;font-size:11px;color:#9C9082;text-align:center;">Sent via Focus OS</p></div>
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

    const { meetingId, recipientEmail, includeRecordingLink, userNote } = await req.json();

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
      recordingUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/focusos-get-shared-meeting-audio?token=${meeting.share_token}`;
    }

    const resend = new Resend(RESEND_API_KEY);

    const { error: emailError } = await resend.emails.send({
      from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
      to: [recipientEmail],
      subject: `Meeting Notes: ${meeting.title}`,
      html: buildMeetingEmailHtml(meeting, summary, senderName, recordingUrl, "https://focusos.tech/brand/focusos-email-logo.png"),
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
