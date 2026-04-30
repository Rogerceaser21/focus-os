ALTER TABLE public.focusos_meetings
  ADD COLUMN IF NOT EXISTS gemini_transcribe_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS gemini_transcribe_attempts integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS transcription_text text;

CREATE INDEX IF NOT EXISTS focusos_meetings_processing_status_idx
  ON public.focusos_meetings (processing_status)
  WHERE processing_status IN ('transcribing', 'summarizing');