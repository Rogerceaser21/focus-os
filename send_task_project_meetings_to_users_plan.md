# Share & Assign: Tasks, Projects & Meetings

## Overview

Allow users to share individual tasks, whole projects (with all tasks), and meetings (with action items) to other users. **ALL recipients receive an email notification via Resend**, regardless of whether they have a Focus OS account or not. If the recipient has an account, they also see the shared item in-app.

---

## Database

### New Table: `focusos_shared_items`

| Column              | Type      | Notes                                              |
|---------------------|-----------|----------------------------------------------------|
| `id`                | uuid (PK) | Default `gen_random_uuid()`                        |
| `sender_user_id`    | uuid      | FK → `auth.users(id)`, the person sharing          |
| `sender_email`      | text      | Email of the sender (for display to recipient)      |
| `sender_name`       | text?     | Name of the sender (resolved from profile if available) |
| `recipient_email`   | text      | Email of the person receiving the share             |
| `recipient_user_id` | uuid?     | FK → `auth.users(id)`, resolved if they have an account |
| `item_type`         | text      | `'task'` \| `'project'` \| `'meeting'`             |
| `item_id`           | uuid      | ID of the shared task / project / meeting           |
| `item_title`        | text      | Title of the shared item (denormalized for display) |
| `project_name`      | text?     | If item is a task belonging to a project, include the project name here (even if the project itself is not shared) |
| `status`            | text      | `'pending'` \| `'accepted'` \| `'declined'`        |
| `created_at`        | timestamptz | Default `now()`                                   |
| `updated_at`        | timestamptz | Default `now()`                                   |

- RLS: Users can read rows where they are sender OR recipient.
- RLS: Users can insert rows where they are the sender.
- RLS: Recipients can update status (accept/decline).

---

## Email Notifications

**All recipients get an email notification via Resend — account holders AND non-account holders alike.** The email includes:
- Sender name/email
- Item type (task, project, or meeting)
- Item title
- Project name (if the item is a task within a project)
- A link to accept/view in Focus OS (for account holders) or a summary (for non-account holders)

---

## Edge Function: `focusos-share-item`

**Input:** `{ itemType, itemId, recipientEmail }`

**Logic:**

1. Authenticate the sender (JWT).
2. Verify the sender owns the item (task/project/meeting).
3. Resolve sender name/email from `focusos_profiles` and `focusos_users`.
4. If item is a task, look up its `project_id` and resolve the project name from `focusos_projects`.
5. Look up `recipientEmail` in `focusos_users` to resolve `recipient_user_id`.
6. Insert row into `focusos_shared_items` with status `'pending'`, including `sender_email`, `sender_name`, `item_title`, and `project_name`.
7. **Always send an email via Resend** to the recipient with the item details, regardless of whether they have an account.

---

## Edge Function: `focusos-accept-shared-item`

**Input:** `{ sharedItemId }`

**Logic:**

1. Authenticate the recipient (JWT).
2. Fetch the `focusos_shared_items` row, verify recipient matches.
3. Update status to `'accepted'`.
4. Clone the item into the recipient's data:
   - **Task:** Insert a copy of the task into `focusos_tasks` with the recipient's `user_id`. Reset timer, status → `'todo'`. Preserve the `sender_email`/`sender_name` so the recipient knows who assigned it.
   - **Project:** Insert a copy of the project into `focusos_projects`, then clone all tasks belonging to that project.
   - **Meeting:** Insert a copy of the meeting into `focusos_meetings` with the recipient's `user_id`. Optionally clone action items as tasks.

---

## UI Changes

### 1. Share Dialog (upgrade existing `AssignTaskDialog`)

- Rename/extend to support tasks, projects, and meetings.
- Input: recipient email.
- Dropdown or context: select what to share (task, project, meeting).
- Calls `focusos-share-item` edge function.

### 2. "Shared Items" Section in Sidebar

- **Location:** Sits directly above the "My Projects" section in the `ProjectSidebar`.
- **Name:** "Shared Items"
- **Content:** Lists all items where the current user is the recipient (from `focusos_shared_items` with status `'pending'` or `'accepted'`).
- **Differentiation:** Each item clearly shows:
  - Item type icon/badge (task, project, or meeting)
  - Item title
  - Project name (if the item is a task within a project, even if the full project wasn't shared)
  - Sender name or email (so the recipient knows who shared it)
- **Pending items:** Show accept/decline buttons inline or via a detail view.
- **Accepted items:** Clicking navigates to the cloned item in the user's own data.

### 3. Sender Attribution on Shared Items

- When a user accepts a shared task, the task card/detail should display the sender's name or email (e.g., "Shared by john@example.com") so the recipient always knows who the task belongs to originally.

### 4. Sharing from Projects & Meetings pages

- Add a share button on project cards and meeting detail pages.
- Same share dialog, just pre-filled with the correct item type and ID.

---

## Implementation Order

1. **Database migration** — Create `focusos_shared_items` table with RLS policies.
2. **Edge function: `focusos-share-item`** — Share logic + always send Resend email.
3. **Edge function: `focusos-accept-shared-item`** — Accept + clone logic.
4. **UI: Share Dialog** — Upgrade `AssignTaskDialog` or create new universal share dialog.
5. **UI: Shared Items in Sidebar** — Add "Shared Items" section above "My Projects" with pending/accepted items.
6. **UI: Sender attribution** — Show sender info on shared task cards.
7. **UI: Share buttons** — Add share entry points on projects & meetings.

---

## Open Questions

- Should sharing a project also share future tasks added to it (live sync), or is it a one-time snapshot clone?
- Should the original sender see when items are accepted/declined?
- Should we keep the existing "email-only" assign flow (`focusos-send-task-email`) as a separate action, or merge it into this system?
- Do we want push/browser notifications for new shares, or just the in-app sidebar section?
