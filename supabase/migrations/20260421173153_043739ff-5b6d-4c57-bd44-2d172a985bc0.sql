ALTER TABLE public.focusos_user_preferences
  ADD COLUMN IF NOT EXISTS ai_handoff_default_provider TEXT NULL,
  ADD COLUMN IF NOT EXISTS ai_handoff_image_mode TEXT NOT NULL DEFAULT 'public_link';