-- Add has_completed_projects_tour column to user_preferences table
ALTER TABLE public.user_preferences
ADD COLUMN has_completed_projects_tour boolean NOT NULL DEFAULT false;