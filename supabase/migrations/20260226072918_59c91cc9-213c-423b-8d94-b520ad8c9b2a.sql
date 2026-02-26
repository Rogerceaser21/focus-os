
-- Add processing status columns to meetings for async processing
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'done';
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS processing_error text;
ALTER TABLE public.meetings ADD COLUMN IF NOT EXISTS gemini_file_uri text;
