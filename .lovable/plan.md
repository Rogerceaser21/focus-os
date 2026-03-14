

## Updated Plan: Multi-Person Sharing with Autocomplete

### 1. Share Dialog Redesign (`ShareItemDialog.tsx`)

**Recipient input with autocomplete dropdown:**
- As the user types in the email field, query `focusos_profiles` (all users) and `focusos_shared_items` (past recipients for this sender) to show matching suggestions
- Dropdown appears below the input showing: avatar initial + name + email, with a "Focus OS user" indicator
- Clicking a suggestion or pressing Enter adds them to the recipient list
- Debounced search (300ms) to avoid excessive queries

**Visible recipient list below the input:**
- Each added recipient appears as a row: `[Avatar] Jane Smith (jane@example.com) [✓ FocusOS] [×]`
- Non-users show without the indicator
- "×" button removes them from the list
- Label: "Recipients (3)" updates dynamically
- Input clears after each addition, stays focused

**Share button:**
- "Share with 3 people" — count in the button text
- Loops through recipients, calls `focusos-share-item` once per person
- Progress feedback: shows how many sent successfully

**Data sources for autocomplete (queried on dialog open):**
- `focusos_profiles` — all app users (already readable via existing RLS policy)
- `focusos_shared_items` where `sender_user_id = auth.uid()` — past recipients (deduped by email)
- Merged and deduped, sorted: recent contacts first, then alphabetical

No new RPC needed — the existing `focusos_authenticated_can_view_all_profiles` policy covers the lookup. No `focusos_check_user_exists` RPC needed either, since we already have the full profile list client-side for autocomplete.

### 2. Share Status Popover (unchanged from previous plan)

- Purple badge text: "Shared Task" / "Shared Project" / "Shared Meeting"
- Clickable — opens a `Popover` showing all recipients and their status
- New component: `ShareStatusPopover.tsx`
- `senderSharedMap` in Index.tsx changes from `Record<string, string>` to `Record<string, Array<{email, name, status}>>`

### 3. Files to change

| File | Change |
|------|--------|
| `src/components/ShareItemDialog.tsx` | Full redesign: autocomplete input + recipient list + multi-send |
| `src/components/ShareStatusPopover.tsx` | **New** — popover content showing recipient statuses |
| `src/components/TaskCard.tsx` | Clickable badge + popover |
| `src/components/TaskListItem.tsx` | Clickable badge + popover |
| `src/pages/Index.tsx` | Update `senderSharedMap` to array structure |
| `src/pages/MeetingDetail.tsx` | Clickable badge + popover for meetings |

No backend/edge function changes. No new database functions. No migrations needed.

