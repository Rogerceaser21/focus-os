import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { needsResend, RESEND_AFTER_MS, TOKEN_TTL_MS } from "./approvalResend.ts";

const NOW = Date.parse("2026-10-01T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
// A token issued `ageMs` ago (expiry = issue + TTL).
const issuedAgo = (ageMs: number) => iso(NOW - ageMs + TOKEN_TTL_MS);

Deno.test("null token_hash -> re-send", () => {
  assertEquals(needsResend({ token_hash: null, token_expires_at: null, last_emailed_at: iso(NOW) }, NOW), true);
  assertEquals(needsResend({ token_hash: null, token_expires_at: issuedAgo(1000), last_emailed_at: iso(NOW) }, NOW), true);
});

Deno.test("expired token -> re-send even if the old email succeeded", () => {
  const issued = NOW - TOKEN_TTL_MS - 1000;
  assertEquals(needsResend({ token_hash: "h", token_expires_at: iso(issued + TOKEN_TTL_MS), last_emailed_at: iso(issued + 5000) }, NOW), true);
});

Deno.test("valid token + confirmed email -> nothing", () => {
  const age = 3 * 24 * 3600 * 1000;
  assertEquals(needsResend({ token_hash: "h", token_expires_at: issuedAgo(age), last_emailed_at: iso(NOW - age + 2000) }, NOW), false);
});

Deno.test("email never confirmed, token older than 10 min -> re-send", () => {
  assertEquals(needsResend({ token_hash: "h", token_expires_at: issuedAgo(RESEND_AFTER_MS + 1000), last_emailed_at: null }, NOW), true);
});

Deno.test("email never confirmed, token 5 min old -> nothing (quick reload does not spam)", () => {
  assertEquals(needsResend({ token_hash: "h", token_expires_at: issuedAgo(5 * 60 * 1000), last_emailed_at: null }, NOW), false);
});

Deno.test("re-issued token whose email failed: old last_emailed_at predates the new token -> unconfirmed", () => {
  // Old email confirmed 20 days ago; token re-issued 5 min ago; not confirmed yet -> wait
  assertEquals(needsResend({ token_hash: "h", token_expires_at: issuedAgo(5 * 60 * 1000), last_emailed_at: iso(NOW - 20 * 24 * 3600 * 1000) }, NOW), false);
  // Same, but re-issued 11 min ago and still unconfirmed -> re-send
  assertEquals(needsResend({ token_hash: "h", token_expires_at: issuedAgo(11 * 60 * 1000), last_emailed_at: iso(NOW - 20 * 24 * 3600 * 1000) }, NOW), true);
});

Deno.test("boundary: exactly 10 minutes old and unconfirmed -> re-send", () => {
  assertEquals(needsResend({ token_hash: "h", token_expires_at: issuedAgo(RESEND_AFTER_MS), last_emailed_at: null }, NOW), true);
});
