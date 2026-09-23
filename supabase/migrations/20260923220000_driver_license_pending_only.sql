-- Fifth hardening pass (Codex review of cacb0ff).
--
-- Root cause Codex keeps circling: public.bookings has RLS disabled, so any
-- caller can write license paths / event_date on any booking. Until bookings
-- gets real RLS (docs/security roadmap), bound what those writes can do:
--
--  * Attach on INSERT (the website flow) as before.
--  * Attach/replace on UPDATE only while payment_status = 'pending' — i.e.
--    the guest's own pre-payment retry. A replacement retires the old file
--    (detached, purged by the next cleanup run). Once paid, and for every
--    older booking without a license, the license is frozen: it can't be
--    forged in or swapped.
--  * retain_until = event_date + 30, but never more than 400 days after the
--    file was attached, so moving event_date can't keep a license forever.

CREATE OR REPLACE FUNCTION public.attach_driver_license_uploads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retain date := LEAST(NEW.event_date + 30, current_date + 400);
  v_side text;
  v_path text;
BEGIN
  IF TG_OP = 'INSERT' OR NEW.payment_status = 'pending' THEN
    FOREACH v_side IN ARRAY ARRAY['front', 'back'] LOOP
      v_path := CASE v_side WHEN 'front' THEN NEW.license_front_path ELSE NEW.license_back_path END;
      CONTINUE WHEN v_path IS NULL;

      -- Only an unclaimed, never-attached upload of the right side qualifies.
      CONTINUE WHEN NOT EXISTS (
        SELECT 1 FROM driver_license_uploads
         WHERE path = v_path AND side = v_side AND booking_id IS NULL AND deleting_at IS NULL
      );

      -- Retire the current file for this side (pending retry), then attach.
      UPDATE driver_license_uploads
         SET booking_id = NULL, retain_until = NULL, attached_at = NULL
       WHERE booking_id = NEW.id AND side = v_side AND deleting_at IS NULL AND path <> v_path;

      UPDATE driver_license_uploads
         SET booking_id = NEW.id, attached_at = now(), retain_until = v_retain
       WHERE path = v_path AND booking_id IS NULL AND deleting_at IS NULL;
    END LOOP;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    UPDATE driver_license_uploads
       SET retain_until = LEAST(GREATEST(retain_until, NEW.event_date + 30), (attached_at::date) + 400)
     WHERE booking_id = NEW.id AND deleting_at IS NULL;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_driver_license_uploads() FROM PUBLIC, anon, authenticated;
