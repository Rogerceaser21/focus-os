-- Add completed_at column to track when a task was marked as done
ALTER TABLE public.tasks 
ADD COLUMN completed_at timestamp with time zone DEFAULT NULL;

-- Backfill: Set completed_at for existing completed tasks to their updated_at time
UPDATE public.tasks 
SET completed_at = updated_at 
WHERE status = 'completed' AND completed_at IS NULL;

-- Create trigger function to manage completed_at timestamp
CREATE OR REPLACE FUNCTION public.handle_task_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- If status is changing to 'completed', set completed_at
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    NEW.completed_at = now();
  -- If status is changing FROM 'completed' to something else, clear completed_at
  ELSIF OLD.status = 'completed' AND NEW.status != 'completed' THEN
    NEW.completed_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger on tasks table
CREATE TRIGGER on_task_status_change
BEFORE UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.handle_task_completion();