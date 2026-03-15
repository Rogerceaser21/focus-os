
-- Create the storage bucket for task images
INSERT INTO storage.buckets (id, name, public)
VALUES ('focusos-task-images', 'focusos-task-images', true)
ON CONFLICT (id) DO NOTHING;

-- Security definer function to check if a user has access to shared task images
CREATE OR REPLACE FUNCTION public.focusos_can_access_task_image(_user_id uuid, _file_owner_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.focusos_shared_items si
    WHERE si.recipient_user_id = _user_id
      AND si.sender_user_id = _file_owner_id
      AND si.status = 'accepted'
  )
$$;

-- RLS: Authenticated users can upload to their own folder
CREATE POLICY "focusos_users_can_upload_own_images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'focusos-task-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- RLS: Users can read their own files OR files from users who shared with them
CREATE POLICY "focusos_users_can_read_task_images"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'focusos-task-images'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.focusos_can_access_task_image(auth.uid(), ((storage.foldername(name))[1])::uuid)
  )
);

-- RLS: Users can delete only their own files
CREATE POLICY "focusos_users_can_delete_own_images"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'focusos-task-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
