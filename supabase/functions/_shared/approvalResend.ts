// Decides whether a PENDING approval row needs a fresh token + a new approver
// email, so no account can be stuck pending forever.
//
// A token's issue time is token_expires_at minus the TTL (there is no separate
// column). last_emailed_at is set only after Resend reports success, so
// "last_emailed_at is null or older than the token's issue time" means the
// email for the CURRENT token was never confirmed sent.
//
// Re-send when:
//   1. token_hash is null, or token_expires_at is missing or in the past; or
//   2. the current token's email is unconfirmed AND the token was issued more
//      than 10 minutes ago (covers a failed send or a missing API key without
//      letting a quick reload, or a race right after a re-issue, spam the approver).
// A pending row with a valid token and a confirmed email sends nothing.

export const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const RESEND_AFTER_MS = 10 * 60 * 1000;

export interface PendingRow {
  token_hash: string | null;
  token_expires_at: string | null;
  last_emailed_at: string | null;
}

export function needsResend(row: PendingRow, now: number = Date.now()): boolean {
  if (!row.token_hash || !row.token_expires_at) return true;
  const expires = new Date(row.token_expires_at).getTime();
  if (!Number.isFinite(expires) || expires <= now) return true;

  const issuedAt = expires - TOKEN_TTL_MS;
  const emailed = row.last_emailed_at ? new Date(row.last_emailed_at).getTime() : NaN;
  const confirmed = Number.isFinite(emailed) && emailed >= issuedAt;
  if (confirmed) return false;
  return issuedAt <= now - RESEND_AFTER_MS;
}
