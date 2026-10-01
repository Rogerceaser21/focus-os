-- Step 2 of 2: lock unapproved accounts out of the Focus OS tables.
-- One RESTRICTIVE policy per Focus OS table (11) and one on storage.objects for
-- the focusos-task-images bucket only. Approved accounts behave exactly as before.
-- Refuses to run when step 1 is missing or no account is approved.
-- Safe to run more than once (drop policy if exists, then create).

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