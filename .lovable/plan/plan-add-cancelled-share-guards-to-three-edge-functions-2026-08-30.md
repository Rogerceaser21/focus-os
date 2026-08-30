# Plan: Add cancelled-share guards to three edge functions

## Goal
Apply three verbatim guard insertions to Supabase edge functions so that a `focusos_shared_items` row with `status = 'cancelled'` can never be resurrected by an Accept or Decline action, whether from an old email link or a stale in-app drawer entry. Then redeploy the three functions. No other files, schema changes, migrations, or frontend work.

## Changes

### 1. `supabase/functions/focusos-shared-item-action/index.ts`
Insert immediately after the invalid-token check on line 32 and before the `update` object is built on line 34:

```typescript
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
```

### 2. `supabase/functions/focusos-accept-shared-item/index.ts`
Insert immediately after the recipient-authorization 403 block (ends line 75) and before the `const senderId = ...` line:

```typescript
    // O12 (in-app path, same class as the email-token guard in
    // focusos-shared-item-action): a cancelled row is history and must never
    // be resurrected by a stale drawer entry fetched before the sender
    // cancelled - accepting one would recreate the duplicate-recipient state
    // the O10/O12 fixes closed. Refuse without updating anything.
    if (sharedItem.status === "cancelled") {
      return new Response(JSON.stringify({ error: "This share was cancelled by the sender." }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
```

### 3. `supabase/functions/focusos-decline-shared-item/index.ts`
Insert the identical 12-line guard block immediately after the recipient-authorization 403 check (ends line 76) and before the status update on line 79.

## Deployment
Redeploy all three edge functions after applying the insertions.

## Verification
- `git diff` shows exactly the three function files changed, nothing else.
- `focusos-shared-item-action`: invoking with a token whose row is `cancelled` returns `{"ok":false,"title":"Link not valid","message":"This share was cancelled by the sender."}` and leaves the row untouched.
- `focusos-accept-shared-item`: returns HTTP 410 with no DB update when the target row is `cancelled`.
- `focusos-decline-shared-item`: returns HTTP 410 with no DB update when the target row is `cancelled`.
