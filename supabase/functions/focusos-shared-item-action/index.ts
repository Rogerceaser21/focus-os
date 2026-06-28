import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

function escapeHtml(s: string) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, msg: string, isSuccess = true) {
  return buildResultPage(title, msg, isSuccess);
}

function buildResultPage(title: string, msg: string, isSuccess: boolean) {
  const t = escapeHtml(title);
  const m = escapeHtml(msg);
  const icon = isSuccess
    ? `<div class="icon ok"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>`
    : `<div class="icon err">!</div>`;
  const autoClose = isSuccess
    ? `<script>setTimeout(function(){try{window.close();}catch(e){}}, 1200);</script>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${t} · Focus OS</title>
<style>
  body { margin:0; padding:40px 20px; background:#ffffff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; color:#2c2418; min-height:100vh; }
  .wrap { max-width: 440px; margin: 60px auto; text-align:center; }
  .brand { margin-bottom:24px; font-size:13px; letter-spacing:0.08em; text-transform:uppercase; color:#B8572E; font-weight:600; }
  .card { background:#ffffff; border:1px solid #ece3d2; border-radius:16px; padding:36px 28px; box-shadow: 0 2px 10px rgba(0,0,0,0.04); }
  .icon { width:64px; height:64px; border-radius:50%; margin:0 auto 20px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:32px; color:#fff; }
  .icon.ok { background:#5a8a4a; }
  .icon.err { background:#B8572E; }
  h1 { margin:0 0 10px; font-size:22px; color:#2c2418; font-weight:600; letter-spacing:-0.01em; }
  p { margin:0 0 24px; font-size:15px; line-height:1.55; color:#5b4f3f; }
  button { background:#B8572E; color:#fff; border:0; border-radius:8px; padding:10px 22px; font-size:14px; font-weight:600; cursor:pointer; font-family:inherit; }
  button:hover { background:#a04a25; }
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">Focus OS</div>
    <div class="card">
      ${icon}
      <h1>${t}</h1>
      <p>${m}</p>
      <button onclick="try{window.close();}catch(e){}">Close</button>
    </div>
  </div>
  ${autoClose}
</body>
</html>`;
}

serve(async (req) => {
  const html = (h: string, status = 200) =>
    new Response(h, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token");
    const action = url.searchParams.get("action");
    if (!token || !action || !["accept", "reject"].includes(action)) {
      return html(page("Invalid link", "This link is missing information or is not valid.", false), 400);
    }
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: si } = await admin
      .from("focusos_shared_items")
      .select("*")
      .eq("action_token", token)
      .single();
    if (!si) return html(page("Link not valid", "This link has expired or does not exist.", false), 404);

    const update: Record<string, unknown> = {
      status: action === "accept" ? "accepted" : "declined",
    };
    if (action === "accept") update.sender_acknowledged = false;
    await admin.from("focusos_shared_items").update(update).eq("id", si.id);

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (RESEND_API_KEY) {
      try {
        const resend = new Resend(RESEND_API_KEY);
        const verb = action === "accept" ? "accepted" : "declined";
        await resend.emails.send({
          from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
          to: [si.sender_email],
          subject: `Your shared ${si.item_type} was ${verb}`,
          html: `<p>${escapeHtml(si.recipient_email)} has ${verb} the ${escapeHtml(si.item_type)} "${escapeHtml(si.item_title)}" you shared.</p>`,
        });
      } catch (e) {
        console.error("notify sender failed", e);
      }
    }

    return html(
      action === "accept"
        ? page("Accepted", "Thanks. The sender has been told you accepted this.", true)
        : page("Declined", "No problem. The sender has been told you declined this.", true),
    );
  } catch (e) {
    console.error("focusos-shared-item-action error", e);
    return html(page("Something went wrong", "Please try again later.", false), 500);
  }
});