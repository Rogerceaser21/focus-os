import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function buildTaskEmailHtml(
  task: any,
  completeUrl: string,
  senderName: string,
  logoUrl: string,
  appUrl: string
) {
  const priorityColors: Record<string, [string, string]> = {
    urgent: ["#81313F", "#ffffff"],
    high: ["#B8572E", "#ffffff"],
    medium: ["#E0C26A", "#292119"],
    low: ["#67883A", "#ffffff"],
  };
  const statusColors: Record<string, [string, string]> = {
    todo: ["#E7DECF", "#292119"],
    in_progress: ["#B8572E", "#ffffff"],
    completed: ["#67883A", "#ffffff"],
    blocked: ["#81313F", "#ffffff"],
  };

  const chipStyle = (bg: string, fg: string) =>
    `display:inline-block;padding:4px 10px;margin:0 6px 6px 0;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;background:${bg};color:${fg};`;

  const priorityChip = task.priority
    ? (() => {
        const [bg, fg] = priorityColors[task.priority.toLowerCase()] || ["#E7DECF", "#292119"];
        return `<span style="${chipStyle(bg, fg)}">${escapeHtml(task.priority)}</span>`;
      })()
    : "";
  const statusChip = task.status
    ? (() => {
        const [bg, fg] = statusColors[task.status.toLowerCase()] || ["#E7DECF", "#292119"];
        return `<span style="${chipStyle(bg, fg)}">${escapeHtml(task.status.replace(/_/g, " "))}</span>`;
      })()
    : "";
  const chipsBlock = (priorityChip || statusChip)
    ? `<div style="margin-bottom:8px;">${priorityChip}${statusChip}</div>`
    : "";

  const dueDate = task.due_date
    ? new Date(task.due_date).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    : null;

  const descriptionBlock = task.description
    ? `<p style="margin:0;font-size:14px;color:#4A4138;line-height:1.6;">${escapeHtml(task.description)}</p>`
    : "";

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
    <div style="font-size:20px;font-weight:600;color:#292119;">Task assigned to you</div>
    <p style="margin:6px 0 0;font-size:14px;color:#6E6256;">${escapeHtml(senderName)} has assigned you a task</p>
  </td></tr>
  <tr><td style="padding:18px 30px 0;">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3ECE0;border:1px solid #E7DCCB;border-radius:12px;">
      <tr><td style="padding:16px 18px;">
        <p style="margin:0 0 8px;font-size:17px;font-weight:600;color:#292119;">${escapeHtml(task.title)}</p>
        ${dueDate ? `<span style="font-size:12px;color:#9C9082;">${dueDate}</span>` : ""}
      </td></tr>
    </table>
  </td></tr>
  ${(chipsBlock || descriptionBlock) ? `
  <tr><td style="padding:18px 30px 0;">
    ${chipsBlock}
    ${descriptionBlock}
  </td></tr>` : ""}
  <tr><td style="padding:24px 30px;" align="center">
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
      <td style="padding:0 6px 0 0;"><a href="${completeUrl}" style="display:inline-block;padding:11px 26px;background:#B8572E;color:#ffffff;font-size:13px;font-weight:600;border-radius:10px;text-decoration:none;">Mark completed</a></td>
      <td style="padding:0 0 0 6px;"><a href="${appUrl}" style="display:inline-block;padding:11px 26px;background:#FBF7F1;border:1px solid #B8572E;color:#B8572E;font-size:13px;font-weight:600;border-radius:10px;text-decoration:none;">View in Focus OS</a></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:0 30px 24px;">
    <div style="border-top:1px solid #ECE3D6;padding-top:14px;"><p style="margin:0;font-size:11px;color:#9C9082;text-align:center;">Sent via Focus OS</p></div>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userId = user.id;
    const userEmail = user.email as string;

    // Try to get sender's name from profiles
    let senderName = userEmail;
    const { data: profile } = await supabase
      .from("focusos_profiles")
      .select("first_name, last_name")
      .eq("user_id", userId)
      .single();
    
    if (profile?.first_name || profile?.last_name) {
      senderName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
    }

    const { taskId, recipientEmail } = await req.json();

    if (!taskId || !recipientEmail) {
      return new Response(JSON.stringify({ error: "taskId and recipientEmail required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch the task (must belong to user)
    const { data: task, error: taskError } = await supabase
      .from("focusos_tasks")
      .select("*")
      .eq("id", taskId)
      .eq("user_id", userId)
      .single();

    if (taskError || !task) {
      return new Response(JSON.stringify({ error: "Task not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Update the task with the assigned email
    const { error: updateError } = await supabase
      .from("focusos_tasks")
      .update({ assigned_to_email: recipientEmail })
      .eq("id", taskId);

    if (updateError) {
      console.error("Failed to update assigned_to_email:", updateError);
    }

    // Build complete URL
    const siteUrl = Deno.env.get("SUPABASE_URL")!.replace(".supabase.co", "");
    const projectRef = Deno.env.get("SUPABASE_URL")!.split("//")[1]?.split(".")[0] || "";
    const completeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/focusos-complete-shared-task?token=${task.share_token}`;

    const resend = new Resend(RESEND_API_KEY);

    const { error: emailError } = await resend.emails.send({
      from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
      to: [recipientEmail],
      subject: `Task assigned: ${task.title}`,
      html: buildTaskEmailHtml(task, completeUrl, senderName, "https://focusos.tech/brand/focusos-email-logo.png", "https://focusos2.lovable.app"),
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
    console.error("Error in send-task-email:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
