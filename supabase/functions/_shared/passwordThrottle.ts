// Untyped on purpose: callers create the supabase-js client at whichever
// package version they import (signup-admin pins @2.38.4, others use @2),
// and those generated SupabaseClient types are not assignable to each other.

// The SQL function also upserts a shared 'global' row for the cross-client cap.
// The 'ip:' prefix on every real client key guarantees a client key can never
// collide with that literal 'global' row.

// cf-connecting-ip is set by the edge network itself and can't be spoofed by
// the caller. x-forwarded-for is caller-appendable, but reverse proxies APPEND
// (never prepend) the real client address, so the LAST entry is the one closest
// to us and the hardest for a caller to fake. Never trust the first entry.
export function clientKey(req: Request): string {
  const cfConnectingIp = req.headers.get('cf-connecting-ip');
  if (cfConnectingIp) {
    const trimmed = cfConnectingIp.trim();
    if (trimmed) return `ip:${trimmed}`;
  }

  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const parts = forwardedFor.split(',').map(p => p.trim()).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last) return `ip:${last}`;
  }

  return 'ip:unknown';
}

// Atomically bumps both the per-key and the 'global' counters via the
// att_register_password_attempt SQL function (single INSERT ... ON CONFLICT,
// no read-then-write race), BEFORE the caller compares the password. That way
// every attempt counts, not just failures. Returns whether this attempt is
// allowed to proceed to the compare: false when the RPC errors (fail closed)
// or when the returned locked_until is now in the future.
export async function registerAttempt(supabase: any, key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc('att_register_password_attempt', { p_key: key });

    if (error) {
      console.error('passwordThrottle.registerAttempt rpc error:', error);
      return false; // fail closed
    }

    if (!data) return true;

    return new Date(data).getTime() <= Date.now();
  } catch (error) {
    console.error('passwordThrottle.registerAttempt unexpected error:', error);
    return false; // fail closed
  }
}

export async function recordSuccess(supabase: any, key: string): Promise<void> {
  try {
    // Only the per-key row clears on success. The 'global' row never does:
    // one caller succeeding should not reset the shared cross-client cap.
    const { error } = await supabase
      .from('att_password_attempts')
      .delete()
      .eq('attempt_key', key);

    if (error) {
      console.error('passwordThrottle.recordSuccess delete error:', error);
    }
  } catch (error) {
    console.error('passwordThrottle.recordSuccess unexpected error:', error);
  }
}
