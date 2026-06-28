UPDATE public.focusos_shared_items
SET status = 'completed'
WHERE completed_at IS NOT NULL
  AND status IN ('accepted', 'pending');