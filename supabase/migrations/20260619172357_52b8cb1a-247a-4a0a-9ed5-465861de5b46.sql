CREATE TABLE public.focusos_api_tokens (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  token_prefix TEXT NOT NULL,
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_focusos_api_tokens_user ON public.focusos_api_tokens(user_id);
CREATE INDEX idx_focusos_api_tokens_hash ON public.focusos_api_tokens(token_hash);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.focusos_api_tokens TO authenticated;
GRANT ALL ON public.focusos_api_tokens TO service_role;

ALTER TABLE public.focusos_api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own api tokens"
  ON public.focusos_api_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users create own api tokens"
  ON public.focusos_api_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own api tokens"
  ON public.focusos_api_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own api tokens"
  ON public.focusos_api_tokens FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_focusos_api_tokens_updated_at
  BEFORE UPDATE ON public.focusos_api_tokens
  FOR EACH ROW EXECUTE FUNCTION public.focusos_handle_updated_at();