
-- Create focusos_shared_items table
CREATE TABLE public.focusos_shared_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_user_id uuid NOT NULL,
  sender_email text NOT NULL,
  sender_name text,
  recipient_email text NOT NULL,
  recipient_user_id uuid,
  item_type text NOT NULL,
  item_id uuid NOT NULL,
  item_title text NOT NULL,
  project_name text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.focusos_shared_items ENABLE ROW LEVEL SECURITY;

-- Sender can insert
CREATE POLICY "focusos_sender_can_insert_shared_items"
  ON public.focusos_shared_items
  FOR INSERT
  TO public
  WITH CHECK (auth.uid() = sender_user_id);

-- Sender OR recipient can read
CREATE POLICY "focusos_users_can_view_shared_items"
  ON public.focusos_shared_items
  FOR SELECT
  TO public
  USING (
    auth.uid() = sender_user_id
    OR auth.uid() = recipient_user_id
  );

-- Recipient can update status (accept/decline)
CREATE POLICY "focusos_recipient_can_update_shared_items"
  ON public.focusos_shared_items
  FOR UPDATE
  TO public
  USING (auth.uid() = recipient_user_id);

-- Reuse existing updated_at trigger
CREATE TRIGGER focusos_shared_items_updated_at
  BEFORE UPDATE ON public.focusos_shared_items
  FOR EACH ROW
  EXECUTE FUNCTION public.focusos_handle_updated_at();
