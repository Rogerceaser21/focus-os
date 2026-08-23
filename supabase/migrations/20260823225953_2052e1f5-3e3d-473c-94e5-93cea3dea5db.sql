alter table public.focusos_user_preferences
  add column if not exists wallpaper_prefs jsonb;
comment on column public.focusos_user_preferences.wallpaper_prefs is
  'Account-wide wallpaper: {v, id, plainColor, customUrl, customBrightness, customDominant, updatedAt}';