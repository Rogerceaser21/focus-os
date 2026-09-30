-- DRAFT (Lovable applies and renames this file)
--
-- Step 2 of 2. Apply LAST, after the new functions are deployed and the new front end is published. Does not seed.
--
-- What this step does, in plain words:
--   Locks unapproved accounts out of the database. It adds one RESTRICTIVE policy
--   per Focus OS table (11 tables) and one on storage.objects for the
--   focusos-task-images bucket only. Restrictive policies AND with the existing
--   permissive ones, so an approved account behaves exactly as before and an
--   UNAPPROVED account can read or write NOTHING in Focus OS tables (its own rows
--   included), so it cannot reach the data through the REST API either. No
--   existing policy is changed. Only role "authenticated" is affected:
--   service_role bypasses RLS, and other apps' storage buckets are untouched.
--
--   The three Focus OS sign-up triggers (focusos_handle_new_user_profile /
--   _onboarding / _registration) are SECURITY DEFINER, run as the function owner
--   and never as the authenticated role, so sign-ups still get their rows.
--
--   Why it is last: if this ran before the new front end and functions are live,
--   a real user the step 1 seed missed would face an empty app with no way to ask
--   for access. It refuses to run (raises an exception, changes nothing) when
--   step 1 has not been applied, or when the approvals table has no approved row.
--
-- Safe to run more than once (idempotent: drop policy if exists, then create).

do $$
begin
  if to_regclass('public.focusos_account_approvals') is null
     or to_regprocedure('public.focusos_me_approved()') is null then
    raise exception 'Step 2 refused: step 1 (draft_focusos_account_approvals_1_table_and_seed.sql) has not been applied.';
  end if;
  if not exists (select 1 from public.focusos_account_approvals where status = 'approved') then
    raise exception 'Step 2 refused: focusos_account_approvals has no approved row, so applying the lock would lock everyone out.';
  end if;
end
$$;

-- ===== (c) restrictive policies: unapproved accounts get NO access =====
--
-- One RESTRICTIVE policy per Focus OS table, for role authenticated, all
-- commands. It ANDs with the existing permissive policies, so an approved user
-- behaves exactly as before and an unapproved user sees and changes nothing.
-- Each table is guarded with to_regclass so a missing table cannot fail the
-- migration. focusos_account_approvals is deliberately NOT restricted (an
-- unapproved user must be able to read their own status).

do $$
declare
  t text;
begin
  foreach t in array array[
    'focusos_projects',
    'focusos_tasks',
    'focusos_user_preferences',
    'focusos_meetings',
    'focusos_profiles',
    'focusos_recording_sessions',
    'focusos_users',
    'focusos_shared_items',
    'focusos_project_members',
    'focusos_google_tokens',
    'focusos_api_tokens'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', 'focusos_require_approved', t);
      execute format(
        'create policy %I on public.%I as restrictive for all to authenticated '
        'using ((select public.focusos_me_approved())) '
        'with check ((select public.focusos_me_approved()))',
        'focusos_require_approved', t
      );
    end if;
  end loop;
end
$$;

-- Storage: only the focusos-task-images bucket is restricted. Every other
-- bucket (other apps share storage) passes the first branch untouched.
do $$
begin
  if to_regclass('storage.objects') is not null then
    drop policy if exists "focusos_require_approved_task_images" on storage.objects;
    create policy "focusos_require_approved_task_images"
      on storage.objects
      as restrictive
      for all
      to authenticated
      using (bucket_id <> 'focusos-task-images' or (select public.focusos_me_approved()))
      with check (bucket_id <> 'focusos-task-images' or (select public.focusos_me_approved()));
  end if;
end
$$;
