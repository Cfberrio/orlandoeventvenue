-- Driver's license (front + back) collected at the signature step of the
-- public booking flow. Guests are anonymous, so:
--   * the bucket is PRIVATE (no public URLs),
--   * anon may only INSERT under uploads/ — no SELECT/UPDATE/DELETE, so a
--     guest cannot list, read, or overwrite anyone's file (including their own),
--   * only admins can read, via short-lived signed URLs from the admin dashboard.
-- Size and type are enforced by the bucket itself, not just the browser.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'driver-licenses',
  'driver-licenses',
  false,
  10485760, -- 10 MB
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Guests can upload driver licenses" ON storage.objects;
CREATE POLICY "Guests can upload driver licenses"
ON storage.objects FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'driver-licenses'
  AND (storage.foldername(name))[1] = 'uploads'
);

DROP POLICY IF EXISTS "Admins can read driver licenses" ON storage.objects;
CREATE POLICY "Admins can read driver licenses"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'driver-licenses'
  AND public.has_role(auth.uid(), 'admin'::app_role)
);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS license_front_path text,
  ADD COLUMN IF NOT EXISTS license_back_path text;

COMMENT ON COLUMN public.bookings.license_front_path IS
  'Object path in private bucket driver-licenses (front of ID). Read only via admin signed URL.';
COMMENT ON COLUMN public.bookings.license_back_path IS
  'Object path in private bucket driver-licenses (back of ID). Read only via admin signed URL.';
