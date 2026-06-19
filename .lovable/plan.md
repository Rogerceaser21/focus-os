# Calendar Slot Picker — v2 Plan

Make the in-dialog availability scheduler behave like Google Calendar's day view, with 12-hour times, click-to-schedule, scrollable grid, and a fast date jump.

## Confirmed decisions
- A. Clicking a slot **fills the form fields** (date, start time, duration) — user can still tweak before confirming with "Add to calendar".
- B. Default duration when clicking an empty slot = **30 min** (existing duration field still adjustable; quick chips 15 / 30 / 45 / 60 / 90).
- C. Visible working window = **7:00 AM – 6:00 PM**, but the grid scrolls 6:00 AM – 10:00 PM so early/late slots are reachable.
- D. All times shown in **12-hour format with AM/PM** (e.g. "2:30 PM"), never 14:30.

## 1. Scrollable day grid
- Wrap the grid in a fixed-height scrollable container (≈ 420px desktop, ≈ 320px mobile) using `ScrollArea`.
- Auto-scroll on open to the working-window start (7 AM) or to current time if today.
- Hour rows render full 6 AM–10 PM range; busy blocks positioned absolutely as before.

## 2. Date picker in the day-nav header
- Replace static date label with a button → `Popover` containing the shadcn `Calendar`.
- Keep `<` / `today` / `>` controls beside it.
- Selecting a date in the popover updates the day and re-fetches availability.

## 3. Click-to-schedule interaction
- The grid becomes click/tap aware. Clicking any empty time → snaps to nearest 15 min, creates a tentative 30-min block visualized as a highlighted overlay.
- On click: fills parent form's `date`, `startTime`, `duration` (only sets duration if user hasn't manually changed it from default).
- Clicking an existing **suggested free slot chip** still works (one-tap → full slot fills form).
- Tapping a busy block does nothing (with subtle shake / toast "busy").

## 4. 12-hour AM/PM formatting everywhere
- Replace `Intl.DateTimeFormat("en-GB", hour12:false)` with `hour12:true`.
- Hour-line labels: "7 AM", "8 AM", … "12 PM", "1 PM", … "10 PM".
- Free-slot chips: "2:00 PM – 3:30 PM (1h30)".
- Day header: "Friday, Jun 19".
- Start time input stays as native `<input type="time">` (browser locale handles display) — no change needed for input.

## 5. Mobile + desktop responsiveness
- Dialog: keep `sm:max-w-md` on desktop, switch to full-width sheet-like layout on mobile (`max-w-[95vw]`, `max-h-[90vh]`, internal scroll).
- Grid hour-label gutter narrower on mobile (`w-10` vs `w-14`).
- Touch targets ≥ 32px high per hour row.
- Verify with Playwright at 390×844 (mobile) and 1280×900 (desktop) — screenshot grid scroll, date popover, click-to-fill, AM/PM labels.

## 6. Files to edit
- `src/components/calendar/AvailabilityScheduler.tsx` — scroll wrapper, header date-picker popover, click handler, 12h labels, click-overlay state.
- `src/components/GoogleCalendarButton.tsx` — pass `onPick(start, end)` that fills date+startTime+duration; remove now-redundant date popover above the scheduler (date lives inside scheduler header); keep manual time/duration fields for fine-tuning.
- No backend changes (function already returns ISO times).

## 7. Out of scope (later)
- Drag to resize the tentative block.
- Multi-recipient overlay.
- User-configurable working hours.

Awaiting your approval before I touch any code.
