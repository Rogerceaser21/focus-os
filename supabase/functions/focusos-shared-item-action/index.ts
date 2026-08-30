import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function escapeHtml(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("token");
    let action = url.searchParams.get("action");
    if (!token || !action) {
      try { const b = await req.json(); token = token || b.token; action = action || b.action; } catch (_) {}
    }
    if (!token || !action || !["accept", "reject"].includes(action)) {
      return json({ ok: false, title: "Invalid link", message: "This link is missing information or is not valid." });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: si } = await admin.from("focusos_shared_items").select("*").eq("action_token", token).single();
    if (!si) return json({ ok: false, title: "Link not valid", message: "This link has expired or does not exist." });

    // O12 finding 1: cancelled rows are kept as history (no DELETE policy) —
    // without this check, an Accept/Decline link from an email sent BEFORE
    // the sender cancelled would resurrect the cancelled row by flipping its
    // status, and post-O10 (cancel-then-reshare inserts a fresh pending row)
    // that can leave TWO non-cancelled rows for the same sender+recipient+item
    // triple, rendering the recipient twice on filtered surfaces. Refuse the
    // action outright — do not update the row, and never reroute to a newer
    // non-cancelled row; a stale email link must simply die.
    if (si.status === "cancelled") {
      return json({ ok: false, title: "Link not valid", message: "This share was cancelled by the sender." });
    }

    const update: Record<string, unknown> = { status: action === "accept" ? "accepted" : "declined" };
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
      } catch (e) { console.error("notify sender failed", e); }
    }

    return action === "accept"
      ? json({ ok: true, title: "Accepted", message: "Thanks. The sender has been told you accepted this." })
      : json({ ok: true, title: "Declined", message: "No problem. The sender has been told you declined this." });
  } catch (e) {
    console.error("focusos-shared-item-action error", e);
    return json({ ok: false, title: "Something went wrong", message: "Please try again later." });
  }
});