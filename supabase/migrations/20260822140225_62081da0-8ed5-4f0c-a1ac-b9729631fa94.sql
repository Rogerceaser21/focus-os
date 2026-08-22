alter table public.focusos_projects
  add column if not exists archived_at timestamptz,
  add column if not exists parent_project_id uuid references public.focusos_projects(id) on delete set null;
create index if not exists focusos_projects_parent_idx on public.focusos_projects(parent_project_id);