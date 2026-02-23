-- Add sort_order column to tasks table for custom ordering within priority groups
ALTER TABLE public.tasks ADD COLUMN sort_order integer DEFAULT 0;

-- Create index for efficient sorting
CREATE INDEX idx_tasks_sort_order ON public.tasks (user_id, priority, sort_order);