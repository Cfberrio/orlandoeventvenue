-- Second hardening pass (Codex review of f8fad29).
--
-- Problem: public.bookings has RLS disabled, so anyone can rewrite
-- license_front_path / license_back_path. Deciding "keep or delete" from those
-- columns let an attacker clear a path and have the cleanup cron destroy the
-- license. It also kept attached licenses forever.
--
-- Fix: a registry table only the service role and a SECURITY DEFINER trigger
-- can write. The booking columns are now just a hand-off from the guest's
-- browser; the registry is the source of truth for display and retention.
--   * upload-driver-license inserts one row per file (booking_id NULL).
--   * When a booking row names that path, the trigger attaches it — first
--     attach wins, so a path can never be moved to another booking, and
--     clearing the column later detaches nothing.
--   * retain_until = event_date + 30 days, and only ever moves later, so
--     editing event_date on the booking can't make a license expire early.
--   * Cleanup deletes: unattached rows older than 48h, and rows past retain_until.

CREATE TABLE IF NOT EXISTS public.driver_license_uploads (
  path text PRIMARY KEY,
  side text NOT NULL CHECK (side IN ('front', 'back')),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  attached_at timestamptz,
  retain_until date
);
CREATE INDEX IF NOT EXISTS driver_license_uploads_booking_idx ON public.driver_license_uploads (booking_id);
CREATE INDEX IF NOT EXISTS driver_license_uploads_unattached_idx ON public.driver_license_uploads (created_at) WHERE booking_id IS NULL;
CREATE INDEX IF NOT EXISTS driver_license_uploads_retain_idx ON public.driver_license_uploads (retain_until) WHERE retain_until IS NOT NULL;

ALTER TABLE public.driver_license_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.driver_license_uploads FROM anon, authenticated;
GRANT SELECT ON public.driver_license_uploads TO authenticated;

DROP POLICY IF EXISTS "Admins can read license registry" ON public.driver_license_uploads;
CREATE POLICY "Admins can read license registry"
ON public.driver_license_uploads FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.attach_driver_license_uploads()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retain date := NEW.event_date + 30;
BEGIN
  -- Attach newly named paths. Only unattached rows (or rows already on this
  -- booking) can be claimed.
  UPDATE driver_license_uploads
     SET booking_id = NEW.id,
         attached_at = COALESCE(attached_at, now()),
         retain_until = GREATEST(COALESCE(retain_until, v_retain), v_retain)
   WHERE path IN (NEW.license_front_path, NEW.license_back_path)
     AND (booking_id IS NULL OR booking_id = NEW.id);

  -- A reschedule to a later date extends retention; an earlier date never shortens it.
  IF TG_OP = 'UPDATE' AND NEW.event_date IS DISTINCT FROM OLD.event_date THEN
    UPDATE driver_license_uploads
       SET retain_until = GREATEST(retain_until, v_retain)
     WHERE booking_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.attach_driver_license_uploads() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS bookings_attach_driver_license ON public.bookings;
CREATE TRIGGER bookings_attach_driver_license
AFTER INSERT OR UPDATE OF license_front_path, license_back_path, event_date ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.attach_driver_license_uploads();

-- Replace the column-based orphan finder with the registry-based one.
DROP FUNCTION IF EXISTS public.orphan_driver_license_paths(int);
CREATE OR REPLACE FUNCTION public.expired_driver_license_paths(p_limit int DEFAULT 500)
RETURNS TABLE (path text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.path
    FROM driver_license_uploads u
   WHERE (u.booking_id IS NULL AND u.created_at < now() - interval '48 hours')
      OR (u.retain_until IS NOT NULL AND u.retain_until < current_date)
   ORDER BY u.created_at
   LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.expired_driver_license_paths(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expired_driver_license_paths(int) TO service_role;

DROP INDEX IF EXISTS public.bookings_license_front_path_idx;
DROP INDEX IF EXISTS public.bookings_license_back_path_idx;
