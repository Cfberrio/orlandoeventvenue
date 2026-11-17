-- Phase 2D, E-4 guard (ClickUp 86e40ach2). APPLY ONLY AFTER the redeployed
-- ghl-update-booking-status (uses ghl_apply_booking_status) and the published
-- frontend (uses admin_transition_booking) are live: the old versions write
-- lifecycle_status directly and would be refused.
--
-- A lifecycle change is accepted only when:
--   * it is a cancel (cancel-booking / trg_booking_cancel_normalize own it), or
--   * the writer marked the transaction (oev.lifecycle_writer = on), or
--   * it comes from inside another trigger (readiness recompute).

CREATE OR REPLACE FUNCTION public.trg_guard_lifecycle_writer()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
     AND NEW.lifecycle_status IS DISTINCT FROM 'cancelled'
     AND COALESCE(current_setting('oev.lifecycle_writer', true), '') <> 'on'
     AND pg_trigger_depth() <= 1 THEN
    RAISE EXCEPTION 'lifecycle_status changes go through transition_booking (from % to %)',
      OLD.lifecycle_status, NEW.lifecycle_status USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_lifecycle_writer ON public.bookings;
CREATE TRIGGER trg_guard_lifecycle_writer
  BEFORE UPDATE OF lifecycle_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_lifecycle_writer();

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_lifecycle_status_check;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_lifecycle_status_check CHECK (
  lifecycle_status IN ('pending', 'confirmed', 'pre_event_ready', 'in_progress', 'post_event', 'closed_review_complete', 'cancelled')
);
