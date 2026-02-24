
-- Add columns for task assignment via email
ALTER TABLE public.tasks 
ADD COLUMN assigned_to_email text,
ADD COLUMN share_token uuid DEFAULT gen_random_uuid();

-- Index for looking up tasks by share token
CREATE INDEX idx_tasks_share_token ON public.tasks (share_token);
