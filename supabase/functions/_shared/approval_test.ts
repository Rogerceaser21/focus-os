import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { isApprovedUserId, requireApprovedUser } from "./approval.ts";

const cors = { "Access-Control-Allow-Origin": "*" };

function authClient(user: { id: string } | null, err: unknown = null) {
  return () => ({ auth: { getUser: (_t: string) => Promise.resolve({ data: { user }, error: err }) } });
}
function adminClient(result: { data: unknown; error: unknown } | "throw") {
  return () => ({
    from: (_t: string) => ({
      select: (_c: string) => ({
        eq: (_k: string, _v: string) => ({
          maybeSingle: () => result === "throw" ? Promise.reject(new Error("boom")) : Promise.resolve(result),
        }),
      }),
    }),
  });
}
const req = (auth?: string) => new Request("https://x.test/fn", { method: "POST", headers: auth ? { Authorization: auth } : {} });

Deno.test("approved user passes and gets user + token", async () => {
  const r = await requireApprovedUser(req("Bearer tok"), cors, {
    makeAuthClient: authClient({ id: "u1" }),
    makeAdminClient: adminClient({ data: { status: "approved" }, error: null }),
  });
  if (r instanceof Response) throw new Error("expected pass");
  assertEquals(r.user.id, "u1");
  assertEquals(r.token, "tok");
});

Deno.test("pending user gets 403 awaiting_approval with CORS", async () => {
  const r = await requireApprovedUser(req("Bearer tok"), cors, {
    makeAuthClient: authClient({ id: "u1" }),
    makeAdminClient: adminClient({ data: { status: "pending" }, error: null }),
  });
  assertEquals(r instanceof Response, true);
  const res = r as Response;
  assertEquals(res.status, 403);
  assertEquals((await res.json()).error, "awaiting_approval");
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
});

Deno.test("declined user gets 403", async () => {
  const r = await requireApprovedUser(req("Bearer tok"), cors, {
    makeAuthClient: authClient({ id: "u1" }),
    makeAdminClient: adminClient({ data: { status: "declined" }, error: null }),
  });
  assertEquals((r as Response).status, 403);
});

Deno.test("no row gets 403", async () => {
  const r = await requireApprovedUser(req("Bearer tok"), cors, {
    makeAuthClient: authClient({ id: "u1" }),
    makeAdminClient: adminClient({ data: null, error: null }),
  });
  assertEquals((r as Response).status, 403);
});

Deno.test("lookup error fails closed with 403", async () => {
  const r = await requireApprovedUser(req("Bearer tok"), cors, {
    makeAuthClient: authClient({ id: "u1" }),
    makeAdminClient: adminClient({ data: { status: "approved" }, error: { message: "db down" } }),
  });
  assertEquals((r as Response).status, 403);
});

Deno.test("lookup throwing fails closed with 403", async () => {
  const r = await requireApprovedUser(req("Bearer tok"), cors, {
    makeAuthClient: authClient({ id: "u1" }),
    makeAdminClient: adminClient("throw"),
  });
  assertEquals((r as Response).status, 403);
});

Deno.test("no token gets 401 Not signed in", async () => {
  const r = await requireApprovedUser(req(), cors, {
    makeAuthClient: authClient({ id: "u1" }),
    makeAdminClient: adminClient({ data: { status: "approved" }, error: null }),
  });
  const res = r as Response;
  assertEquals(res.status, 401);
  assertEquals((await res.json()).error, "Not signed in");
});

Deno.test("invalid token (getUser error) gets 401", async () => {
  const r = await requireApprovedUser(req("Bearer bad"), cors, {
    makeAuthClient: authClient(null, { message: "invalid JWT" }),
    makeAdminClient: adminClient({ data: { status: "approved" }, error: null }),
  });
  assertEquals((r as Response).status, 401);
});

Deno.test("isApprovedUserId: approved true, pending false, empty id false", async () => {
  assertEquals(await isApprovedUserId("u1", { makeAdminClient: adminClient({ data: { status: "approved" }, error: null }) }), true);
  assertEquals(await isApprovedUserId("u1", { makeAdminClient: adminClient({ data: { status: "pending" }, error: null }) }), false);
  assertEquals(await isApprovedUserId("", { makeAdminClient: adminClient({ data: { status: "approved" }, error: null }) }), false);
});
