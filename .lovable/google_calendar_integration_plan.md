# Google Calendar Integration — Implementation Plan

## Decisions locked
- Auth: **Option B** — separate "Connect Google Calendar" button in Settings (own OAuth flow, Calendar scope only). Independent of Focus OS login method.
- Direction: **v1 = one-way push** (Focus OS → Google). Updates + deletes propagate. No pull-from-Google in v1 (except availability/overlay read).
- Default calendar: **auto-create a dedicated "Focus OS" calendar** on first connect so events are easy to toggle off in Google.
- Meeting attendee invites: **included in v1**.
- Gantt overlay (Google events as faint background bars): **included in v1**.
- Per-task UI: **Option C** — small calendar icon in TaskCard action row AND a dedicated field inside Add/Edit Task dialog.
- AI scheduling assistant: **deferred** — will be done later via the MCP server.

## Schema additions

```sql
-- Tokens
create table public.focusos_google_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  scope text not null,
  focusos_calendar_id text,            -- the dedicated "Focus OS" Google calendar id
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- grants: authenticated (own row), service_role full. RLS scoped to auth.uid().

-- Link tasks/meetings to Google events
alter table public.focusos_tasks    add column google_calendar_event_id text;
alter table public.focusos_meetings add column google_calendar_event_id text;
```

## Edge functions (new)
1. `focusos-google-oauth-start` — returns Google consent URL with state token.
2. `focusos-google-oauth-callback` — exchanges code → tokens, upserts into `focusos_google_tokens`, auto-creates "Focus OS" calendar, stores its id.
3. `focusos-google-disconnect` — revokes token, deletes row, nulls `google_calendar_event_id` on tasks/meetings.
4. `focusos-push-to-calendar` — input `{ taskIds?, meetingIds?, projectId?, attendees? }`. Refreshes token if expired. Calls `events.insert`/`patch`/`delete`. Stores returned eventId.
5. `focusos-get-google-availability` — input `{ date or range }`. Calls `freebusy.query` against user's primary + Focus OS calendars. Returns busy blocks (used by Gantt overlay + availability popover).

Secrets needed: `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. (Standard OAuth, not the connector — per-user tokens.)

## Frontend changes
- **SettingsDialog → new "Integrations" section**: Connect / Disconnect button, status pill, last sync timestamp.
- **TaskCard**: small calendar icon button (ghost) next to Share. Tooltip: "Send to Google Calendar". Filled state when synced.
- **AddTaskDialog / EditTaskDialog**: checkbox "Add to Google Calendar" + (if checked) optional attendees email chips.
- **MeetingDetail / Meetings list**: "Send invite to attendees" button (uses meeting's attendee list).
- **GanttChart**:
  - "Sync project to Google Calendar" bulk button.
  - Faint background bars showing Google busy blocks (toggleable).
  - Per-day availability popover from a clock icon in the day header.
- **Visual badge** (small Google "G" dot) on linked tasks/meetings.

## Sync rules (v1)
- Push on user action only (no auto-push of every new task).
- On task update (title/dates/desc) → patch Google event if linked.
- On task delete or unsync → delete Google event.
- On disconnect → leave existing Google events in place but clear local linkage.
- Meeting events: include attendees + send invites via `sendUpdates=all`.

## Build order (when approved)
1. Migration (tokens table + task/meeting columns + grants + RLS).
2. Set Google OAuth secrets.
3. Edge functions: oauth-start, oauth-callback, disconnect.
4. Settings UI "Integrations" with Connect/Disconnect.
5. push-to-calendar edge function + TaskCard icon + Add/Edit Task field.
6. Meetings invite flow.
7. get-google-availability + Gantt overlay + availability popover.

Status: **PLAN ONLY — awaiting user approval before any code.**
