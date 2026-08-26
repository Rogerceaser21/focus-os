# Plan: Add project sort/pin columns to `focusos_projects`

## Goal
Add two nullable columns to `public.focusos_projects` so the redesign/liquid-glass branch can implement manual drag reordering and pinning. No other schema, code, or RLS changes.

## Current state (verified)
- `supabase/migrations/20260826141431_add_project_sort_pin.sql` does not exist in the current branch.
- `public.focusos_projects` currently has 10 columns; `sort_order` and `pinned_at` are absent.
- `src/integrations/supabase/types.ts` does not yet include `sort_order` or `pinned_at` on `focusos_projects`.

## Steps
1. Create `supabase/migrations/20260826141431_add_project_sort_pin.sql` with exactly:
   ```sql
   alter table public.focusos_projects
     add column if not exists sort_order integer,
     add column if not exists pinned_at timestamptz;
   comment on column public.focusos_projects.sort_order is
     'Manual position within its sibling group (top level, or the subs of one parent). NULL = never ordered by hand, which sorts after every ordered sibling.';
   comment on column public.focusos_projects.pinned_at is
     'When the project was pinned to the top of the drawer, or NULL when it is not pinned. At most 5 pinned rows per user, enforced in app code.';
   ```
2. Apply the migration via the Supabase migration tool.
3. Regenerate `src/integrations/supabase/types.ts` so `focusos_projects` Row/Insert/Update include `sort_order: number | null` and `pinned_at: string | null`.
4. Verify:
   - Authenticated PostgREST `select sort_order, pinned_at from focusos_projects` returns 200.
   - Existing rows read back with both columns `null`.
   - `types.ts` carries both columns.
   - RLS behaviour is unchanged.

## Constraints respected
- No RLS, trigger, function, edge function, index, or UI changes.
- No data backfill.
- Additive only; null means "never hand-ordered / not pinned".

## Note on migration filename
The Supabase migration tool auto-generates migration filenames (as happened with the recent `wallpaper_prefs` migration). I will create the file with the requested name `20260826141431_add_project_sort_pin.sql`, but the migration system may rewrite it to its own generated name when it commits. The SQL content will match exactly what is specified above.