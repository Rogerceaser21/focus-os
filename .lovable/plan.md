# Google Calendar v1 — Schedule Dialog + My Day Availability

No AI. No MCP. Pure Google Calendar APIs (`events.insert/patch/delete`, `events.list`, `freebusy.query`) using the OAuth token from the existing Connect button.

---

## Part A — "Schedule on Google Calendar" dialog (fixes the silent-push bug)

### Trigger
Clicking the Google Calendar icon on a Task / Meeting / Gantt bar, or the bulk "Sync to Google" button, **opens a confirmation dialog instead of firing instantly**.

### Dialog fields (smart defaults pre-filled, user can edit)
- **Date** — shadcn Calendar picker. Default: task `dueDate` else today.
- **Start time** — `<Input type="time">`. Default: task `time` else next rounded :30.
- **Duration** — Select (15/30/45/60/90/120/Custom) + **All-day** toggle. Default: `estimatedMinutes` else 30.
- **Title** — text. Default: task title.
- **Notes** — textarea. Default: task description.
- **Whose calendar** — RadioGroup:
  - `Their calendar` (default if task assigned/shared to another Focus OS user with Google connected)
  - `My calendar` (default otherwise)
  - `Invite as attendee (email)` — fallback when recipient hasn't connected Google
  - `Project calendar` — only shown if a project has a configured `calendarId` (future)
- **Attendees** — email chips, pre-filled from assignee/share recipients.
- **"Find a free slot"** button → opens the My Day panel (Part B) scoped to the chosen date; clicking a slot fills date+time.

### Bulk (Gantt "Sync to Google")
Compact list dialog: one row per task with editable date/time/duration/destination + an "Apply to all" header. One Confirm syncs them all.

### Edits after sync
Toggling the calendar icon off on a synced task → delete the Google event. Toggling on → reopen the dialog.

---

## Part B — "My Day" availability view (your new request)

### Where it opens from
1. New 📅 button on the RecordFAB radial.
2. Button on the Gantt header.
3. **"Find a free slot"** button inside the Schedule dialog (Part A).
4. Button in `EditTaskDialog` header.

### What it shows
Vertical day timeline (08:00–22:00 by default, scrollable for full 24h), compact:
- **Busy blocks** pulled from `events.list` on the user's primary + Focus OS calendars (titles shown for own calendar; just "Busy" for any calendar where we only have freeBusy access).
- **Free gaps** rendered as lighter rows with the gap length labelled (e.g. "90 min free").
- Header: `< prev | Today | next >` date nav + date picker.
- Footer list: "Free slots today: 10:00–11:30 (1h30), 14:00–16:00 (2h), …" — clickable.
- Clicking a free slot:
  - If opened standalone → opens **AddTaskDialog** prefilled with that start/end → on save, pushes to Google via Part A's dialog (skipping date/time step since they're already chosen).
  - If opened from Part A's "Find a free slot" → just fills date+time in that dialog and closes the panel.

### Data source
- `events.list` for own calendar (titles visible).
- `freebusy.query` for any additional calendars the user adds later (privacy-safe; this v1 only queries the primary + Focus OS calendars).

---

## Technical Implementation

### New components
- `src/components/ScheduleToCalendarDialog.tsx` — the Part A dialog.
- `src/components/CalendarSchedulerProvider.tsx` — single shared dialog state mounted in `App.tsx` so any button can call `openScheduler(items)`.
- `src/components/MyDayAvailability.tsx` — the Part B panel (Sheet on mobile, Dialog on desktop). Renders the timeline + free-slot list.

### Hook changes
- `src/hooks/useGoogleCalendar.ts`
  - Remove auto-push from `push()`. Replace with `openScheduler(items)`.
  - Add `getDayAvailability(date)` → calls new edge function `focusos-get-google-availability`, returns `{ busy: [{start,end,title?}], free: [{start,end,minutes}] }`.

### Edge functions
- **Extend** `supabase/functions/focusos-push-to-calendar/index.ts`:
  - Accept `startDateTime`, `endDateTime`, `allDay+date`, `destination: "self"|"recipient"|"attendees"|"project"`, `attendees: string[]`, `title?`, `description?`, `calendarId?`.
  - Use those explicit values instead of deriving from the task row.
  - When `destination==="recipient"` and recipient has no token → return 409 so UI offers attendee-invite fallback.
- **New** `supabase/functions/focusos-get-google-availability/index.ts`:
  - Input: `{ date: "YYYY-MM-DD", timeMin?, timeMax?, calendarIds?: string[] }`.
  - Calls `events.list` for own calendar(s) (titles) + `freebusy.query` for any extra.
  - Computes free gaps server-side (>= 15 min) and returns combined `{busy, free}` for that day.

### Integration points (replace direct `push` with `openScheduler`)
`TaskListItem.tsx`, `TaskCard.tsx`, `EditTaskDialog.tsx`, `GanttChart.tsx`, `MeetingDetail.tsx`, `GoogleCalendarButton.tsx`.

### Database
No schema changes for v1. (Optional later: SECURITY DEFINER `focusos_google_connected(uuid)` boolean so the dialog can label recipients "✓ has calendar".)

---

## Explicitly out of scope (v2+)
- AI slot-finder ("find 3 hours this week, avoid mornings").
- AI day summary.
- Auto-reschedule low-priority tasks.
- Pulling Google events as background bars in the Gantt (separate task).
- Project-linked calendars UI.

---

## Files to create / edit
- **Create**: `ScheduleToCalendarDialog.tsx`, `CalendarSchedulerProvider.tsx`, `MyDayAvailability.tsx`, `supabase/functions/focusos-get-google-availability/index.ts`
- **Edit**: `useGoogleCalendar.ts`, `GoogleCalendarButton.tsx`, `App.tsx`, `TaskListItem.tsx`, `TaskCard.tsx`, `EditTaskDialog.tsx`, `GanttChart.tsx`, `MeetingDetail.tsx`, `RecordFAB.tsx`, `supabase/functions/focusos-push-to-calendar/index.ts`

Reply **"approved"** and I'll build the whole v1 in one pass.
