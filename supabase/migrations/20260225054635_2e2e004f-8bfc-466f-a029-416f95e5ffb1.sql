ALTER TABLE public.meetings
ADD COLUMN share_token UUID DEFAULT gen_random_uuid();

-- Create index for fast lookup by share_token
CREATE INDEX idx_meetings_share_token ON public.meetings (share_token);