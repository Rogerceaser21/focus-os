-- Step 1 of 2. Apply first. Safe on its own: nothing reads this table until the new functions and front end are live.
--
-- (a) adds a table that records, for each Focus OS account, whether the owner
--     has approved it yet, plus two helper functions;
-- (b) seeds it: every account that already uses Focus OS is marked 'approved',
--     so nobody who uses the app today is locked out when the gate goes live.
-- It changes no existing policy and restricts nothing.
--
-- Access rules for focusos_account_approvals:
--   * a signed-in user may READ only their own row (their own status);
--   * nobody except the server (service_role) can insert, update or delete;
--   * anon can read nothing.
--
-- Apply this step ONCE. Safe to run more than once (idempotent), but re-applying
-- it much later can approve accounts the owner has not approved.

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

-- True only when the account has an 'approved' row. Server-side helper.
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

-- The caller's OWN approval, read from the JWT (auth.uid()). Takes no argument,
-- so it cannot be pointed at another user's row. Used by step 2's policies.
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
-- An account counts as a Focus OS user when it has ANY trace that only the
-- Focus OS app itself creates. Rows the sign-up triggers on auth.users create
-- for EVERY account (focusos_users, the profile row, the 'Try THIS Project'
-- sample project and its 3 sample tasks) are NOT evidence.

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
    -- 7. project membership: as member only when ACCEPTED; as inviter always
    select pm.user_id from public.focusos_project_members pm
    where pm.status = 'accepted'
  union
    select pm.invited_by from public.focusos_project_members pm
  union
    -- 8. shared items: as sender always; as recipient only when accepted
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