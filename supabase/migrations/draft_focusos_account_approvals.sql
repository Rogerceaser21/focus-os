-- DRAFT (Lovable applies and renames this file)
--
-- What this does, in plain words:
--   Adds a table that records, for each Focus OS account, whether the owner has
--   approved it yet. A new account has NO row until it first uses Focus OS; the
--   edge function focusos-request-approval then creates a 'pending' row and
--   emails the approver. Every server function that acts for a signed-in user
--   checks this table and refuses accounts that are not 'approved'.
--
--   Approval is deliberately NOT decided by a trigger on auth.users: this
--   Supabase project is shared with other apps, and every sign-up in any of them
--   already fires triggers on auth.users. This file does not touch those.
--
--   Existing Focus OS users are approved by the separate seed file
--   (draft_focusos_account_approvals_seed.sql), NOT by this file.
--
-- Access rules:
--   * a signed-in user may READ only their own row (their own status);
--   * nobody except the server (service_role) can insert, update or delete;
--   * anon can read nothing.
--
-- Safe to run more than once.

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
