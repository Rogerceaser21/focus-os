
ALTER TABLE public.focusos_user_preferences 
ADD COLUMN default_task_card_view_mobile text DEFAULT 'compact';

-- Update existing default for desktop column too
ALTER TABLE public.focusos_user_preferences 
ALTER COLUMN default_task_card_view SET DEFAULT 'compact';
