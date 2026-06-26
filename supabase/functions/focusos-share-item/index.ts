import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
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

function fmtDate(d?: string | null): string | null {
  if (!d) return null;
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return null;
  }
}

function buildShareEmailHtml(p: {
  senderName: string;
  itemType: string;
  itemTitle: string;
  projectName?: string;
  appUrl: string;
  shareToken?: string;
  supabaseUrl?: string;
  logoUrl?: string;
  description?: string | null;
  priority?: string | null;
  status?: string | null;
  dueDate?: string | null;
  recipientUserId?: string | null;
  actionToken?: string | null;
}) {
  const typeLabel = p.itemType.charAt(0).toUpperCase() + p.itemType.slice(1);
  const projectLine = p.projectName
    ? `<p style="margin:6px 0 0;font-size:13px;color:#6b5b4b;">Project: ${escapeHtml(p.projectName)}</p>`
    : "";

  const dueLine = p.dueDate
    ? `<p style="margin:6px 0 0;font-size:13px;color:#6b5b4b;">Due: ${escapeHtml(fmtDate(p.dueDate) || p.dueDate)}</p>`
    : "";

  const descriptionBlock = p.description
    ? `<p style="margin:14px 0 0;font-size:14px;line-height:1.55;color:#292119;white-space:pre-wrap;">${escapeHtml(p.description)}</p>`
    : "";

  const chipStyle = (bg: string, fg: string) =>
    `display:inline-block;padding:4px 10px;margin:0 6px 6px 0;border-radius:999px;font-size:11px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;background:${bg};color:${fg};`;

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

  const priorityChip = p.priority
    ? (() => {
        const [bg, fg] = priorityColors[p.priority.toLowerCase()] || ["#E7DECF", "#292119"];
        return `<span style="${chipStyle(bg, fg)}">${escapeHtml(p.priority)}</span>`;
      })()
    : "";
  const statusChip = p.status
    ? (() => {
        const [bg, fg] = statusColors[p.status.toLowerCase()] || ["#E7DECF", "#292119"];
        return `<span style="${chipStyle(bg, fg)}">${escapeHtml(p.status.replace(/_/g, " "))}</span>`;
      })()
    : "";
  const chipsBlock = (priorityChip || statusChip)
    ? `<div style="margin-top:14px;">${priorityChip}${statusChip}</div>`
    : "";

  const logoHeader = p.logoUrl
    ? `<tr><td align="center" style="padding-bottom:20px;">
        <img src="${p.logoUrl}" alt="Focus OS" width="140" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:140px;" />
      </td></tr>`
    : "";

  // Action buttons
  const isTask = p.itemType === "task";
  const hasAccount = p.recipientUserId != null;
  const acceptUrl = hasAccount
    ? p.appUrl
    : `${p.supabaseUrl}/functions/v1/focusos-shared-item-action?token=${p.actionToken}&action=accept`;
  const rejectUrl = hasAccount
    ? p.appUrl
    : `${p.supabaseUrl}/functions/v1/focusos-shared-item-action?token=${p.actionToken}&action=reject`;
  const completedUrl = (isTask && p.shareToken && p.supabaseUrl)
    ? (hasAccount ? p.appUrl : `${p.supabaseUrl}/functions/v1/focusos-complete-shared-task?token=${p.shareToken}`)
    : null;

  const btnBase = `display:inline-block;padding:8px 14px;font-size:12px;font-weight:600;border-radius:6px;text-decoration:none;`;

  let actionButtonsHtml = "";
  if (hasAccount) {
    actionButtonsHtml = `
      <tr><td align="center" style="padding:16px 24px 20px;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
          <td style="padding:0 4px 4px 0;"><a href="${escapeHtml(acceptUrl)}" style="${btnBase}background:#67883A;color:#ffffff;">Accept</a></td>
          <td style="padding:0 4px 4px 0;"><a href="${escapeHtml(rejectUrl)}" style="${btnBase}background:#81313F;color:#ffffff;">Reject</a></td>
          ${completedUrl ? `<td style="padding:0 4px 4px 0;"><a href="${escapeHtml(completedUrl)}" style="${btnBase}background:#B8572E;color:#ffffff;">Completed</a></td>` : ""}
          <td style="padding:0 0 4px 0;"><a href="${escapeHtml(p.appUrl)}" style="${btnBase}background:#2c2418;color:#ffffff;">View in Focus OS</a></td>
        </tr></table>
        <p style="margin:8px 0 0;font-size:11px;color:#6b5b4b;">Log in to Focus OS to action this.</p>
      </td></tr>`;
  } else {
    actionButtonsHtml = `
      <tr><td align="center" style="padding:16px 24px 20px;">
        <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr>
          <td style="padding:0 4px 4px 0;"><a href="${escapeHtml(acceptUrl)}" style="${btnBase}background:#67883A;color:#ffffff;">Accept</a></td>
          <td style="padding:0 4px 4px 0;"><a href="${escapeHtml(rejectUrl)}" style="${btnBase}background:#81313F;color:#ffffff;">Reject</a></td>
          ${completedUrl ? `<td style="padding:0 4px 4px 0;"><a href="${escapeHtml(completedUrl)}" style="${btnBase}background:#B8572E;color:#ffffff;">Completed</a></td>` : ""}
          <td style="padding:0 0 4px 0;"><a href="${escapeHtml(p.appUrl)}" style="${btnBase}background:#2c2418;color:#ffffff;">View in Focus OS</a></td>
        </tr></table>
        <p style="margin:8px 0 0;font-size:11px;color:#6b5b4b;">No login required.</p>
      </td></tr>`;
  }

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#292119;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  ${logoHeader}
  <tr><td style="padding-bottom:24px;">
    <h1 style="margin:0;font-size:22px;color:#292119;font-weight:700;letter-spacing:-0.01em;">${typeLabel} shared with you</h1>
    <p style="margin:8px 0 0;font-size:14px;color:#6b5b4b;">${escapeHtml(p.senderName)} has shared a ${escapeHtml(p.itemType)} with you</p>
  </td></tr>
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7F1;border:1px solid rgba(41,33,25,0.08);border-radius:12px;overflow:hidden;">
      <tr><td style="padding:24px;">
        <p style="margin:0;font-size:17px;font-weight:600;color:#292119;line-height:1.35;">${escapeHtml(p.itemTitle)}</p>
        ${projectLine}
        ${dueLine}
        ${chipsBlock}
        ${descriptionBlock}
      </td></tr>
      ${actionButtonsHtml}
    </table>
  </td></tr>
  <tr><td style="padding-top:16px;border-top:1px solid rgba(41,33,25,0.1);">
    <p style="margin:0;font-size:11px;color:#6b5b4b;text-align:center;">
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

    // User-scoped client (for RLS)
    const supabaseUser = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    // Service-role client (to look up recipient)
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseUser.auth.getUser(token);
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const senderId = user.id;
    const senderEmail = user.email as string;

    const { itemType, itemId, recipientEmail, sendEmail } = await req.json();

    if (!itemType || !itemId || !recipientEmail) {
      return new Response(JSON.stringify({ error: "itemType, itemId, and recipientEmail required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!["task", "project", "meeting"].includes(itemType)) {
      return new Response(JSON.stringify({ error: "itemType must be task, project, or meeting" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve sender name
    let senderName = senderEmail;
    const { data: profile } = await supabaseUser
      .from("focusos_profiles")
      .select("first_name, last_name")
      .eq("user_id", senderId)
      .single();
    if (profile?.first_name || profile?.last_name) {
      senderName = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
    }

    // Fetch item and verify ownership
    let itemTitle = "";
    let projectName: string | undefined;

    let shareToken: string | undefined;
    let description: string | null = null;
    let priority: string | null = null;
    let status: string | null = null;
    let dueDate: string | null = null;

    if (itemType === "task") {
      const { data: task, error } = await supabaseUser
        .from("focusos_tasks")
        .select("title, project_id, share_token, meeting_id, description, priority, status, due_date")
        .eq("id", itemId)
        .single();
      if (error || !task) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      itemTitle = task.title;
      shareToken = task.share_token;
      description = task.description ?? null;
      priority = task.priority ?? null;
      status = task.status ?? null;
      dueDate = task.due_date ?? null;

      if (task.meeting_id) {
        // Task originated from a meeting — use truncated meeting title as project name
        const { data: meeting } = await supabaseUser
          .from("focusos_meetings")
          .select("title")
          .eq("id", task.meeting_id)
          .single();
        if (meeting) {
          const maxLen = 30;
          projectName = meeting.title.length > maxLen
            ? meeting.title.substring(0, maxLen) + "…"
            : meeting.title;
        }
      } else if (task.project_id) {
        // Resolve project name if task belongs to a project
        const { data: proj } = await supabaseUser
          .from("focusos_projects")
          .select("name")
          .eq("id", task.project_id)
          .single();
        if (proj) projectName = proj.name;
      }
    } else if (itemType === "project") {
      const { data: proj, error } = await supabaseUser
        .from("focusos_projects")
        .select("name")
        .eq("id", itemId)
        .single();
      if (error || !proj) {
        return new Response(JSON.stringify({ error: "Project not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      itemTitle = proj.name;
    } else if (itemType === "meeting") {
      const { data: meeting, error } = await supabaseUser
        .from("focusos_meetings")
        .select("title")
        .eq("id", itemId)
        .single();
      if (error || !meeting) {
        return new Response(JSON.stringify({ error: "Meeting not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      itemTitle = meeting.title;
    }

    // Resolve recipient user_id (if they have an account) — use service role to bypass RLS
    let recipientUserId: string | null = null;
    const { data: recipientUser } = await supabaseAdmin
      .from("focusos_users")
      .select("user_id")
      .eq("email", recipientEmail.trim().toLowerCase())
      .single();
    if (recipientUser) {
      recipientUserId = recipientUser.user_id;
    }

    const normalizedRecipient = recipientEmail.trim().toLowerCase();

    // Idempotency: reuse existing shared item if one already exists for the
    // same sender + recipient + item.
    const { data: existing } = await supabaseUser
      .from("focusos_shared_items")
      .select("id, action_token")
      .eq("sender_user_id", senderId)
      .eq("recipient_email", normalizedRecipient)
      .eq("item_type", itemType)
      .eq("item_id", itemId)
      .maybeSingle();

    let actionToken: string | null = null;

    if (!existing) {
      const { data: inserted, error: insertError } = await supabaseUser
        .from("focusos_shared_items")
        .insert({
          sender_user_id: senderId,
          sender_email: senderEmail,
          sender_name: senderName,
          recipient_email: normalizedRecipient,
          recipient_user_id: recipientUserId,
          item_type: itemType,
          item_id: itemId,
          item_title: itemTitle,
          project_name: projectName || null,
          status: "pending",
        })
        .select("action_token")
        .single();

      if (insertError) {
        console.error("Insert shared item error:", insertError);
        throw new Error("Failed to create shared item");
      }
      actionToken = inserted?.action_token ?? null;
    } else {
      actionToken = existing.action_token;
    }

    // Auto-routing: if sendEmail is omitted, send the branded email ONLY when
    // the recipient is NOT an existing Focus OS user. Existing users are
    // notified via the in-app shared item instead. Explicit true/false wins.
    const shouldSendEmail = recipientUserId === null ? true : (sendEmail !== false);

    if (!shouldSendEmail) {
      return new Response(JSON.stringify({ success: true, emailSkipped: true, reused: !!existing }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Send email via Resend
    const appUrl = "https://focusos2.lovable.app";
    const resend = new Resend(RESEND_API_KEY);
    const typeLabel = itemType.charAt(0).toUpperCase() + itemType.slice(1);

    const { error: emailError } = await resend.emails.send({
      from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
      to: [recipientEmail.trim()],
      subject: `${typeLabel} shared with you: ${itemTitle}`,
      html: buildShareEmailHtml({
        senderName,
        itemType,
        itemTitle,
        projectName,
        appUrl,
        shareToken,
        supabaseUrl: Deno.env.get("SUPABASE_URL"),
        logoUrl: "https://focusos.tech/brand/focusos-email-logo.png",
        description,
        priority,
        status,
        dueDate,
        recipientUserId,
        actionToken,
      }),
    });

    if (emailError) {
      console.error("Resend error:", emailError);
      // Don't throw — the shared item was created, email is best-effort
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    console.error("Error in focusos-share-item:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
