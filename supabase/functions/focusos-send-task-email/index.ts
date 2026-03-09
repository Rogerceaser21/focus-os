import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const priorityColors: Record<string, string> = {
  low: "#6b7280",
  medium: "#3b82f6",
  high: "#f59e0b",
  urgent: "#ef4444",
};

const priorityLabels: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "🔥 Urgent",
};

function buildTaskEmailHtml(task: any, completeUrl: string, senderName: string) {
  const priorityColor = priorityColors[task.priority] || "#3b82f6";
  const priorityLabel = priorityLabels[task.priority] || task.priority;
  const dueDate = task.due_date
    ? new Date(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0e1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e1117;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">

  <!-- Header -->
  <tr><td style="padding-bottom:24px;">
    <h1 style="margin:0;font-size:20px;color:#f0f0f0;">📋 Task Assigned to You</h1>
    <p style="margin:6px 0 0;font-size:14px;color:#9ca3af;">${senderName} has assigned you a task</p>
  </td></tr>

  <!-- Task Card -->
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(30,35,50,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      
      <!-- Task Title Row (mimics checkbox + title) -->
      <tr><td style="padding:20px 20px 12px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <!-- Circle (unchecked checkbox) -->
          <td style="vertical-align:top;padding-right:12px;">
            <a href="${completeUrl}" style="text-decoration:none;display:inline-block;">
              <div style="width:22px;height:22px;border-radius:50%;border:2px solid ${priorityColor};display:inline-block;"></div>
            </a>
          </td>
          <!-- Title -->
          <td style="vertical-align:top;">
            <p style="margin:0;font-size:15px;font-weight:600;color:#f0f0f0;line-height:1.4;">${escapeHtml(task.title)}</p>
          </td>
        </tr></table>
      </td></tr>

      <!-- Description -->
      ${task.description ? `
      <tr><td style="padding:0 20px 16px 54px;">
        <p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.5;">${escapeHtml(task.description)}</p>
      </td></tr>` : ""}

      <!-- Meta row: Priority + Due Date -->
      <tr><td style="padding:0 20px 20px 54px;">
        <table cellpadding="0" cellspacing="0"><tr>
          <td style="padding-right:8px;">
            <span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;font-weight:600;color:#fff;background:${priorityColor};text-transform:uppercase;letter-spacing:0.5px;">${priorityLabel}</span>
          </td>
          ${dueDate ? `
          <td>
            <span style="display:inline-block;padding:3px 10px;border-radius:6px;font-size:11px;color:#9ca3af;border:1px solid rgba(255,255,255,0.1);">📅 ${dueDate}</span>
          </td>` : ""}
        </tr></table>
      </td></tr>

    </table>
  </td></tr>

  <!-- CTA Button -->
  <tr><td style="padding:24px 0;">
    <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
      <a href="${completeUrl}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#0ea5e9,#06b6d4);color:#fff;font-size:14px;font-weight:600;border-radius:8px;text-decoration:none;">
        ✅ Mark as Complete
      </a>
    </td></tr></table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
    <p style="margin:0;font-size:11px;color:#6b7280;text-align:center;">
      Sent via Focus OS · Click the circle or button above to mark this task complete
    </p>
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
      html: buildTaskEmailHtml(task, completeUrl, senderName),
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
