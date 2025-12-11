-- Add column to track if user has completed the task tour
ALTER TABLE public.user_preferences 
ADD COLUMN has_completed_task_tour boolean NOT NULL DEFAULT false;