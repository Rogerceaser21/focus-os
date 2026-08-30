# Plan: Apply two edge-function bug fixes

## Goal
Apply two pre-reviewed, surgical diffs from the `redesign/liquid-glass` branch to the live edge functions and redeploy them. No other files, schema changes, or frontend work.

## Changes

### 1. `supabase/functions/focusos-share-item/index.ts` — fix O10
In the idempotency lookup on `focusos_shared_items`, exclude rows whose `status` is `cancelled`, order by `created_at` descending, and limit to 1. This prevents reusing a cancelled share row (which would silently report success while sharing nothing) and keeps `.maybeSingle()` safe when multiple cancelled history rows exist.

Exact replacement block:
```typescript
    // Idempotency: reuse an existing shared item if a NON-cancelled one already
    // exists for the same sender + recipient + item. A cancelled row must never
    // be reused - reusing it would keep the row (and the share) permanently
    // cancelled while the function still reports success, silently sharing
    // nothing (O10). Cancelled rows are left untouched as history; every share
    // surface filters them out (appDataFetchers.ts loadSharedItems and
    // fetchSenderSharedItemsRaw, MeetingDetail's fetchSharingInfo; the
    // ShareItemDialog suggestion query is unfiltered but deduped per email,
    // so history there only feeds autocomplete). Multiple cancelled rows can accumulate
    // for the same sender+recipient+item over time, so `.maybeSingle()` alone
    // would throw on >1 match - order + limit(1) keeps this single-row-safe.
    const { data: existing } = await supabaseUser
      .from("focusos_shared_items")
      .select("id, action_token")
      .eq("sender_user_id", senderId)
      .eq("recipient_email", normalizedRecipient)
      .eq("item_type", itemType)
      .eq("item_id", itemId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
```

### 2. `supabase/functions/focusos-mcp/index.ts` — fix O11
In the `archive_project` tool handler, clear `pinned_at` when archiving a project and its cascaded sub-projects. This mirrors the app's `handleArchiveProject` and prevents archived projects from holding one of the 5 pin slots.

Exact replacement block:
```typescript
    // CASCADE (mirrors the app's handleArchiveProject): a top-level project and
    // its subs go together in ONE statement; a sub goes alone.
    // pinned_at goes with it (O11, mirrors handleArchiveProject in Index.tsx):
    // an archived project leaves the drawer's active list entirely, so leaving
    // it pinned would hold a slot of the 5-pin cap that nothing on screen can
    // show or release - the exact leak that let a restore land a 6th pin.
    let q = admin
      .from("focusos_projects")
      .update({ archived_at: new Date().toISOString(), pinned_at: null })
      .eq("user_id", userId);
```

## Deployment
Redeploy both edge functions after applying the diffs.

## Verification
- `git diff` shows only the two files above changed.
- `focusos-share-item`: re-sharing to a recipient whose only existing row is cancelled creates a new pending row and leaves the cancelled row untouched.
- `focusos-mcp`: `archive_project` clears `pinned_at` on the archived project and its cascaded sub-projects.
