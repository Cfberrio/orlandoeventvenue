-- Third hardening pass (Codex review of 9941693).
--
-- Race: cleanup selected an expired unattached upload, then a booking attached
-- it, then cleanup deleted the object anyway. Now cleanup CLAIMS rows first
-- (deleting_at, under row locks), and the attach trigger skips claimed rows.
-- Whichever commits first wins; a row is never both attached and deleted.
-- Claims older than 1h (a crashed run) are re-offered so deletion is retried.
--
-- Also: attach only a row whose side matches the column it was named in.
--
-- Not done on purpose: rejecting website bookings that lack a valid license at
-- the DB level. The currently published bundle doesn't send license paths, so
-- that would take booking creation down until the new bundle is live and cached
-- clients refresh; a missing license shows as "Not provided" in the admin tab.

ALTER TABLE public.driver_license_uploads ADD COLUMN IF NOT EXISTS deleting_at timestamptz;

CREATE OR REPLACE FUNCTION public.attach_driver_license_uploads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retain date := NEW.event_date + 30;
BEGIN
  UPDATE driver_license_uploads
     SET booking_id = NEW.id,
         attached_at = COALESCE(attached_at, now()),
         retain_until = GREATEST(COALESCE(retain_until, v_retain), v_retain)
   WHERE deleting_at IS NULL
     AND (booking_id IS NULL OR booking_id = NEW.id)
     AND ((path = NEW.license_front_path AND side = 'front')
       OR (path = NEW.license_back_path AND side = 'back'));

  IF TG_OP = 'UPDATE' AND NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    UPDATE driver_license_uploads
       SET retain_until = GREATEST(retain_until, v_retain)
     WHERE booking_id = NEW.id AND deleting_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_driver_license_uploads() FROM PUBLIC, anon, authenticated;

DROP FUNCTION IF EXISTS public.expired_driver_license_paths(int);
CREATE OR REPLACE FUNCTION public.claim_expired_driver_licenses(p_limit int DEFAULT 500)
RETURNS TABLE (path text)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE driver_license_uploads u
     SET deleting_at = now()
   WHERE u.path IN (
     SELECT c.path
       FROM driver_license_uploads c
      WHERE (c.deleting_at IS NULL OR c.deleting_at < now() - interval '1 hour')
        AND ((c.booking_id IS NULL AND c.created_at < now() - interval '48 hours')
          OR (c.retain_until IS NOT NULL AND c.retain_until < current_date))
      ORDER BY c.created_at
      LIMIT p_limit
      FOR UPDATE SKIP LOCKED
   )
  RETURNING u.path;
$$;
REVOKE ALL ON FUNCTION public.claim_expired_driver_licenses(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_expired_driver_licenses(int) TO service_role;
