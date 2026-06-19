## The bug

Clicking the calendar icon in `GoogleCalendarButton` calls `push({ taskIds, action: 'sync' })` immediately. No date/time/duration/destination is sent, so the edge function falls back to an **all-day event on today's date in the developer's primary calendar** — which is why it shows up at the top of the day with no warning.

## The fix (V1 — scope: the icon button only)

Replace the silent push with a confirmation dialog. Same icon, same places — but clicking opens a small picker first. Nothing else in the app changes.

### 1. New component: `ScheduleToCalendarDialog.tsx`

A compact dialog with these fields, pre-filled from the task:

- **Date** — defaults to task `dueDate`, else today
- **Start time** — defaults to task `time`, else next rounded :30
- **Duration** — defaults to task `estimatedMinutes`, else 30 min  
  (quick chips: 15 / 30 / 60 / 90 min + custom)
- **All-day** toggle — if on, hides time/duration
- **Destination** (RadioGroup):
  - `My calendar` (default when task has no assignee)
  - `[Assignee name]'s calendar` (default when task is shared/assigned to another user who has Google connected — resolved via `focusos_google_tokens` lookup)
  - `Invite [assignee email] as attendee` (fallback when assignee has no Google connected)
- **Title** — defaults to task title (editable)
- **Notes** — defaults to task description (editable)

Buttons: `Cancel` / `Add to calendar`.

### 2. Wire the button

`GoogleCalendarButton.handle()` no longer calls `push()` directly:
- If `synced === false` → open `ScheduleToCalendarDialog`. On confirm → call `push()` with the full payload.
- If `synced === true` → keep current behavior (unsync / delete event).

That's it for the UI. No changes to `TaskListItem`, `TaskCard`, `EditTaskDialog`, `MeetingDetail` — they already pass `taskId` into `GoogleCalendarButton`.

### 3. Edge function: extend `focusos-push-to-calendar`

Accept new optional fields on the `sync` action:

```
startDateTime, endDateTime   // ISO strings, used when not all-day
allDay, date                 // when all-day
destination                  // 'me' | 'recipient' | 'attendee'
recipientUserId              // for 'recipient' — use that user's google token
attendees                    // for 'attendee' — invite via my calendar
title, description           // overrides
```

Behavior:
- `destination=me` → insert on my `primary`
- `destination=recipient` → use recipient's token from `focusos_google_tokens`; if none → return 409 so UI can fall back to attendee invite
- `destination=attendee` → insert on my `primary` with `attendees: [...]` and `sendUpdates: 'all'`
- Only fall back to all-day if `allDay === true`. Never silently default to all-day again.

### Out of scope for V1 (do later)
- "My Day" availability view / free-slot picker
- Project-linked calendars
- AI slot suggestions
- Bulk "apply to all" dialog

---

**Awaiting your explicit approval before I touch any code.**
