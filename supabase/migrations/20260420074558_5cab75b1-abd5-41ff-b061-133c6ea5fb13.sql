ALTER TABLE public.focusos_user_preferences
ADD COLUMN IF NOT EXISTS has_completed_meetings_tour BOOLEAN NOT NULL DEFAULT false;