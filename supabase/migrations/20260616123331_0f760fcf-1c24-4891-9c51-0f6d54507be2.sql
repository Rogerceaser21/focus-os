-- Tokens table for Google Calendar OAuth
CREATE TABLE public.focusos_google_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  scope text NOT NULL,
  focusos_calendar_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.focusos_google_tokens TO authenticated;
GRANT ALL ON public.focusos_google_tokens TO service_role;

ALTER TABLE public.focusos_google_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own google tokens"
  ON public.focusos_google_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own google tokens"
  ON public.focusos_google_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own google tokens"
  ON public.focusos_google_tokens FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own google tokens"
  ON public.focusos_google_tokens FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER focusos_google_tokens_set_updated_at
  BEFORE UPDATE ON public.focusos_google_tokens
  FOR EACH ROW EXECUTE FUNCTION public.focusos_handle_updated_at();

-- Link Focus OS items to Google Calendar events
ALTER TABLE public.focusos_tasks    ADD COLUMN IF NOT EXISTS google_calendar_event_id text;
ALTER TABLE public.focusos_meetings ADD COLUMN IF NOT EXISTS google_calendar_event_id text;