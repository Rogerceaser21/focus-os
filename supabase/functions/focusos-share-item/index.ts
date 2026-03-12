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

function buildShareEmailHtml(p: {
  senderName: string;
  itemType: string;
  itemTitle: string;
  projectName?: string;
  appUrl: string;
}) {
  const typeLabel = p.itemType.charAt(0).toUpperCase() + p.itemType.slice(1);
  const projectLine = p.projectName
    ? `<p style="margin:4px 0 0;font-size:13px;color:#9ca3af;">Project: ${escapeHtml(p.projectName)}</p>`
    : "";

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0e1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0e1117;padding:40px 20px;">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;">
  <tr><td style="padding-bottom:24px;">
    <h1 style="margin:0;font-size:20px;color:#f0f0f0;">📬 ${typeLabel} Shared With You</h1>
    <p style="margin:6px 0 0;font-size:14px;color:#9ca3af;">${escapeHtml(p.senderName)} has shared a ${p.itemType} with you</p>
  </td></tr>
  <tr><td>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(30,35,50,0.85);border:1px solid rgba(255,255,255,0.08);border-radius:12px;overflow:hidden;">
      <tr><td style="padding:20px;">
        <p style="margin:0;font-size:15px;font-weight:600;color:#f0f0f0;">${escapeHtml(p.itemTitle)}</p>
        ${projectLine}
        <p style="margin:12px 0 0;font-size:12px;color:#6b7280;">Type: ${typeLabel}</p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="padding:24px 0;">
    <table cellpadding="0" cellspacing="0" width="100%"><tr><td align="center">
      <a href="${p.appUrl}" style="display:inline-block;padding:12px 32px;background:linear-gradient(135deg,#0ea5e9,#06b6d4);color:#fff;font-size:14px;font-weight:600;border-radius:8px;text-decoration:none;">
        View in Focus OS
      </a>
    </td></tr></table>
  </td></tr>
  <tr><td style="padding-top:16px;border-top:1px solid rgba(255,255,255,0.06);">
    <p style="margin:0;font-size:11px;color:#6b7280;text-align:center;">
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

    const { itemType, itemId, recipientEmail } = await req.json();

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

    if (itemType === "task") {
      const { data: task, error } = await supabaseUser
        .from("focusos_tasks")
        .select("title, project_id")
        .eq("id", itemId)
        .single();
      if (error || !task) {
        return new Response(JSON.stringify({ error: "Task not found" }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      itemTitle = task.title;
      // Resolve project name if task belongs to a project
      if (task.project_id) {
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

    // Insert shared item row
    const { error: insertError } = await supabaseUser
      .from("focusos_shared_items")
      .insert({
        sender_user_id: senderId,
        sender_email: senderEmail,
        sender_name: senderName,
        recipient_email: recipientEmail.trim().toLowerCase(),
        recipient_user_id: recipientUserId,
        item_type: itemType,
        item_id: itemId,
        item_title: itemTitle,
        project_name: projectName || null,
        status: "pending",
      });

    if (insertError) {
      console.error("Insert shared item error:", insertError);
      throw new Error("Failed to create shared item");
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
