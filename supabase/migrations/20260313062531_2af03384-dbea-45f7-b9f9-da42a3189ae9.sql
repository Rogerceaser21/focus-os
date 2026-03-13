CREATE POLICY "focusos_authenticated_can_view_all_profiles"
ON public.focusos_profiles
FOR SELECT
TO authenticated
USING (true);