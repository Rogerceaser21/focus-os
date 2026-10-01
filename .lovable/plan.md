# Focus OS account-approval gate — Step 2 of 2 (the lock)

## Goal
Apply the approved Step 2 migration: one RESTRICTIVE policy per Focus OS table (11) plus one on storage.objects for the `focusos-task-images` bucket only. Unapproved (pending / missing row) authenticated accounts lose access to Focus OS data; approved accounts behave exactly as before, because restrictive policies AND with the existing permissive ones. No existing policy is modified.

## Precondition check (read-only, already run)
- `public.focusos_account_approvals` exists.
- `public.focusos_me_approved()` exists.
- Approved rows: 25 (was 24 at seed — one account approved since; healthy).
- Both `raise exception` guards in the supplied SQL will pass; the lock cannot lock everyone out.

## Steps
1. Apply the supplied migration EXACTLY as written (name the file as normally done):
   - Guard block: refuses to run if step 1's table/function is missing or no approved row exists.
   - `drop policy if exists focusos_require_approved` + `create ... as restrictive for all to authenticated using/with check ((select public.focusos_me_approved()))` on each of the 11 `focusos_*` tables that exists.
   - Restrictive policy `focusos_require_approved_task_images` on `storage.objects` scoped by `bucket_id <> 'focusos-task-images' or approved` — other buckets on this shared project are untouched.
2. Run the read-only check and paste the raw result rows:
   ```sql
   select schemaname, tablename, policyname, permissive, cmd, roles
   from pg_policies
   where policyname in ('focusos_require_approved', 'focusos_require_approved_task_images')
   order by schemaname, tablename;
   ```

## Acceptance
- The check returns 12 rows: 11 on `public.focusos_*` tables named `focusos_require_approved`, 1 on `storage.objects` named `focusos_require_approved_task_images`; every row `permissive = RESTRICTIVE`, `cmd = ALL`, `roles = {authenticated}`.

## Constraints
- Change nothing else: no existing policy, table, trigger, function, edge function, secret or setting. No `src/` edits beyond the automatic types regeneration. No Lovable Cloud. No user accounts created, changed or deleted. No deploys. No publish.
- Only role `authenticated` is affected; other apps on this shared Supabase project keep their tables, policies and buckets untouched.
