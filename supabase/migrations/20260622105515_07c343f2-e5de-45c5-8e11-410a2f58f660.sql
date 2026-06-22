ALTER TABLE public.focusos_shared_items
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by text,
  ADD COLUMN IF NOT EXISTS completion_acknowledged boolean NOT NULL DEFAULT false;