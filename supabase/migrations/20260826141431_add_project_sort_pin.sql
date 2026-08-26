alter table public.focusos_projects
  add column if not exists sort_order integer,
  add column if not exists pinned_at timestamptz;
comment on column public.focusos_projects.sort_order is
  'Manual position within its sibling group (top level, or the subs of one parent). NULL = never ordered by hand, which sorts after every ordered sibling.';
comment on column public.focusos_projects.pinned_at is
  'When the project was pinned to the top of the drawer, or NULL when it is not pinned. At most 5 pinned rows per user, enforced in app code.';
