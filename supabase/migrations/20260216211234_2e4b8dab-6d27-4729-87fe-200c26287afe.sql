
-- Fix: allow uploads/deletions to cleaning-media bucket without Supabase Auth session.
DROP POLICY IF EXISTS "Staff can upload cleaning media" ON storage.objects;
CREATE POLICY "Allow cleaning media uploads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'cleaning-media');

DROP POLICY IF EXISTS "Staff can delete their uploads" ON storage.objects;
CREATE POLICY "Allow cleaning media deletions"
ON storage.objects FOR DELETE
USING (bucket_id = 'cleaning-media');

-- Fix booking-cleaning-reports bucket as well
DROP POLICY IF EXISTS "Staff can upload booking cleaning media" ON storage.objects;
CREATE POLICY "Allow booking cleaning report uploads"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'booking-cleaning-reports');

DROP POLICY IF EXISTS "Staff can delete booking cleaning media" ON storage.objects;
CREATE POLICY "Allow booking cleaning report deletions"
ON storage.objects FOR DELETE
USING (bucket_id = 'booking-cleaning-reports');
