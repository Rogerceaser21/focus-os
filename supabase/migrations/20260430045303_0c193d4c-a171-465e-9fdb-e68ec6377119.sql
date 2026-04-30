UPDATE public.focusos_meetings
SET processing_status = 'transcribing',
    processing_error = NULL,
    gemini_transcribe_attempts = 0,
    gemini_transcribe_started_at = NULL,
    updated_at = now() - interval '5 minutes'
WHERE id = '93e50f91-7297-4dca-aeb4-5041394c010d';