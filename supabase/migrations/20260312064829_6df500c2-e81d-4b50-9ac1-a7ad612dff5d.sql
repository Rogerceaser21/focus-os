
-- Allow sender to update their own shared items (for acknowledging)
DROP POLICY IF EXISTS "focusos_recipient_can_update_shared_items" ON public.focusos_shared_items;
CREATE POLICY "focusos_users_can_update_shared_items"
  ON public.focusos_shared_items FOR UPDATE
  TO public
  USING ((auth.uid() = recipient_user_id) OR (auth.uid() = sender_user_id));
