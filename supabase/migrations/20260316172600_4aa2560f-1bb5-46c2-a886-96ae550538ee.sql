
-- 1. Create the project members table
CREATE TABLE public.focusos_project_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.focusos_projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'collaborator',
  invited_by uuid NOT NULL,
  invited_email text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

-- 2. Enable RLS
ALTER TABLE public.focusos_project_members ENABLE ROW LEVEL SECURITY;

-- 3. Add updated_at trigger
CREATE TRIGGER focusos_project_members_updated_at
  BEFORE UPDATE ON public.focusos_project_members
  FOR EACH ROW EXECUTE FUNCTION public.focusos_handle_updated_at();

-- 4. Security definer function to check project membership (avoids RLS recursion)
CREATE OR REPLACE FUNCTION public.focusos_is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.focusos_project_members
    WHERE user_id = _user_id
      AND project_id = _project_id
      AND status = 'accepted'
  )
$$;

-- 5. Security definer function to get member role
CREATE OR REPLACE FUNCTION public.focusos_get_project_role(_user_id uuid, _project_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.focusos_project_members
  WHERE user_id = _user_id
    AND project_id = _project_id
    AND status = 'accepted'
  LIMIT 1
$$;

-- 6. RLS policies for focusos_project_members
-- Project owner can see all members of their projects
CREATE POLICY "focusos_owner_can_view_project_members"
ON public.focusos_project_members
FOR SELECT
TO authenticated
USING (
  invited_by = auth.uid()
  OR user_id = auth.uid()
);

-- Project owner can insert members (invite)
CREATE POLICY "focusos_owner_can_invite_members"
ON public.focusos_project_members
FOR INSERT
TO authenticated
WITH CHECK (invited_by = auth.uid());

-- Owner can update members (e.g. remove), recipient can update own status (accept/decline)
CREATE POLICY "focusos_can_update_membership"
ON public.focusos_project_members
FOR UPDATE
TO authenticated
USING (invited_by = auth.uid() OR user_id = auth.uid());

-- Owner can delete members
CREATE POLICY "focusos_owner_can_delete_members"
ON public.focusos_project_members
FOR DELETE
TO authenticated
USING (invited_by = auth.uid());

-- 7. Add SELECT policy on focusos_projects so members can view shared projects
CREATE POLICY "focusos_members_can_view_shared_projects"
ON public.focusos_projects
FOR SELECT
TO authenticated
USING (public.focusos_is_project_member(auth.uid(), id));

-- 8. Add policies on focusos_tasks so members can view/edit tasks in shared projects
CREATE POLICY "focusos_members_can_view_project_tasks"
ON public.focusos_tasks
FOR SELECT
TO authenticated
USING (public.focusos_is_project_member(auth.uid(), project_id));

CREATE POLICY "focusos_members_can_update_project_tasks"
ON public.focusos_tasks
FOR UPDATE
TO authenticated
USING (
  public.focusos_is_project_member(auth.uid(), project_id)
  AND public.focusos_get_project_role(auth.uid(), project_id) IN ('owner', 'collaborator')
);

CREATE POLICY "focusos_members_can_insert_project_tasks"
ON public.focusos_tasks
FOR INSERT
TO authenticated
WITH CHECK (
  public.focusos_is_project_member(auth.uid(), project_id)
  AND public.focusos_get_project_role(auth.uid(), project_id) IN ('owner', 'collaborator')
);
