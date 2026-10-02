// Token-based Approve / Decline for Focus OS account approvals. No JWT: the
// approver opens the emailed link (a page on the app), which calls this.
//   GET  ?token=...                 -> { email, name, status } for a valid pending token
//   POST { token, action }          -> action is "approve" | "decline"; returns { status }
// GET never changes anything (email link scanners open links automatically).
//
// Env: RESEND_API_KEY, APP_BASE_URL (default https://focusos.tech).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const INVALID = "This link is no longer valid.";

function escapeHtml(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") return json(405, { error: "Method not allowed" });

  try {
    let token: string | null = null;
    let action: string | null = null;
    if (req.method === "GET") {
      token = new URL(req.url).searchParams.get("token");
    } else {
      try {
        const b = await req.json();
        token = typeof b?.token === "string" ? b.token : null;
        action = typeof b?.action === "string" ? b.action : null;
      } catch (_) { /* fall through to invalid */ }
    }
    token = token ? token.trim() : null;
    if (!token || token.length > 256) return json(400, { error: INVALID });
    if (req.method === "POST" && action !== "approve" && action !== "decline") {
      return json(400, { error: "action must be approve or decline" });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const tokenHash = await sha256Hex(token);
    const { data: row, error: rowErr } = await admin
      .from("focusos_account_approvals")
      .select("user_id, email, status, token_expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (rowErr) {
      console.error("focusos-decide-approval lookup failed:", rowErr.message);
      return json(500, { error: "Something went wrong" });
    }
    if (!row) return json(400, { error: INVALID });
    // Already decided (only reachable while the hash is still stored).
    if (row.status !== "pending") return json(200, { status: row.status });
    if (!row.token_expires_at || new Date(row.token_expires_at).getTime() <= Date.now()) {
      return json(400, { error: INVALID });
    }

    if (req.method === "GET") {
      let name = "";
      const { data: profile } = await admin
        .from("focusos_profiles")
        .select("first_name, last_name")
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (profile?.first_name || profile?.last_name) {
        name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
      }
      return json(200, { email: row.email, name, status: row.status });
    }

    const newStatus = action === "approve" ? "approved" : "declined";
    // Conditional update: only a still-pending row with this exact hash changes,
    // so two racing clicks cannot both act (and cannot send two emails).
    const { data: updated, error: updErr } = await admin
      .from("focusos_account_approvals")
      .update({ status: newStatus, decided_at: new Date().toISOString(), token_hash: null })
      .eq("user_id", row.user_id)
      .eq("status", "pending")
      .eq("token_hash", tokenHash)
      .select("user_id");
    if (updErr) {
      console.error("focusos-decide-approval update failed:", updErr.message);
      return json(500, { error: "Something went wrong" });
    }
    if (!updated || updated.length === 0) {
      const { data: now } = await admin
        .from("focusos_account_approvals")
        .select("status")
        .eq("user_id", row.user_id)
        .maybeSingle();
      return json(200, { status: now?.status ?? "pending" });
    }

    if (newStatus === "approved") {
      const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
      const baseUrl = (Deno.env.get("APP_BASE_URL") || "https://focusos.tech").replace(/\/+$/, "");
      if (!RESEND_API_KEY) {
        console.error("focusos-decide-approval: RESEND_API_KEY not configured; approved but no email sent");
      } else {
        try {
          const resend = new Resend(RESEND_API_KEY);
          const { error: sendErr } = await resend.emails.send({
            from: "AIS Apps <noreply@focusos.thefeedbackapp.net>",
            to: [row.email],
            subject: "You're in: Focus OS access approved",
            html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
<p>Good news: your Focus OS account has been approved.</p>
<p><a href="${escapeHtml(baseUrl)}/auth" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Sign in to Focus OS</a></p>
</div>`,
          });
          if (sendErr) {
            console.error("focusos-decide-approval: user email failed:", (sendErr as { message?: string }).message ?? "unknown");
          }
        } catch (e) {
          console.error("focusos-decide-approval: user email threw:", (e as Error)?.message ?? "unknown");
        }
      }
    }

    return json(200, { status: newStatus });
  } catch (e) {
    console.error("focusos-decide-approval error:", (e as Error)?.message ?? "unknown");
    return json(500, { error: "Something went wrong" });
  }
});
