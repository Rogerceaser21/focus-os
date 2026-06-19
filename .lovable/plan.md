## What I understand you want

1. **Remove the "Suggested free slots" chip section** under the day grid — redundant now.
2. **Add a Google-Calendar-style red "now" line** across the grid at the current time. On open, auto-scroll so the red line sits in the **middle** of the visible area (only when the displayed day is today; otherwise scroll to working-hours start as today).
3. **Search-and-add attendees by name/email** — exactly like Google Calendar's "Add guests" box. Type a name → autocomplete suggestions from your org (Focus OS profiles) → pick → their availability overlays on the same day grid. Free-text emails outside the org are also accepted (they just get an invite, no busy data).
4. **Bug fix**: Clicking the day-nav arrows (◀ / ▶) currently closes the "Add to Google Calendar" dialog. Keep the dialog open on day changes.

## How I'll implement

### A. Hide suggested slots
- `AvailabilityScheduler.tsx`: delete the entire "Suggested free slots" block (the bottom section rendering `data.suggested`). Keep the day grid + helper text only.

### B. Red "now" line + center-on-open
- In `AvailabilityScheduler.tsx`:
  - Add a `now` state that ticks every 60s via `setInterval` (cleared on unmount).
  - If `sameLocalDay(now, day, tz)`, render a 2px red line absolutely positioned at `top = ((now.getHours()+now.getMinutes()/60) - gridStartHour) * HOUR_HEIGHT`, with a small red dot on the left.
  - Replace current auto-scroll effect: if today, scroll so the red line is centered in the viewport (`scrollTop = nowTop - viewportHeight/2`); else keep scrolling to working-hours start.

### C. Bug fix — dialog closing on arrow click
- Root cause: the chevron `Button`s inside the scheduler don't stop propagation, and the parent `DialogContent` only stops clicks at its own boundary. The real issue is Radix `Dialog` interpreting some interaction as outside-close, OR the parent form re-rendering and unmounting the scheduler.
- Fixes:
  - Add `e.stopPropagation()` and `type="button"` to the prev/next/today buttons and the date-picker `PopoverTrigger`.
  - In `GoogleCalendarButton.tsx`, ensure `setDate` from the scheduler doesn't trigger anything that closes the dialog (it currently only updates state, but I'll double-check by isolating `date` state and not re-deriving `defaultDate` on each render).
  - Verify via Playwright after the change.

### D. Attendee search (Google-Calendar-style)
New component `src/components/calendar/AttendeePicker.tsx`:
- Combobox using shadcn `Command` + `Popover`.
- As user types ≥2 chars, query `focusos_profiles` for `full_name` / `email` ILIKE matches (limit 8). Show avatar + name + email rows (matches your picture 2 styling).
- On select: add a chip to a selected-attendees list (chips show avatar + name, with × to remove). The **first** internal attendee selected becomes the `targetUserId` whose calendar overlays on the grid (with a small "Viewing: <name>'s calendar" indicator + a "Switch" action if multiple). Plain-text emails (non-org) are also accepted on Enter; they're added as chips but don't overlay availability.
- Selected attendee emails flow into the existing `attendees` array passed to `push()` so Google Calendar sends invites.

Wiring in `GoogleCalendarButton.tsx`:
- Replace the current `attendees` prop pass-through with local `attendees` state initialized from prop.
- Render `<AttendeePicker value={attendees} onChange={setAttendees} onPrimaryTargetChange={setTargetUserId} />` above the scheduler.
- Pass `targetUserId` into `<AvailabilityScheduler targetUserId={targetUserId} ... />`. The freebusy edge function already accepts `targetUserId` and enforces auth.

### E. Mobile + desktop verification
- Playwright at 1280×1800 and 390×844:
  - Open dialog, scroll grid, click arrow (dialog stays open), pick date, type a name, select attendee, see overlay, click empty slot, confirm form fields filled.
  - Screenshot each.

### Files to touch
- `src/components/calendar/AvailabilityScheduler.tsx` — remove suggested slots, add now-line + centered scroll, stopPropagation on nav buttons.
- `src/components/calendar/AttendeePicker.tsx` — **new**.
- `src/components/GoogleCalendarButton.tsx` — wire attendee picker + targetUserId, ensure dialog stays open.
- No DB or edge-function changes (freebusy already supports targetUserId; profiles table already queryable).

### Open question
- For the attendee search source: I'll query `focusos_profiles` (your existing org directory). Confirm OK, or should I also include people you've shared items with who don't have a profile row yet?

Awaiting your approval before coding.