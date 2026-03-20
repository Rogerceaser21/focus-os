
-- Change default for mobile task card view to 'minimal'
ALTER TABLE public.focusos_user_preferences
  ALTER COLUMN default_task_card_view_mobile SET DEFAULT 'minimal';

-- Update all existing users to minimal on mobile
UPDATE public.focusos_user_preferences
  SET default_task_card_view_mobile = 'minimal';
