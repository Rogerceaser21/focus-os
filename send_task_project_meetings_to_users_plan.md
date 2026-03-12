# Share & Assign: Tasks, Projects & Meetings

## Overview

Allow users to share individual tasks, whole projects (with all tasks), and meetings (with action items) to other users. If the recipient has a Focus OS account, they receive an in-app invitation to accept or decline. If not, they receive an email via Resend.

---

## Database

### New Table: `focusos_shared_items`

| Column              | Type      | Notes                                              |
|---------------------|-----------|----------------------------------------------------|
| `id`                | uuid (PK) | Default `gen_random_uuid()`                        |
| `sender_user_id`    | uuid      | FK → `auth.users(id)`, the person sharing          |
| `recipient_email`   | text      | Email of the person receiving the share             |
| `recipient_user_id` | uuid?     | FK → `auth.users(id)`, resolved if they have an account |
| `item_type`         | text      | `'task'` \| `'project'` \| `'meeting'`             |
| `item_id`           | uuid      | ID of the shared task / project / meeting           |
| `status`            | text      | `'pending'` \| `'accepted'` \| `'declined'`        |
| `created_at`        | timestamptz | Default `now()`                                   |
| `updated_at`        | timestamptz | Default `now()`                                   |

- RLS: Users can read rows where they are sender OR recipient.
- RLS: Users can insert rows where they are the sender.
- RLS: Recipients can update status (accept/decline).

---

## Edge Function: `focusos-share-item`

**Input:** `{ itemType, itemId, recipientEmail }`

**Logic:**

1. Authenticate the sender (JWT).
2. Verify the sender owns the item (task/project/meeting).
3. Look up `recipientEmail` in `focusos_users` to resolve `recipient_user_id`.
4. Insert row into `focusos_shared_items` with status `'pending'`.
5. If recipient has an account → they'll see it in their in-app inbox (no email needed initially, or optional notification email).
6. If recipient does NOT have an account → send an email via Resend with a summary of the shared item.

---

## Edge Function: `focusos-accept-shared-item`

**Input:** `{ sharedItemId }`

**Logic:**

1. Authenticate the recipient (JWT).
2. Fetch the `focusos_shared_items` row, verify recipient matches.
3. Update status to `'accepted'`.
4. Clone the item into the recipient's data:
   - **Task:** Insert a copy of the task into `focusos_tasks` with the recipient's `user_id`. Reset timer, status → `'todo'`.
   - **Project:** Insert a copy of the project into `focusos_projects`, then clone all tasks belonging to that project.
   - **Meeting:** Insert a copy of the meeting into `focusos_meetings` with the recipient's `user_id`. Optionally clone action items as tasks.

---

## UI Changes

### 1. Share Dialog (upgrade existing `AssignTaskDialog`)

- Rename/extend to support tasks, projects, and meetings.
- Input: recipient email.
- Dropdown or context: select what to share (task, project, meeting).
- Calls `focusos-share-item` edge function.

### 2. Inbox / Notifications

- New UI section (could be a bell icon / sidebar panel / dedicated page).
- Shows pending shared items with:
  - Sender name/email
  - Item type & title
  - Accept / Decline buttons
- On accept → calls `focusos-accept-shared-item`, item appears in their tasks/projects/meetings.
- On decline → updates status, item disappears from inbox.

### 3. Sharing from Projects & Meetings pages

- Add a share button on project cards and meeting detail pages.
- Same share dialog, just pre-filled with the correct item type and ID.

---

## Implementation Order

1. **Database migration** — Create `focusos_shared_items` table with RLS policies.
2. **Edge function: `focusos-share-item`** — Share logic + Resend fallback.
3. **Edge function: `focusos-accept-shared-item`** — Accept + clone logic.
4. **UI: Share Dialog** — Upgrade `AssignTaskDialog` or create new universal share dialog.
5. **UI: Inbox** — Pending invitations UI with accept/decline.
6. **UI: Share buttons** — Add share entry points on projects & meetings.

---

## Open Questions

- Should sharing a project also share future tasks added to it (live sync), or is it a one-time snapshot clone?
- Should the original sender see when items are accepted/declined?
- Should we keep the existing "email-only" assign flow (`focusos-send-task-email`) as a separate action, or merge it into this system?
- Do we want push/browser notifications for new shares, or just the in-app inbox?
