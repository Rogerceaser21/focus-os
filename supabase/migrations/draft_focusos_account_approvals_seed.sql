-- DRAFT (Lovable applies and renames this file). Run AFTER
-- draft_focusos_account_approvals.sql.
--
-- What this does, in plain words:
--   Marks every account that has ALREADY used Focus OS as 'approved', so nobody
--   who is using the app today is locked out when the approval gate goes live.
--   Everyone else gets no row and is asked for approval on first use.
--
--   An account counts as a Focus OS user when it has ANY trace that only the
--   Focus OS app itself creates. Rows that the sign-up triggers on auth.users
--   create for EVERY account (focusos_users, the profile row, the 'Try THIS
--   Project' sample project and its 3 sample tasks) are NOT evidence, because
--   every sign-up in any app on this shared database gets them.
--
--   Traces that count (checked against every focusos_ table in
--   focusos_combined_migration.sql and supabase/migrations/):
--     1. a project whose name is not 'Try THIS Project';
--     2. a task whose title is not one of the 3 onboarding titles written by
--        focusos_handle_new_user_onboarding() (so a task added inside the sample
--        project counts, a task in a renamed or deleted sample project counts,
--        and the 3 untouched sample tasks never do); a sample task that has been
--        moved out of 'todo' also counts;
--     3. a meeting;
--     4. a recording session;
--     5. an API token;
--     6. a Google connection (focusos_google_tokens);
--     7. a project membership where the account is the member (accepted or
--        pending) or the inviter;
--     8. a shared item where the account is the sender or the recipient;
--     9. a focusos_user_preferences row: NO trigger creates it. The app inserts
--        it from the browser (ensureDefaultPreferences) the first time an
--        account opens Focus OS, so its existence means the account has used
--        the app;
--    10. an edited profile (updated_at more than 1 minute after created_at).
--        The app never updates focusos_profiles (it only reads it), so this only
--        comes from a manual edit or the one-off CSV import, both by people who
--        had Focus OS data anyway. Nothing in the repo's migrations does it.
--   Plus the App Store review account and the owner's account, by email.
--
--   RUN THIS ONCE, AT THE SAME TIME AS THE GATE GOES LIVE. After go-live a
--   pending account can create some of these traces (for example a preferences
--   row), so re-running it later could approve people the owner has not
--   approved. It never changes an existing row (on conflict do nothing).
--
--   Assumption: the live onboarding trigger writes exactly the 3 titles below
--   (from focusos_combined_migration.sql). If the live function differs, fix
--   the title list here before running.
--
--   Kept in its own file because the owner may still change this rule.

insert into public.focusos_account_approvals (user_id, email, status, requested_at, decided_at)
select u.id, coalesce(u.email, ''), 'approved', now(), now()
from auth.users u
where u.id in (
    -- 1. real projects
    select p.user_id
    from public.focusos_projects p
    where p.name is distinct from 'Try THIS Project'
  union
    -- 2. tasks that are not the untouched onboarding tasks
    select t.user_id
    from public.focusos_tasks t
    where t.title not in (
            'Use the Purple microphone to add tasks to the Today''s to do list.',
            'Use the Green microphone to add Tasks to a particular Project (Group)',
            'Use the Blue microphone to create a new Project with tasks.'
          )
       or t.status is distinct from 'todo'
  union
    -- 3. meetings
    select m.user_id from public.focusos_meetings m
  union
    -- 4. recording sessions
    select r.user_id from public.focusos_recording_sessions r
  union
    -- 5. API tokens
    select k.user_id from public.focusos_api_tokens k
  union
    -- 6. Google connections
    select g.user_id from public.focusos_google_tokens g
  union
    -- 7. project membership (as member: accepted or pending; or as inviter)
    select pm.user_id from public.focusos_project_members pm
    where pm.status in ('accepted', 'pending')
  union
    select pm.invited_by from public.focusos_project_members pm
  union
    -- 8. shared items, as sender or recipient
    select si.sender_user_id from public.focusos_shared_items si
  union
    select si.recipient_user_id from public.focusos_shared_items si
    where si.recipient_user_id is not null
  union
    -- 9. preferences row (created by the app, not by a trigger)
    select up.user_id from public.focusos_user_preferences up
  union
    -- 10. edited profile
    select fp.user_id from public.focusos_profiles fp
    where fp.updated_at > fp.created_at + interval '1 minute'
)
   or lower(u.email) in ('apple.review@focusos.tech', 'igor.sesar@ais.ae')
on conflict (user_id) do nothing;
