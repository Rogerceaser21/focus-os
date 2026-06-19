# Calendar Availability Scheduler — Implementation Plan

Goal: when scheduling a task to a calendar (own or recipient's) or sharing a task/meeting/project, show the target person's actual Google Calendar day — busy blocks + free slots — so the sender clicks a free window instead of guessing.

## 1. Backend: FreeBusy edge function

New function: `focusos-calendar-freebusy`.

Inputs:
```ts
{ targetUserId: string, date: string /* YYYY-MM-DD */, timeZone: string, durationMinutes?: number }
```

Logic:
1. Verify caller JWT.
2. Authorization: caller must be `targetUserId` OR share a project/share relationship with them (reuse existing share/membership checks). Otherwise 403.
3. Load target user's stored Google tokens from `focusos_google_tokens` (service role). If missing → return `{ connected: false }`.
4. Refresh token if expired.
5. POST `https://www.googleapis.com/calendar/v3/freeBusy` with `timeMin`/`timeMax` = that date 00:00–24:00 in `timeZone`, `items: [{ id: 'primary' }]`.
6. Compute free windows = inverse of busy within working hours (default 08:00–20:00, configurable later).
7. Return:
```ts
{
  connected: true,
  date, timeZone,
  busy:  [{ start, end, summary? }],   // summary only if same user (privacy)
  free:  [{ start, end, durationMinutes }],
  suggested: [{ start, end }]          // free slots >= durationMinutes
}
```

Privacy: for cross-user lookups, never return event titles — only busy/free blocks.

## 2. Frontend: `<AvailabilityScheduler />` component

Reusable component replacing the current blind date/time picker.

Layout (matches the ASCII mock):
```text
┌─────────────────────────────────────────┐
│ [< prev]   Tuesday, Jun 16   [today][>] │
├─────────────────────────────────────────┤
│ 08:00  ░░ free                          │
│ 09:00  ▓▓ Standup (30m)  ← from Google  │
│ 10:00  ░░ free  ← 90 min gap            │
│ 11:00  ░░ free                          │
│ 12:00  ▓▓ Lunch w/ Sam                  │
│ 13:00  ▓▓ ...                           │
│ 14:00  ░░ free  ← 2 hr                  │
│ ...                                      │
├─────────────────────────────────────────┤
│ Free slots today:                       │
│  • 10:00–11:30 (1h30)   [pick]          │
│  • 14:00–16:00 (2h)     [pick]          │
│  • 17:00–18:00 (1h)     [pick]          │
└─────────────────────────────────────────┘
```

Behavior:
- Loads via TanStack Query: `useFreeBusy(targetUserId, date, tz, duration)`.
- Day grid: hour rows 06:00–22:00, busy blocks rendered as filled bars with title (own calendar) or "Busy" (others).
- Free slots list below the grid — click "pick" → fills start/end in parent form.
- Duration input controls suggested-slot filter.
- Prev / Today / Next day navigation.
- States: loading skeleton, `not_connected` (target hasn't linked Google), error with retry.

## 3. Integration points

Replace/augment the current pickers in:

a) **`GoogleCalendarButton` dialog** (own calendar placement) — targetUserId = current user.
b) **`ShareItemDialog`** — when "Add to recipient calendar" is on:
   - If single recipient → show their availability.
   - If multiple recipients → show each in tabs, OR overlay busy from all (mark slots free only if free for everyone).
   - If recipient not Google-connected → fallback to manual picker + ICS in email.
c) **Meeting create/edit** — optional: show own availability when picking meeting time.

## 4. Data / schema

No new tables required for availability itself (live API). Existing `focusos_google_tokens` reused.

For share calendar placement, the previously-approved fields on `focusos_shared_items` still apply (`calendar_enabled`, `calendar_status`, `calendar_event_id`, `calendar_start_at`, `calendar_end_at`, `calendar_all_day`, `calendar_error`).

## 5. Files to add / edit

New:
- `supabase/functions/focusos-calendar-freebusy/index.ts`
- `src/components/calendar/AvailabilityScheduler.tsx`
- `src/hooks/useFreeBusy.ts`

Edit:
- `src/components/GoogleCalendarButton.tsx` — swap picker for AvailabilityScheduler.
- `src/components/ShareItemDialog.tsx` — add calendar section using AvailabilityScheduler.
- `supabase/functions/focusos-share-item/index.ts` — accept calendarPlacement, create event on recipient calendar via service-role token lookup.
- `supabase/functions/focusos-push-to-calendar/index.ts` — already consumes `calendarPlacement`; no change.

## 6. Rollout order

1. FreeBusy edge function + auth checks.
2. `useFreeBusy` hook + `AvailabilityScheduler` component (wire to own calendar first).
3. Integrate into `GoogleCalendarButton` (own calendar) — verify end-to-end.
4. Integrate into `ShareItemDialog` for single recipient.
5. Multi-recipient overlay.
6. Meeting time-picker integration (optional, after sign-off).

## 7. Open questions before I build

1. Working-hours window default — 08:00–20:00 ok, or pull from a user setting?
2. Multi-recipient: per-tab view OR intersected free slots (or both)?
3. For recipients without Google connected — send ICS in email, or block "add to calendar" entirely?

Awaiting approval before any code changes.
