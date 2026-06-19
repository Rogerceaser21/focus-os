# Google Calendar Push — Scheduling Dialog

## Understanding
Right now, clicking the calendar icon on a task silently fires the task to Google Calendar with whatever (or no) date/time we have. You want a confirmation step where you decide **what date, what time, how long, and whose calendar** the event lands on — every time the field is missing or ambiguous. If everything is already filled in sensibly, it still shouldn't go without a quick visible confirmation step.

## Behavior

### Trigger
Clicking the Google Calendar icon on a Task, Meeting, or Gantt bar (and the bulk "Sync to Google" button) opens a **Schedule on Google Calendar** dialog instead of immediately syncing.

### Smart defaults pre-filled in the dialog
- **Date**: task `dueDate` if set; else today.
- **Start time**: task `time` if set; else next rounded half-hour from now.
- **Duration**: task `estimatedMinutes` if set; else 30 min. (Toggle for All-day.)
- **Title**: task title. **Notes**: task description.
- **Calendar destination**: 
  - If the task is assigned to / shared with another Focus OS user → default is **that person's calendar** (only if they have Google connected and granted permission); fallback radio options shown.
  - Else → default is **My calendar** (Focus OS calendar).
  - Radio options always visible: `Their calendar` · `My calendar` · `Invite as attendee (email)` · `Project calendar` (if a project-linked calendar exists).
- **Attendees**: editable email chips, pre-filled from assignee/share recipients.

### Bulk (Gantt "Sync to Google")
Opens a compact list dialog showing each task row with editable date/time/duration/destination, plus a "Apply to all" header row. One confirm syncs them all.

### Edits after sync
If an already-synced task is toggled off → delete event. Toggled on again → reopen the dialog.

## Technical Implementation

### New component
`src/components/ScheduleToCalendarDialog.tsx`
- Props: `items: ScheduleItem[]`, `open`, `onOpenChange`, `onConfirm(scheduled: ScheduledItem[])`.
- Uses existing shadcn `Calendar` (date picker), `Input type="time"`, `Select` (duration: 15/30/45/60/90/120/Custom + All-day toggle), `RadioGroup` (destination), email chip input (reuse the one from share dialog).
- Resolves "recipient has Google connected" by querying `focusos_google_tokens` for the recipient `user_id` (RLS-safe public boolean read — see DB note).

### Hook changes
`src/hooks/useGoogleCalendar.ts`
- `push()` no longer auto-sends. Replace with `openScheduler(items)` that lifts a single shared dialog state via a lightweight context (`CalendarSchedulerProvider`) mounted once in `App.tsx`. Confirming the dialog calls the existing edge function with full payload.

### Edge function
`supabase/functions/focusos-push-to-calendar/index.ts`
- Already accepts `recipientUserId`. Extend payload schema:
  - `startDateTime`, `endDateTime` OR `allDay: true` + `date`
  - `destination: "self" | "recipient" | "attendees" | "project"`
  - `attendees: string[]`
  - `calendarId?: string` (for project calendars)
- When `destination === "recipient"`, look up recipient's token; if missing, return 409 → UI falls back to attendee invite.

### Integration points (replace direct `push` calls with `openScheduler`)
- `src/components/TaskListItem.tsx` (compact / full / minimal rows)
- `src/components/TaskCard.tsx`
- `src/components/EditTaskDialog.tsx` header button
- `src/components/GanttChart.tsx` (single + bulk)
- `src/pages/MeetingDetail.tsx`

### Database
No schema change required for v1. Optional: a `public.focusos_google_connected(user_id)` SECURITY DEFINER function so the UI can check recipient connection status without exposing tokens. Will add if needed.

### Out of scope (this round)
- Auto-sync on every edit (still manual via the dialog).
- Voice-created tasks auto-pushing — they'll prompt the scheduler the first time the calendar icon is pressed.
- Project-linked calendars: option will appear only when a project has a `calendarId` configured (UI to configure that comes later).

## Files to create / edit
- **Create**: `src/components/ScheduleToCalendarDialog.tsx`, `src/components/CalendarSchedulerProvider.tsx`
- **Edit**: `src/hooks/useGoogleCalendar.ts`, `src/components/GoogleCalendarButton.tsx`, `src/App.tsx`, `src/components/TaskListItem.tsx`, `src/components/TaskCard.tsx`, `src/components/EditTaskDialog.tsx`, `src/components/GanttChart.tsx`, `src/pages/MeetingDetail.tsx`, `supabase/functions/focusos-push-to-calendar/index.ts`

Approve and I'll build it.
