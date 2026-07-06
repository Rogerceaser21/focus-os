
CREATE POLICY "public_read_wallpapers"
ON storage.objects
FOR SELECT
TO anon, authenticated
USING (bucket_id = 'wallpapers');

CREATE POLICY "temp_anon_upload_wallpapers"
ON storage.objects
FOR INSERT
TO anon
WITH CHECK (bucket_id = 'wallpapers');
