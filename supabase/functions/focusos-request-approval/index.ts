// Creates an approval request the first time an unapproved Focus OS account
// uses the app, and emails the approver ONE link to a page where they press
// Approve or Decline. Idempotent: a pending row with a valid token and a
// confirmed email sends nothing. A pending row whose token expired, is missing,
// or whose email was never confirmed sent (after 10 minutes) gets a fresh token
// and a new email, so no account is stuck pending forever (see needsResend).
//
// Env: RESEND_API_KEY, APPROVER_EMAIL (default igor.sesar@ais.ae),
//      APP_BASE_URL (default https://focusos.tech).
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "npm:resend@4.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";
import { requireSignedInUser } from "../_shared/approval.ts";
import { needsResend, TOKEN_TTL_MS } from "../_shared/approvalResend.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function base64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
// Header values must not carry line breaks.
function oneLine(s: string) {
  return String(s ?? "").replace(/[\r\n]+/g, " ").trim();
}

// Adds an approval link email to the approver. Returns true ONLY when Resend
// reports success; never throws and never logs the token.
async function emailApprover(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  user: any,
  email: string,
  rawToken: string,
): Promise<boolean> {
  // Name: profile first, then sign-up metadata.
  let name = "";
  const { data: profile } = await admin
    .from("focusos_profiles")
    .select("first_name, last_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profile?.first_name || profile?.last_name) {
    name = [profile.first_name, profile.last_name].filter(Boolean).join(" ");
  } else {
    const md = (user.user_metadata ?? {}) as Record<string, unknown>;
    const fromParts = [md.first_name, md.last_name].filter((v) => typeof v === "string" && v).join(" ");
    name = fromParts || (typeof md.full_name === "string" ? md.full_name : "") ||
      (typeof md.name === "string" ? md.name : "");
  }
  name = oneLine(name);

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    console.error("focusos-request-approval: RESEND_API_KEY not configured; row kept as pending, no email sent");
    return false;
  }
  const approverEmail = Deno.env.get("APPROVER_EMAIL") || "igor.sesar@ais.ae";
  const baseUrl = (Deno.env.get("APP_BASE_URL") || "https://focusos.tech").replace(/\/+$/, "");
  const link = `${baseUrl}/approve?token=${encodeURIComponent(rawToken)}`;
  const signedUp = user.created_at ? new Date(user.created_at).toUTCString() : "unknown";

  try {
    const resend = new Resend(RESEND_API_KEY);
    const who = name || email;
    const { error: sendErr } = await resend.emails.send({
      from: "Focus OS <noreply@focusos.thefeedbackapp.net>",
      to: [approverEmail],
      subject: `Focus OS: ${oneLine(who)} wants access`,
      html: `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px">
<p>Someone new wants to use Focus OS.</p>
<p><strong>Name:</strong> ${escapeHtml(name || "(not given)")}<br>
<strong>Email:</strong> ${escapeHtml(email)}<br>
<strong>Signed up:</strong> ${escapeHtml(signedUp)}</p>
<p><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:8px;text-decoration:none">Review this request</a></p>
<p style="color:#666;font-size:13px">The link opens a page where you press Approve or Decline. Nothing happens until you press a button. The link expires in 30 days.</p>
</div>`,
    });
    if (sendErr) {
      console.error("focusos-request-approval: approver email failed:", (sendErr as { message?: string }).message ?? "unknown");
      return false;
    }
    return true;
  } catch (e) {
    console.error("focusos-request-approval: approver email threw:", (e as Error)?.message ?? "unknown");
    return false;
  }
}

// Marks the email for THIS token as sent. Guarded by the token hash so a
// slower call can never mark a newer token's email as confirmed.
// deno-lint-ignore no-explicit-any
async function markEmailed(admin: any, userId: string, tokenHash: string) {
  const { error } = await admin
    .from("focusos_account_approvals")
    .update({ last_emailed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("status", "pending")
    .eq("token_hash", tokenHash);
  if (error) console.error("focusos-request-approval: could not record last_emailed_at:", error.message);
}

async function newToken() {
  // Random 32-byte token; only its SHA-256 hex is stored.
  const raw = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  return { raw, hash: await sha256Hex(raw), expiresAt: new Date(Date.now() + TOKEN_TTL_MS).toISOString() };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const signedIn = await requireSignedInUser(req, corsHeaders);
    if (signedIn instanceof Response) return signedIn;
    const { user } = signedIn;

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { data: existing, error: readErr } = await admin
      .from("focusos_account_approvals")
      .select("status, token_hash, token_expires_at, last_emailed_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (readErr) {
      console.error("focusos-request-approval read failed:", readErr.message);
      return json(500, { error: "Something went wrong" });
    }

    if (existing) {
      if (existing.status !== "pending" || !needsResend(existing)) {
        return json(200, { status: existing.status });
      }
      // Pending but stuck: issue a fresh token and email again. The update only
      // matches while the row still holds the token we just read, so two racing
      // calls cannot both re-issue (the loser sends nothing).
      const t = await newToken();
      let q = admin
        .from("focusos_account_approvals")
        .update({ token_hash: t.hash, token_expires_at: t.expiresAt })
        .eq("user_id", user.id)
        .eq("status", "pending");
      q = existing.token_hash === null ? q.is("token_hash", null) : q.eq("token_hash", existing.token_hash);
      const { data: won, error: reissueErr } = await q.select("email");
      if (reissueErr) {
        console.error("focusos-request-approval re-issue failed:", reissueErr.message);
        return json(500, { error: "Something went wrong" });
      }
      if (!won || won.length === 0) return json(200, { status: "pending" });

      if (await emailApprover(admin, user, String(won[0].email || user.email || ""), t.raw)) {
        await markEmailed(admin, user.id, t.hash);
      }
      return json(200, { status: "pending" });
    }

    const email = String(user.email ?? "").trim();
    if (!email) return json(400, { error: "Account has no email" });

    const t = await newToken();
    const { error: insertErr } = await admin.from("focusos_account_approvals").insert({
      user_id: user.id,
      email,
      status: "pending",
      token_hash: t.hash,
      token_expires_at: t.expiresAt,
    });
    if (insertErr) {
      // Two calls raced: the other one created the row and sends the email.
      if ((insertErr as { code?: string }).code === "23505") {
        const { data: again } = await admin
          .from("focusos_account_approvals")
          .select("status")
          .eq("user_id", user.id)
          .maybeSingle();
        return json(200, { status: again?.status ?? "pending" });
      }
      console.error("focusos-request-approval insert failed:", insertErr.message);
      return json(500, { error: "Something went wrong" });
    }

    if (await emailApprover(admin, user, email, t.raw)) await markEmailed(admin, user.id, t.hash);
    return json(200, { status: "pending" });
  } catch (e) {
    console.error("focusos-request-approval error:", (e as Error)?.message ?? "unknown");
    return json(500, { error: "Something went wrong" });
  }
});
