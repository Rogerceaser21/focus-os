# Add archive + sub-project columns to focusos_projects

## What this does
Adds two optional, additive columns to `public.focusos_projects` in the connected Supabase project:

- `archived_at timestamptz` — null means active; a timestamp means archived.
- `parent_project_id uuid` — null means top-level project; references the same table with `on delete set null` so deleting a parent promotes children to top-level.

Also creates an index on `parent_project_id`.

## Why it's safe
- Existing rows keep working unchanged because both columns are nullable.
- No RLS policies, triggers, functions, or other tables are touched.
- No application code, types, or edge functions are modified.

## Migration SQL
```sql
alter table public.focusos_projects
  add column if not exists archived_at timestamptz,
  add column if not exists parent_project_id uuid references public.focusos_projects(id) on delete set null;
create index if not exists focusos_projects_parent_idx on public.focusos_projects(parent_project_id);
```

## Acceptance checks
- `select archived_at, parent_project_id from public.focusos_projects limit 1;` returns both columns without error.
- Index `focusos_projects_parent_idx` exists on `public.focusos_projects(parent_project_id)`.
- No other schema or code differences.
