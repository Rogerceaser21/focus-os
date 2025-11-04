-- Add default_task_card_view column to user_preferences table
ALTER TABLE user_preferences 
ADD COLUMN default_task_card_view TEXT DEFAULT 'full' CHECK (default_task_card_view IN ('full', 'compact'));