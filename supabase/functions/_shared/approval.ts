// Account-approval gate for Focus OS edge functions.
//
// Every new Focus OS account waits until the approver clicks Approve in an
// email. Approval lives in public.focusos_account_approvals (status
// 'approved'). Existing users were seeded as approved. Any function that acts
// for a signed-in user calls requireApprovedUser() right after its OPTIONS
// preflight and returns the Response it gets back when the caller is not
// allowed in.
//
// Fails CLOSED: a missing token, a bad token, a missing row, a non-approved
// status or ANY lookup error all refuse the request.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.78.0";

// Minimal client shape we use, so tests can stub it without supabase-js.
// deno-lint-ignore no-explicit-any
type AnyClient = any;

export interface ApprovalDeps {
  // Client used to resolve the bearer token to a user (anon key; getUser(token)
  // asks the auth server, it does not trust the token's claims).
  makeAuthClient?: () => AnyClient;
  // Service-role client used to read focusos_account_approvals.
  makeAdminClient?: () => AnyClient;
}

export interface ApprovedUser {
  id: string;
  email?: string;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export interface ApprovalOk {
  user: ApprovedUser;
  token: string;
}

function defaultAuthClient(): AnyClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function defaultAdminClient(): AnyClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// True only when the user has a row with status 'approved'. Any error, missing
// row or unexpected shape returns false (fail closed).
export async function isApprovedUserId(
  userId: string,
  deps: ApprovalDeps = {},
): Promise<boolean> {
  if (!userId) return false;
  try {
    const admin = (deps.makeAdminClient ?? defaultAdminClient)();
    const { data, error } = await admin
      .from("focusos_account_approvals")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      console.error("approval lookup failed:", error.message ?? "unknown error");
      return false;
    }
    return data?.status === "approved";
  } catch (e) {
    console.error("approval lookup threw:", (e as Error)?.message ?? "unknown error");
    return false;
  }
}

// Signed in only (no approval check). Returns { user, token } or a 401 Response.
// Used by focusos-request-approval, which must work for UNAPPROVED accounts.
export async function requireSignedInUser(
  req: Request,
  corsHeaders: Record<string, string> = {},
  deps: ApprovalDeps = {},
): Promise<ApprovalOk | Response> {
  const authHeader = req.headers.get("Authorization") ?? "";
  const m = authHeader.match(/^Bearer\s+(.+)$/i);
  const token = m?.[1]?.trim();
  if (!token) return jsonResponse(401, { error: "Not signed in" }, corsHeaders);

  let user: ApprovedUser | null = null;
  try {
    const authClient = (deps.makeAuthClient ?? defaultAuthClient)();
    const { data, error } = await authClient.auth.getUser(token);
    if (!error && data?.user?.id) user = data.user as ApprovedUser;
  } catch (e) {
    console.error("approval getUser threw:", (e as Error)?.message ?? "unknown error");
  }
  if (!user) return jsonResponse(401, { error: "Not signed in" }, corsHeaders);
  return { user, token };
}

// Returns { user, token } for a signed-in, approved caller, or a ready Response:
//   401 {error:"Not signed in"}          no/invalid bearer token
//   403 {error:"awaiting_approval"}      signed in but not approved (or lookup failed)
export async function requireApprovedUser(
  req: Request,
  corsHeaders: Record<string, string> = {},
  deps: ApprovalDeps = {},
): Promise<ApprovalOk | Response> {
  const signedIn = await requireSignedInUser(req, corsHeaders, deps);
  if (signedIn instanceof Response) return signedIn;
  if (!(await isApprovedUserId(signedIn.user.id, deps))) {
    return jsonResponse(403, { error: "awaiting_approval" }, corsHeaders);
  }
  return signedIn;
}

// One query: which of these user ids are approved. Fails CLOSED: on any error
// it returns an empty set (nobody counts as approved). Used by the poller so it
// never does a lookup per row.
export async function approvedUserIds(
  userIds: string[],
  deps: ApprovalDeps = {},
): Promise<Set<string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return new Set();
  try {
    const admin = (deps.makeAdminClient ?? defaultAdminClient)();
    const { data, error } = await admin
      .from("focusos_account_approvals")
      .select("user_id")
      .eq("status", "approved")
      .in("user_id", ids);
    if (error) {
      console.error("approval batch lookup failed:", error.message ?? "unknown error");
      return new Set();
    }
    return new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
  } catch (e) {
    console.error("approval batch lookup threw:", (e as Error)?.message ?? "unknown error");
    return new Set();
  }
}

// Constant-time string compare: both sides are hashed first, so the compare
// time depends on neither the content nor the length of the secret.
export async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// For one-off / internal functions: only a caller whose Bearer equals the
// service-role key gets through. Returns null when allowed, or a 401 Response.
export async function requireServiceRole(
  req: Request,
  corsHeaders: Record<string, string> = {},
  serviceKey: string | undefined = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
): Promise<Response | null> {
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!serviceKey || !bearer || !(await constantTimeEqual(bearer, serviceKey))) {
    return jsonResponse(401, { error: "Unauthorized" }, corsHeaders);
  }
  return null;
}

// Link/token functions: the row's OWNER must be approved, or the link is dead.
export function invalidLinkResponse(corsHeaders: Record<string, string> = {}): Response {
  return jsonResponse(
    403,
    { error: "This link is no longer valid.", ok: false, title: "Link not valid", message: "This link is no longer valid." },
    corsHeaders,
  );
}
