-- Add meeting_id column to tasks table to link tasks to meetings
ALTER TABLE public.tasks ADD COLUMN meeting_id uuid REFERENCES public.meetings(id) ON DELETE SET NULL;

-- Index for efficient lookups
CREATE INDEX idx_tasks_meeting_id ON public.tasks(meeting_id);
