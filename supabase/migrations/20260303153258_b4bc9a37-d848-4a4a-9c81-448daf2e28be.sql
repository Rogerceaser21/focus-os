
-- Add completed_by_email to track who completed an assigned task
ALTER TABLE public.tasks ADD COLUMN completed_by_email text DEFAULT NULL;
