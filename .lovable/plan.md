# Plan: Add `wallpaper_prefs` column to `focusos_user_preferences`

## Goal
Add a single nullable JSONB column `wallpaper_prefs` to `public.focusos_user_preferences` so the redesign/liquid-glass branch can sync wallpaper choice account-wide. No other schema, code, or RLS changes.

## Current state (verified)
- Migration file `supabase/migrations/20260823120800_wallpaper_prefs.sql` does not yet exist.
- `public.focusos_user_preferences` currently has 20 columns; `wallpaper_prefs` is absent.
- `src/integrations/supabase/types.ts` does not yet include `wallpaper_prefs` on the `focusos_user_preferences` table.

## Steps
1. Create `supabase/migrations/20260823120800_wallpaper_prefs.sql` with exactly:
   ```sql
   alter table public.focusos_user_preferences
     add column if not exists wallpaper_prefs jsonb;
   comment on column public.focusos_user_preferences.wallpaper_prefs is
     'Account-wide wallpaper: {v, id, plainColor, customUrl, customBrightness, customDominant, updatedAt}';
   ```
2. Apply the migration via the Supabase migration tool.
3. Regenerate `src/integrations/supabase/types.ts` so `focusos_user_preferences` Row/Insert/Update include `wallpaper_prefs: Json | null`.
4. Verify:
   - Authenticated PostgREST `select wallpaper_prefs from focusos_user_preferences` returns 200.
   - Existing rows read back `wallpaper_prefs = null`.
   - `types.ts` carries the new column.
   - Git diff contains only the migration file and `types.ts`.

## Constraints respected
- No RLS, trigger, function, edge function, or UI changes.
- No data backfill.
- Additive only; null means "never synced wallpaper".
