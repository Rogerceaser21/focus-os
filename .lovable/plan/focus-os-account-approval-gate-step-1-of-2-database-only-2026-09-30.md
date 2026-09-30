# Focus OS account-approval gate — Step 1 of 2 (database only)

## Goal
Add the approval-tracking table and helpers, and mark every account that already uses Focus OS as approved. Nothing is restricted yet — the lock itself is a separate later step.

## Precondition check (already done, read-only)
The live `public.focusos_handle_new_user_onboarding()` was read and confirmed to insert exactly:
- `Use the Purple microphone to add tasks to the Today's to do list.`
- `Use the Green microphone to add Tasks to a particular Project (Group)`
- `Use the Blue microphone to create a new Project with tasks.`
- sample project name `Try THIS Project`

All match, so the migration may proceed.

## Steps
1. Apply the supplied migration SQL byte for byte via the migration tool. It:
   - Creates `public.focusos_account_approvals` (per-account approval status, request/decision timestamps, one-time-link token hash, `last_emailed_at`) with RLS enabled.
   - Access rules: a signed-in user can read only their own row; only the server (service_role) can insert, update or delete; anon can read nothing. Exactly one policy: `focusos_approvals_select_own`.
   - Adds `focusos_is_approved(uuid)` (executable by service_role only) and `focusos_me_approved()` (executable by authenticated and service_role).
   - Seeds `approved` rows for every account that already shows real Focus OS usage (real projects, non-sample or non-todo tasks, meetings, recording sessions, API tokens, Google connections, accepted memberships/invites, shared items, preferences rows, edited profiles) plus the two named owner/review addresses.
2. Run the read-only verification count and report the three numbers (accounts total, approved on day one, non-approved rows — expected 0).
3. Confirm acceptance: table exists with RLS on and exactly one policy; function execute privileges as specified.

## Constraints
- No changes to any existing table, policy, trigger, function, storage policy, edge function or setting.
- No `src/` edits beyond the automatic `src/integrations/supabase/types.ts` regeneration.
- No user accounts created, changed or deleted. No edge function deploys. No publish.

## Technical details
- Single idempotent migration (`create table if not exists`, `on conflict do nothing`), applied once.
- The shared Supabase project is touched only within the statements above; all objects carry the `focusos_` prefix.
