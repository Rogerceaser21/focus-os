-- Add onboarding tracking column to user_preferences
ALTER TABLE public.user_preferences 
ADD COLUMN has_completed_onboarding boolean NOT NULL DEFAULT false;