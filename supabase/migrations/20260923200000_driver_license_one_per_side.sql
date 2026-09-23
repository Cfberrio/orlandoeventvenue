-- Fourth hardening pass (Codex review of eb83f62).
--
-- 1. One license per booking per side, first attach wins. bookings has no RLS,
--    so anyone can write a path onto someone else's booking; with this, a later
--    write can't replace the license the guest attached at checkout (the
--    website flow attaches in the same INSERT that creates the booking).
--    A guest who re-submits a pending booking keeps their first license; the
--    newer upload stays unattached and is purged after 48h.
-- 2. Rate limit is per IP only. The global 200/h cap let anyone lock every guest
--    out of the (mandatory) upload step for an hour.

CREATE UNIQUE INDEX IF NOT EXISTS driver_license_uploads_one_per_side
  ON public.driver_license_uploads (booking_id, side)
  WHERE booking_id IS NOT NULL AND deleting_at IS NULL;

CREATE OR REPLACE FUNCTION public.attach_driver_license_uploads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retain date := NEW.event_date + 30;
BEGIN
  UPDATE driver_license_uploads u
     SET booking_id = NEW.id,
         attached_at = now(),
         retain_until = v_retain
   WHERE u.deleting_at IS NULL
     AND u.booking_id IS NULL
     AND ((u.path = NEW.license_front_path AND u.side = 'front')
       OR (u.path = NEW.license_back_path AND u.side = 'back'))
     AND NOT EXISTS (
       SELECT 1 FROM driver_license_uploads x
        WHERE x.booking_id = NEW.id AND x.side = u.side AND x.deleting_at IS NULL
     );

  IF TG_OP = 'UPDATE' AND NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    UPDATE driver_license_uploads
       SET retain_until = GREATEST(retain_until, v_retain)
     WHERE booking_id = NEW.id AND deleting_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_driver_license_uploads() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_license_upload_slot(p_ip text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('claim_license_upload_slot:' || p_ip));

  DELETE FROM license_upload_attempts WHERE created_at < now() - interval '1 day';

  SELECT count(*) INTO v_ip_count FROM license_upload_attempts
   WHERE ip = p_ip AND created_at > now() - interval '1 hour';
  IF v_ip_count >= 8 THEN
    RETURN false;
  END IF;

  INSERT INTO license_upload_attempts (ip) VALUES (p_ip);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_license_upload_slot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_license_upload_slot(text) TO service_role;
