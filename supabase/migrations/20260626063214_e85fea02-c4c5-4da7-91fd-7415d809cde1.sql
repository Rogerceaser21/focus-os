ALTER TABLE public.focusos_shared_items
  ADD COLUMN action_token text NOT NULL DEFAULT gen_random_uuid()::text;

CREATE UNIQUE INDEX focusos_shared_items_action_token_key
  ON public.focusos_shared_items(action_token);