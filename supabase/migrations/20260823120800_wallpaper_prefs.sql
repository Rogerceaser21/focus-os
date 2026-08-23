-- Account-wide wallpaper (Outstanding issues O1, 2026-08-23). Additive only.
-- null = this account has never synced its wallpaper (old clients unaffected,
-- no deploy-order trap; RLS untouched, the row is already user-scoped).
alter table public.focusos_user_preferences
  add column if not exists wallpaper_prefs jsonb;
comment on column public.focusos_user_preferences.wallpaper_prefs is
  'Account-wide wallpaper: {v, id, plainColor, customUrl, customBrightness, customDominant, updatedAt}';
