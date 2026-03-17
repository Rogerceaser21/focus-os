-- 1. Add focusos_project_members to Realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.focusos_project_members;

-- 2. Allow pending invitees to see the project name (so invitation card renders properly)
CREATE POLICY "focusos_pending_invitees_can_view_project"
ON public.focusos_projects
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.focusos_project_members pm
    WHERE pm.project_id = id
      AND pm.user_id = auth.uid()
      AND pm.status = 'pending'
  )
);