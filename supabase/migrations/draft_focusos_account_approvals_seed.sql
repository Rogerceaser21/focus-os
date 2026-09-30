-- DRAFT (Lovable applies and renames this file). Run AFTER
-- draft_focusos_account_approvals.sql.
--
-- What this does, in plain words:
--   Marks every account that has ALREADY used Focus OS as 'approved', so
--   nobody who is using the app today is locked out when the approval gate
--   goes live. An account counts as "has used Focus OS" when it has any of:
--     * a project that is not the auto-created 'Try THIS Project' sample;
--     * a meeting;
--     * a task that is not inside a 'Try THIS Project' project;
--     * an API token.
--   It also approves the App Store review account and the owner's account by
--   email. Everyone else gets no row and is asked for approval on first use.
--
--   Kept in its own file because the owner may still change this rule.
--   Idempotent: existing rows are never changed.

insert into public.focusos_account_approvals (user_id, email, status, requested_at, decided_at)
select u.id, coalesce(u.email, ''), 'approved', now(), now()
from auth.users u
where u.id in (
    select p.user_id
    from public.focusos_projects p
    where p.name is distinct from 'Try THIS Project'
  union
    select m.user_id
    from public.focusos_meetings m
  union
    select t.user_id
    from public.focusos_tasks t
    where t.project_id is null
       or not exists (
            select 1
            from public.focusos_projects sp
            where sp.id = t.project_id
              and sp.name = 'Try THIS Project'
          )
  union
    select k.user_id
    from public.focusos_api_tokens k
)
   or lower(u.email) in ('apple.review@focusos.tech', 'igor.sesar@ais.ae')
on conflict (user_id) do nothing;
