-- Safety net for retention: any object in driver-licenses with no registry row
-- (e.g. a registry row lost to a manual edit) is deleted 48h after it landed.
-- The bucket and registry were both empty when the registry was introduced,
-- so there was nothing to backfill; this sweep covers anything that slips by.
CREATE OR REPLACE FUNCTION public.untracked_driver_license_objects(p_limit int DEFAULT 500)
RETURNS TABLE (name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'driver-licenses'
     AND o.created_at < now() - interval '48 hours'
     AND NOT EXISTS (SELECT 1 FROM public.driver_license_uploads u WHERE u.path = o.name)
   ORDER BY o.created_at
   LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.untracked_driver_license_objects(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.untracked_driver_license_objects(int) TO service_role;
