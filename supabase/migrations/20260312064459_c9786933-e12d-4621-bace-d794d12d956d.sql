
-- Add recipient_task_id to link cloned task back to shared item
ALTER TABLE public.focusos_shared_items 
  ADD COLUMN IF NOT EXISTS recipient_task_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS sender_acknowledged boolean DEFAULT false;
