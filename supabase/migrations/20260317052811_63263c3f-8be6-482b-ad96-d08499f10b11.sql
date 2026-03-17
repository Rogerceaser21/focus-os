-- Drop the broken policy
DROP POLICY IF EXISTS "focusos_pending_invitees_can_view_project" ON public.focusos_projects;

-- Recreate with correct column reference
CREATE POLICY "focusos_pending_invitees_can_view_project"
ON public.focusos_projects
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.focusos_project_members pm
    WHERE pm.project_id = focusos_projects.id
      AND pm.user_id = auth.uid()
      AND pm.status = 'pending'
  )
);