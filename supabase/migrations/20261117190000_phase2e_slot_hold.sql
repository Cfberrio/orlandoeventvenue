-- Phase 2E, E-18 (ClickUp 86e40ach2): two guests could pay for the same slot.
-- The public availability check ignored bookings still in checkout, and paying
-- did not claim the slot. No overlap has happened yet (0 in production).
--
-- create-checkout now calls claim_booking_slot before creating the Stripe
-- session: under the same per-date lock the admin flows use, it re-checks
-- paid bookings, other live checkout holds, availability blocks and blackout
-- dates, then holds the slot for 35 minutes. The Stripe session expires after
-- 31 minutes, so an abandoned checkout frees the slot and cannot be paid late.
-- If a payment still lands on a conflicting slot, the booking gets a
-- 'slot_conflict_on_payment' event (money is never refused).

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS slot_hold_until timestamptz;

CREATE OR REPLACE FUNCTION public._slot_taken_by_other(p_b public.bookings, p_include_holds boolean)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT 'booked' FROM public.bookings o
     WHERE o.event_date = p_b.event_date AND o.id <> p_b.id
       AND o.status NOT IN ('cancelled', 'declined') AND COALESCE(o.lifecycle_status, '') <> 'cancelled'
       AND (
         o.payment_status IN ('deposit_paid', 'fully_paid', 'invoiced')
         OR (p_include_holds AND o.payment_status = 'pending' AND o.slot_hold_until > now())
       )
       AND (p_b.booking_type = 'daily' OR o.booking_type = 'daily'
            OR o.start_time IS NULL OR o.end_time IS NULL OR p_b.start_time IS NULL OR p_b.end_time IS NULL
            OR (o.start_time < p_b.end_time AND o.end_time > p_b.start_time))
     LIMIT 1),
    (SELECT 'blocked' FROM public.availability_blocks ab
     WHERE p_b.event_date BETWEEN ab.start_date AND ab.end_date
       AND ab.booking_id IS DISTINCT FROM p_b.id
       AND (ab.booking_id IS NULL OR EXISTS (
         SELECT 1 FROM public.bookings ob WHERE ob.id = ab.booking_id
           AND ob.status NOT IN ('cancelled', 'declined') AND COALESCE(ob.lifecycle_status, '') <> 'cancelled'))
       AND (p_b.booking_type = 'daily' OR ab.block_type = 'daily'
            OR ab.start_time IS NULL OR ab.end_time IS NULL
            OR (ab.start_time < p_b.end_time AND ab.end_time > p_b.start_time))
     LIMIT 1),
    (SELECT 'blackout' FROM public.blackout_dates bd
     WHERE p_b.event_date BETWEEN bd.start_date AND bd.end_date LIMIT 1)
  );
$function$;

REVOKE ALL ON FUNCTION public._slot_taken_by_other(public.bookings, boolean) FROM PUBLIC, anon, authenticated;

-- Returns NULL when the slot is held for this booking, otherwise why not.
CREATE OR REPLACE FUNCTION public.claim_booking_slot(p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_taken text;
BEGIN
  PERFORM public._assert_admin_or_service();
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('oev_booking_date:' || v_b.event_date::text));
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF v_b.status = 'cancelled'::booking_status OR v_b.payment_status <> 'pending' THEN
    RETURN 'not_pending';
  END IF;
  v_taken := public._slot_taken_by_other(v_b, true);
  IF v_taken IS NOT NULL THEN
    RETURN v_taken;
  END IF;
  UPDATE public.bookings SET slot_hold_until = now() + interval '35 minutes' WHERE id = p_booking_id;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.claim_booking_slot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_booking_slot(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_slot_conflict_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_taken text;
BEGIN
  IF NEW.deposit_paid_at IS NOT NULL AND OLD.deposit_paid_at IS NULL THEN
    v_taken := public._slot_taken_by_other(NEW, false);
    IF v_taken IS NOT NULL THEN
      INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
      VALUES (NEW.id, 'slot_conflict_on_payment', 'system', jsonb_build_object(
        'conflict', v_taken, 'event_date', NEW.event_date, 'start_time', NEW.start_time, 'end_time', NEW.end_time));
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_slot_conflict_on_payment ON public.bookings;
CREATE TRIGGER trg_slot_conflict_on_payment
  AFTER UPDATE OF deposit_paid_at ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_slot_conflict_on_payment();
