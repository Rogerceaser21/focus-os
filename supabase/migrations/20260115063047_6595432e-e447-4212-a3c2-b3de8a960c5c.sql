-- Add theme column to user_preferences table
ALTER TABLE public.user_preferences 
ADD COLUMN theme text NOT NULL DEFAULT 'dark';