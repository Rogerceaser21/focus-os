-- DRAFT (Lovable applies and renames this file)
--
-- ONE MIGRATION, ONE ORDER. Do not split this file. Its three parts must run
-- together, in this order, in a single transaction:
--   (a) the approvals table, its RLS, grants and helper functions;
--   (b) the seed that marks every account that already uses Focus OS as approved;
--   (c) the RESTRICTIVE policies that lock unapproved accounts out of every
--       Focus OS table and out of the focusos-task-images bucket.
-- If (c) ran before (b), every existing user would be locked out.
--
-- What this does, in plain words:
--   Adds a table that records, for each Focus OS account, whether the owner has
--   approved it yet. A new account has NO row until it first uses Focus OS; the
--   edge function focusos-request-approval then creates a 'pending' row and
--   emails the approver. Every server function that acts for a signed-in user
--   checks this table and refuses accounts that are not 'approved'. Part (c)
--   closes the same door at the database: an UNAPPROVED account can read or
--   write NOTHING in Focus OS tables (its own rows included), so it cannot reach
--   the data through the REST API either.
--
--   Approval is deliberately NOT decided by a trigger on auth.users: this
--   Supabase project is shared with other apps, and every sign-up in any of them
--   already fires triggers on auth.users. This file does not touch those. The
--   three Focus OS triggers (focusos_handle_new_user_profile / _onboarding /
--   _registration) are SECURITY DEFINER, run as the function owner and never as
--   the authenticated role, so sign-ups still get their rows.
--
-- Access rules for focusos_account_approvals:
--   * a signed-in user may READ only their own row (their own status);
--   * nobody except the server (service_role) can insert, update or delete;
--   * anon can read nothing.
--
-- Part (c) uses RESTRICTIVE policies, which AND with the existing permissive
-- ones. No existing policy is changed. Only role "authenticated" is affected:
-- service_role bypasses RLS, and the storage policy applies to the
-- focusos-task-images bucket only, so other apps' buckets are untouched.
--
-- SEED: the rule is documented in part (b). RUN THIS MIGRATION ONCE, AT THE SAME
-- TIME AS THE GATE GOES LIVE: after go-live a pending account can create some of
-- the seed's traces, so re-applying it later could approve people the owner has
-- not approved. It never changes an existing approvals row.
--
-- Safe to run more than once (idempotent).

-- ===== (a) table, RLS, grants, functions =====

create table if not exists public.focusos_account_approvals (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  status text not null check (status in ('pending', 'approved', 'declined')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  token_hash text,
  token_expires_at timestamptz
);

-- When the approver email for the CURRENT token was confirmed sent (set only
-- after Resend reports success). Lets focusos-request-approval re-send when a
-- send failed, so no account is stuck pending forever.
alter table public.focusos_account_approvals
  add column if not exists last_emailed_at timestamptz;

comment on table public.focusos_account_approvals is
  'Focus OS account approval. No row = never used Focus OS yet. token_hash is the SHA-256 hex of the emailed one-time link token (cleared on decision).';

alter table public.focusos_account_approvals enable row level security;

drop policy if exists "focusos_approvals_select_own" on public.focusos_account_approvals;
create policy "focusos_approvals_select_own"
  on public.focusos_account_approvals
  for select
  to authenticated
  using (auth.uid() = user_id);

-- No insert/update/delete policy exists for anon or authenticated, and the
-- table privileges are trimmed to match (belt and braces).
revoke all on table public.focusos_account_approvals from anon, authenticated;
grant select on table public.focusos_account_approvals to authenticated;
grant all on table public.focusos_account_approvals to service_role;

-- True only when the account has an 'approved' row. Server-side helper; the
-- edge functions read the table directly, so this is for SQL callers.
create or replace function public.focusos_is_approved(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.focusos_account_approvals a
    where a.user_id = p_user_id
      and a.status = 'approved'
  );
$$;

revoke all on function public.focusos_is_approved(uuid) from public;
revoke all on function public.focusos_is_approved(uuid) from anon, authenticated;
grant execute on function public.focusos_is_approved(uuid) to service_role;

-- The caller's OWN approval, read from the JWT (auth.uid()). Used by the
-- restrictive policies below, so it takes no argument and cannot be pointed at
-- another user's row.
create or replace function public.focusos_me_approved()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.focusos_account_approvals a
    where a.user_id = auth.uid()
      and a.status = 'approved'
  );
$$;

revoke all on function public.focusos_me_approved() from public;
revoke all on function public.focusos_me_approved() from anon;
grant execute on function public.focusos_me_approved() to authenticated;
grant execute on function public.focusos_me_approved() to service_role;

-- ===== (b) seed: accounts that ALREADY use Focus OS are approved =====
--
--   Marks every account that has ALREADY used Focus OS as 'approved', so nobody
--   who is using the app today is locked out when the gate goes live. Everyone
--   else gets no row and is asked for approval on first use.
--
--   An account counts as a Focus OS user when it has ANY trace that only the
--   Focus OS app itself creates. Rows that the sign-up triggers on auth.users
--   create for EVERY account (focusos_users, the profile row, the 'Try THIS
--   Project' sample project and its 3 sample tasks) are NOT evidence.
--
--   Traces that count (checked against every focusos_ table in
--   focusos_combined_migration.sql and supabase/migrations/):
--     1. a project whose name is not 'Try THIS Project';
--     2. a task whose title is not one of the 3 onboarding titles written by
--        focusos_handle_new_user_onboarding(), or a sample task moved out of
--        'todo';
--     3. a meeting;   4. a recording session;   5. an API token;
--     6. a Google connection;
--     7. a project membership as member with status 'accepted', or as inviter;
--     8. a shared item as sender, or as recipient when its status is 'accepted';
--     9. a focusos_user_preferences row (the app inserts it from the browser,
--        no trigger does);
--    10. an edited profile (updated_at more than 1 minute after created_at);
--    plus the App Store review account and the owner's account, by email.
--
--   Assumption: the live onboarding trigger writes exactly the 3 titles below
--   (from focusos_combined_migration.sql). If the live function differs, fix the
--   title list before applying.

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
    -- 7. project membership: as member only when ACCEPTED (a pending invitation
    --    is done TO the account by someone else, not by the account); as inviter always
    select pm.user_id from public.focusos_project_members pm
    where pm.status = 'accepted'
  union
    select pm.invited_by from public.focusos_project_members pm
  union
    -- 8. shared items: as sender always; as recipient only when the item's status
    --    shows they accepted it (status is pending / accepted / declined /
    --    cancelled / completed; a merely received or declined share is not use)
    select si.sender_user_id from public.focusos_shared_items si
  union
    select si.recipient_user_id from public.focusos_shared_items si
    where si.recipient_user_id is not null
      and si.status = 'accepted'
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
