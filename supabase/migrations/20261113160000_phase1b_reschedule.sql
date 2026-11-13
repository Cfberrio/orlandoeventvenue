-- Phase 1B / M-1 (ClickUp 86e40ach2): a reschedule that changes the hours
-- now moves the package window, shows the price difference and flags staff
-- hours; it can no longer move an event that already happened.
--
-- Before: reschedule changed only date/start/end. OEV-9CMUGG went 12-16 to
-- 12-14 and stayed charged (and staffed, and paid) for 4h; 7QBUUT and JSNXY6
-- lost an hour with the price unchanged. Post-event bookings could be moved.
--
-- Luis D8 (recommendation): flag the price difference and let the office
-- choose. Nothing is charged or refunded automatically:
--   * apply_to_balance   - the balance (still unpaid, no live link) absorbs it;
--   * charged_separately - extra hours billed with an invoice (reference);
--   * refunded_separately - refund issued in Stripe/cash/Zelle (reference);
--   * waived             - kept as is, with a reason.
-- Staff hours are flagged, not clamped (staff can legitimately work setup
-- and breakdown outside the event window); payroll is created at completion
-- from the reviewed hours (batch 2), so it follows whatever the office sets.

-- ---------------------------------------------------------------------------
-- Price basis (Codex review): the rates this booking was sold at, captured
-- once, plus the window whose price is already settled. Deriving rates from
-- the current hours broke on a second reschedule (hours moved, money did
-- not). RLS table, written only by definer functions (bookings is writable
-- by anon until S-10, so the basis cannot live there).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_price_basis (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  hourly_rate numeric,
  package_rate numeric,
  discount_type text,
  discount_value numeric,
  discount_applies_to text,
  priced_start_time time,
  priced_end_time time,
  priced_package_start_time time,
  priced_package_end_time time,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.booking_price_basis ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read price basis" ON public.booking_price_basis;
CREATE POLICY "Admins read price basis" ON public.booking_price_basis
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.booking_price_basis FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.booking_price_basis FROM authenticated;
GRANT SELECT ON public.booking_price_basis TO authenticated;

CREATE OR REPLACE FUNCTION public._hours_between(p_start time, p_end time)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT CASE WHEN p_start IS NOT NULL AND p_end IS NOT NULL AND p_end > p_start
              THEN extract(epoch FROM (p_end - p_start)) / 3600.0 END;
$function$;

-- Captures the basis the first time a booking is rescheduled (its stored
-- money still matches its hours then). Returns the basis row.
CREATE OR REPLACE FUNCTION public._ensure_price_basis(p_booking_id uuid)
RETURNS public.booking_price_basis
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_basis public.booking_price_basis%ROWTYPE;
  v_b public.bookings%ROWTYPE;
  v_snap record;
  v_hours numeric;
  v_pkg_hours numeric;
BEGIN
  SELECT * INTO v_basis FROM public.booking_price_basis WHERE booking_id = p_booking_id;
  IF FOUND THEN
    RETURN v_basis;
  END IF;
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  v_hours := CASE WHEN v_b.booking_type = 'hourly' THEN public._hours_between(v_b.start_time, v_b.end_time) END;
  v_pkg_hours := CASE WHEN COALESCE(v_b.package, 'none') <> 'none'
                      THEN public._hours_between(v_b.package_start_time, v_b.package_end_time) END;
  SELECT discount_type, discount_value, discount_applies_to INTO v_snap
  FROM public.booking_price_snapshots WHERE booking_id = p_booking_id ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.booking_price_basis (
    booking_id, hourly_rate, package_rate, discount_type, discount_value, discount_applies_to,
    priced_start_time, priced_end_time, priced_package_start_time, priced_package_end_time)
  VALUES (
    p_booking_id,
    CASE WHEN v_hours > 0 THEN COALESCE(v_b.base_rental, 0) / v_hours END,
    CASE WHEN v_pkg_hours > 0 THEN COALESCE(v_b.package_cost, 0) / v_pkg_hours END,
    CASE
      WHEN COALESCE(v_b.discount_amount, 0) <= 0 THEN 'none'
      WHEN v_snap.discount_type IN ('percentage', 'fixed_amount') THEN v_snap.discount_type
      WHEN COALESCE(v_b.base_rental, 0) > 0 THEN 'percentage'
      ELSE 'fixed_amount'
    END,
    CASE
      WHEN COALESCE(v_b.discount_amount, 0) <= 0 THEN 0
      WHEN v_snap.discount_type IN ('percentage', 'fixed_amount') THEN v_snap.discount_value
      -- Unknown terms: the discount is taken as a share of the base rental.
      WHEN COALESCE(v_b.base_rental, 0) > 0 THEN v_b.discount_amount / v_b.base_rental * 100
      ELSE v_b.discount_amount
    END,
    CASE
      WHEN v_snap.discount_type IN ('percentage', 'fixed_amount') THEN COALESCE(v_snap.discount_applies_to, 'base_rental')
      ELSE 'base_rental'
    END,
    v_b.start_time, v_b.end_time, v_b.package_start_time, v_b.package_end_time
  )
  RETURNING * INTO v_basis;
  RETURN v_basis;
END;
$function$;

-- Price of a window at the booking's sold rates. Fixed parts (cleaning,
-- add-ons, bar) come from the stored row and do not depend on hours.
CREATE OR REPLACE FUNCTION public._price_at_window(
  p_booking public.bookings,
  p_basis public.booking_price_basis,
  p_start time,
  p_end time,
  p_pkg_start time,
  p_pkg_end time
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
AS $function$
DECLARE
  v_fixed numeric := COALESCE(p_booking.total_amount, 0) + COALESCE(p_booking.discount_amount, 0)
                     - COALESCE(p_booking.base_rental, 0) - COALESCE(p_booking.package_cost, 0);
  v_hours numeric := public._hours_between(p_start, p_end);
  v_pkg_hours numeric := public._hours_between(p_pkg_start, p_pkg_end);
  v_base numeric;
  v_pkg numeric;
  v_gross numeric;
  v_disc numeric;
BEGIN
  v_base := CASE WHEN p_booking.booking_type = 'hourly' AND p_basis.hourly_rate IS NOT NULL AND v_hours > 0
                 THEN round(p_basis.hourly_rate * v_hours, 2)
                 ELSE COALESCE(p_booking.base_rental, 0) END;
  v_pkg := CASE WHEN COALESCE(p_booking.package, 'none') <> 'none' AND p_basis.package_rate IS NOT NULL AND v_pkg_hours > 0
                THEN round(p_basis.package_rate * v_pkg_hours, 2)
                ELSE COALESCE(p_booking.package_cost, 0) END;
  v_gross := v_fixed + v_base + v_pkg;
  v_disc := CASE p_basis.discount_type
    WHEN 'percentage' THEN round(
      CASE WHEN p_basis.discount_applies_to = 'total' THEN v_gross ELSE v_base END
      * least(COALESCE(p_basis.discount_value, 0), 100) / 100.0, 2)
    WHEN 'fixed_amount' THEN least(COALESCE(p_basis.discount_value, 0),
      CASE WHEN p_basis.discount_applies_to = 'total' THEN v_gross ELSE v_base END)
    ELSE 0 END;
  v_disc := greatest(0, least(v_disc, v_gross));
  RETURN jsonb_build_object(
    'hours', round(v_hours, 2), 'package_hours', round(v_pkg_hours, 2),
    'base_rental', v_base, 'package_cost', v_pkg, 'discount', v_disc,
    'total', round(v_gross - v_disc, 2));
END;
$function$;

CREATE OR REPLACE FUNCTION public._reschedule_price_preview(
  p_booking_id uuid,
  p_new_start time,
  p_new_end time,
  p_new_pkg_start time,
  p_new_pkg_end time
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_basis public.booking_price_basis%ROWTYPE;
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_basis := public._ensure_price_basis(p_booking_id);
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  v_old := public._price_at_window(v_b, v_basis, v_basis.priced_start_time, v_basis.priced_end_time,
                                   v_basis.priced_package_start_time, v_basis.priced_package_end_time);
  v_new := public._price_at_window(v_b, v_basis, p_new_start, p_new_end, p_new_pkg_start, p_new_pkg_end);
  RETURN jsonb_build_object(
    'old_hours', v_old->'hours', 'new_hours', v_new->'hours',
    'old_package_hours', v_old->'package_hours', 'new_package_hours', v_new->'package_hours',
    'old_base_rental', v_old->'base_rental', 'new_base_rental', v_new->'base_rental',
    'old_package_cost', v_old->'package_cost', 'new_package_cost', v_new->'package_cost',
    'old_discount', v_old->'discount', 'new_discount', v_new->'discount',
    'discount_basis', v_basis.discount_type,
    'old_total', v_old->'total', 'new_total', v_new->'total',
    'delta_base_rental', round((v_new->>'base_rental')::numeric - (v_old->>'base_rental')::numeric, 2),
    'delta_package_cost', round((v_new->>'package_cost')::numeric - (v_old->>'package_cost')::numeric, 2),
    'delta_discount', round((v_new->>'discount')::numeric - (v_old->>'discount')::numeric, 2),
    'delta', round((v_new->>'total')::numeric - (v_old->>'total')::numeric, 2),
    'stored_total', v_b.total_amount,
    'priced_window', jsonb_build_object(
      'start', v_basis.priced_start_time::text, 'end', v_basis.priced_end_time::text,
      'package_start', v_basis.priced_package_start_time::text, 'package_end', v_basis.priced_package_end_time::text),
    'new_window', jsonb_build_object(
      'start', p_new_start::text, 'end', p_new_end::text,
      'package_start', p_new_pkg_start::text, 'package_end', p_new_pkg_end::text)
  );
END;
$function$;

-- The window in a review becomes the settled one (its price is decided).
CREATE OR REPLACE FUNCTION public._settle_price_window(p_booking_id uuid, p_window jsonb)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.booking_price_basis
  SET priced_start_time = (p_window->>'start')::time,
      priced_end_time = (p_window->>'end')::time,
      priced_package_start_time = (p_window->>'package_start')::time,
      priced_package_end_time = (p_window->>'package_end')::time,
      updated_at = now()
  WHERE booking_id = p_booking_id;
$function$;

REVOKE ALL ON FUNCTION public._ensure_price_basis(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._price_at_window(public.bookings, public.booking_price_basis, time, time, time, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._reschedule_price_preview(uuid, time, time, time, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._settle_price_window(uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- reschedule_booking: live definition + M-1 (marked "M-1").
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reschedule_booking(p_booking_id uuid, p_new_date date, p_new_start_time text DEFAULT NULL::text, p_new_end_time text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_actor_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_conflict RECORD;
  v_block RECORD;
  v_old_values jsonb;
  v_new_values jsonb;
  v_date_shift_days integer;
  v_jobs_updated integer := 0;
  v_jobs_cancelled_past_due integer := 0;
  v_blocks_moved integer := 0;
  v_target_start text;
  v_target_end text;
  v_orlando_today date := (now() AT TIME ZONE 'America/New_York')::date;
  v_changed boolean;
  v_one_hour_report_reopened boolean := false;
  -- M-1
  v_event_end timestamptz;
  v_hours_changed boolean;
  v_new_pkg_start time;
  v_new_pkg_end time;
  v_pkg_note text;
  v_price jsonb;
  v_price_review_id uuid;
  v_staff jsonb;
  v_staff_review_id uuid;
BEGIN
  -- Lock the booking row to prevent race conditions
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'booking_not_found',
      'message', 'Booking not found'
    );
  END IF;

  -- Cannot reschedule cancelled bookings
  IF v_booking.status = 'cancelled' OR v_booking.lifecycle_status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'booking_cancelled',
      'message', 'Cannot reschedule a cancelled booking'
    );
  END IF;

  -- M-1: an event that already happened is not moved (its staff, payroll and
  -- revenue belong to the day it ran).
  IF v_booking.lifecycle_status IN ('post_event', 'closed_review_complete') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'event_already_happened',
      'message', 'This event already happened and cannot be rescheduled'
    );
  END IF;
  v_event_end := public._booking_event_end_at(p_booking_id);
  IF v_event_end IS NOT NULL AND v_event_end < now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'event_already_happened',
      'message', 'This event already ended and cannot be rescheduled'
    );
  END IF;

  IF p_new_date IS NULL OR p_new_date < v_orlando_today THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'past_date',
      'message', format('Cannot reschedule to a past date (today in Orlando is %s)', v_orlando_today::text)
    );
  END IF;

  -- Determine target times based on EXISTING booking_type (NEVER change it)
  IF v_booking.booking_type = 'hourly' THEN
    -- Hourly: start and end times are REQUIRED
    IF p_new_start_time IS NULL OR p_new_end_time IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'times_required',
        'message', 'Start and end times are required for hourly bookings'
      );
    END IF;

    -- Validate end > start for hourly
    IF p_new_end_time::time <= p_new_start_time::time THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'invalid_time_range',
        'message', 'End time must be after start time'
      );
    END IF;

    v_target_start := p_new_start_time;
    v_target_end := p_new_end_time;

  ELSE
    -- Daily: start and end times are OPTIONAL (event window for planning)
    -- If provided, validate end > start
    IF p_new_start_time IS NOT NULL AND p_new_end_time IS NOT NULL THEN
      IF p_new_end_time::time <= p_new_start_time::time THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'invalid_event_window',
          'message', 'Event window end time must be after start time'
        );
      END IF;
    END IF;

    -- For daily, store the event window (can be NULL)
    v_target_start := p_new_start_time;
    v_target_end := p_new_end_time;
  END IF;

  -- Serialize reschedules onto the same date: without this, two admins moving
  -- two different bookings onto one free slot both pass the checks below.
  -- (Website checkouts don't take this lock; that is a wider, separate gap.)
  PERFORM pg_advisory_xact_lock(hashtext('oev_booking_date:' || p_new_date::text));

  -- CONFLICT CHECKING
  IF v_booking.booking_type = 'daily' THEN
    -- Daily bookings block the ENTIRE day
    -- Conflict if ANY other non-cancelled booking exists on that date
    SELECT id, full_name, booking_type, event_date, start_time, end_time
    INTO v_conflict
    FROM public.bookings
    WHERE event_date = p_new_date
      AND id != p_booking_id
      AND status NOT IN ('cancelled', 'declined')
      AND payment_status NOT IN ('failed', 'refunded')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'date_conflict',
        'message', format('Date %s is already reserved by %s (%s booking)',
          p_new_date::text, v_conflict.full_name, v_conflict.booking_type),
        'conflict', jsonb_build_object(
          'booking_id', v_conflict.id,
          'guest', v_conflict.full_name,
          'type', v_conflict.booking_type
        )
      );
    END IF;

  ELSE
    -- Hourly booking conflict checking
    -- First check for daily booking on that date (blocks entire day)
    SELECT id, full_name, booking_type
    INTO v_conflict
    FROM public.bookings
    WHERE event_date = p_new_date
      AND id != p_booking_id
      AND booking_type = 'daily'
      AND status NOT IN ('cancelled', 'declined')
      AND payment_status NOT IN ('failed', 'refunded')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'daily_conflict',
        'message', format('Date %s has a full-day rental by %s',
          p_new_date::text, v_conflict.full_name),
        'conflict', jsonb_build_object(
          'booking_id', v_conflict.id,
          'guest', v_conflict.full_name,
          'type', 'daily'
        )
      );
    END IF;

    -- Check for hourly overlap using time comparison
    SELECT id, full_name, start_time, end_time
    INTO v_conflict
    FROM public.bookings
    WHERE event_date = p_new_date
      AND id != p_booking_id
      AND booking_type = 'hourly'
      AND status NOT IN ('cancelled', 'declined')
      AND payment_status NOT IN ('failed', 'refunded')
      AND start_time IS NOT NULL
      AND end_time IS NOT NULL
      -- Overlap: existingStart < newEnd AND existingEnd > newStart
      AND start_time < v_target_end::time
      AND end_time > v_target_start::time
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'time_overlap',
        'message', format('Time %s-%s overlaps with %s''s booking (%s-%s)',
          v_target_start, v_target_end, v_conflict.full_name,
          v_conflict.start_time::text, v_conflict.end_time::text),
        'conflict', jsonb_build_object(
          'booking_id', v_conflict.id,
          'guest', v_conflict.full_name,
          'start_time', v_conflict.start_time::text,
          'end_time', v_conflict.end_time::text
        )
      );
    END IF;
  END IF;

  -- Availability blocks (manual blackouts, internal/external holds) that are
  -- not this booking's own block. A block tied to another booking only counts
  -- while that booking is still active.
  SELECT ab.id, ab.block_type, ab.source, ab.start_time, ab.end_time, ab.notes
  INTO v_block
  FROM public.availability_blocks ab
  WHERE p_new_date BETWEEN ab.start_date AND ab.end_date
    AND ab.booking_id IS DISTINCT FROM p_booking_id
    AND (
      ab.booking_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.bookings ob
        WHERE ob.id = ab.booking_id
          AND ob.status NOT IN ('cancelled', 'declined')
      )
    )
    AND (
      v_booking.booking_type = 'daily'
      OR ab.block_type = 'daily'
      OR ab.start_time IS NULL
      OR ab.end_time IS NULL
      OR (ab.start_time < v_target_end::time AND ab.end_time > v_target_start::time)
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'blocked_date',
      'message', format('Date %s is blocked on the availability calendar (%s block%s)',
        p_new_date::text, v_block.block_type,
        CASE WHEN v_block.start_time IS NOT NULL
          THEN format(' %s-%s', v_block.start_time::text, v_block.end_time::text)
          ELSE '' END),
      'conflict', jsonb_build_object(
        'block_id', v_block.id,
        'type', v_block.block_type,
        'source', v_block.source
      )
    );
  END IF;

  -- M-1: package window follows the new event window.
  --   * package covered the whole old event -> it covers the whole new one;
  --   * otherwise it is clamped to the new window;
  --   * nothing left after clamping -> it takes the new window (flagged).
  v_new_pkg_start := v_booking.package_start_time;
  v_new_pkg_end := v_booking.package_end_time;
  IF COALESCE(v_booking.package, 'none') <> 'none'
     AND v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL
     AND v_target_start IS NOT NULL AND v_target_end IS NOT NULL THEN
    IF v_booking.package_end_time <= v_booking.package_start_time THEN
      v_pkg_note := 'package_window_overnight_not_moved';
    ELSIF v_booking.start_time IS NOT NULL AND v_booking.end_time IS NOT NULL
       AND v_booking.package_start_time = v_booking.start_time
       AND v_booking.package_end_time = v_booking.end_time THEN
      v_new_pkg_start := v_target_start::time;
      v_new_pkg_end := v_target_end::time;
    ELSE
      v_new_pkg_start := greatest(v_booking.package_start_time, v_target_start::time);
      v_new_pkg_end := least(v_booking.package_end_time, v_target_end::time);
      IF v_new_pkg_end <= v_new_pkg_start THEN
        v_new_pkg_start := v_target_start::time;
        v_new_pkg_end := v_target_end::time;
        v_pkg_note := 'package_window_reset_to_event';
      END IF;
    END IF;
  END IF;

  -- Capture old values for audit
  v_old_values := jsonb_build_object(
    'event_date', v_booking.event_date,
    'start_time', v_booking.start_time::text,
    'end_time', v_booking.end_time::text,
    'booking_type', v_booking.booking_type,
    'package_start_time', v_booking.package_start_time::text,
    'package_end_time', v_booking.package_end_time::text
  );

  v_hours_changed := v_target_start::time IS DISTINCT FROM v_booking.start_time
    OR v_target_end::time IS DISTINCT FROM v_booking.end_time;
  v_changed := p_new_date IS DISTINCT FROM v_booking.event_date OR v_hours_changed;

  -- M-1: price of the new hours against the settled window, at the rates
  -- the booking was sold at (before the row changes).
  v_price := public._reschedule_price_preview(p_booking_id, v_target_start::time, v_target_end::time, v_new_pkg_start, v_new_pkg_end);

  -- Calculate date shift for job rescheduling
  v_date_shift_days := p_new_date - v_booking.event_date;

  -- Update the booking (NEVER change booking_type)
  UPDATE public.bookings
  SET
    event_date = p_new_date,
    start_time = CASE WHEN v_target_start IS NOT NULL THEN v_target_start::time ELSE NULL END,
    end_time = CASE WHEN v_target_end IS NOT NULL THEN v_target_end::time ELSE NULL END,
    package_start_time = v_new_pkg_start,
    package_end_time = v_new_pkg_end,
    updated_at = NOW()
  WHERE id = p_booking_id;

  IF v_date_shift_days <> 0 THEN
    -- A job shifted into the past would fire on the next cron tick. Cancel it
    -- (evaluated on the original run_at, before anything is shifted); the
    -- schedulers decide whether it still applies to the new date.
    UPDATE public.scheduled_jobs
    SET
      status = 'cancelled',
      last_error = 'reschedule_past_due',
      updated_at = NOW()
    WHERE booking_id = p_booking_id
      AND status = 'pending'
      AND run_at + make_interval(days => v_date_shift_days) < NOW();

    GET DIAGNOSTICS v_jobs_cancelled_past_due = ROW_COUNT;

    -- Fallback shift for the rest: reschedule-booking recomputes them
    -- precisely right after, but if that step fails the chain is still
    -- roughly on the new date.
    UPDATE public.scheduled_jobs
    SET
      run_at = run_at + make_interval(days => v_date_shift_days),
      updated_at = NOW()
    WHERE booking_id = p_booking_id
      AND status = 'pending';

    GET DIAGNOSTICS v_jobs_updated = ROW_COUNT;
  END IF;

  -- one_hour_report is one-shot ('true' once the closeout fired). When the
  -- event moves to another day whose end-1h is still ahead, reopen it here, in
  -- the same transaction, so the closeout for the new date is scheduled even
  -- if a follow-up scheduler call fails and is retried with the same date.
  -- Same-day time edits keep the flag (no second closeout for one event).
  -- End time mirrors schedule-host-report-reminders: daily or no end → 23:59:59.
  IF v_date_shift_days <> 0
     AND v_booking.one_hour_report = 'true'
     AND ((p_new_date + CASE
             WHEN v_booking.booking_type = 'daily' OR v_target_end IS NULL THEN time '23:59:59'
             ELSE v_target_end::time
           END) AT TIME ZONE 'America/New_York') - interval '1 hour' > now()
  THEN
    UPDATE public.bookings SET one_hour_report = 'false' WHERE id = p_booking_id;
    v_one_hour_report_reopened := true;
  END IF;

  -- Move this booking's own availability block(s) with it.
  UPDATE public.availability_blocks
  SET
    start_date = p_new_date,
    end_date = p_new_date + (end_date - start_date),
    start_time = CASE WHEN block_type = 'hourly'
      THEN COALESCE(v_target_start::time, start_time) ELSE start_time END,
    end_time = CASE WHEN block_type = 'hourly'
      THEN COALESCE(v_target_end::time, end_time) ELSE end_time END
  WHERE booking_id = p_booking_id;

  GET DIAGNOSTICS v_blocks_moved = ROW_COUNT;

  -- M-1: price review. A newer reschedule replaces an older open review
  -- (its delta is computed against the same stored total, so it already
  -- includes the earlier change).
  IF abs((v_price->>'delta')::numeric) >= 0.01 THEN
    UPDATE public.booking_money_reviews
    SET status = 'superseded', resolved_at = now()
    WHERE booking_id = p_booking_id AND kind = 'reschedule_price' AND status = 'open';
    INSERT INTO public.booking_money_reviews (booking_id, kind, details)
    VALUES (p_booking_id, 'reschedule_price', v_price || jsonb_build_object(
      'old_values', v_old_values,
      'new_event_date', p_new_date,
      'new_start_time', v_target_start,
      'new_end_time', v_target_end,
      'new_package_start_time', v_new_pkg_start::text,
      'new_package_end_time', v_new_pkg_end::text,
      'package_note', v_pkg_note,
      'actor_id', p_actor_id
    ))
    RETURNING id INTO v_price_review_id;
  ELSIF v_changed THEN
    -- No price difference against the settled window (same length, or back
    -- to the settled hours): any open review no longer applies and the new
    -- window is the settled one.
    UPDATE public.booking_money_reviews
    SET status = 'superseded', resolved_at = now()
    WHERE booking_id = p_booking_id AND kind = 'reschedule_price' AND status = 'open';
    PERFORM public._settle_price_window(p_booking_id, v_price->'new_window');
  END IF;

  -- M-1: staff hours review (flag, never clamp).
  IF v_changed THEN
    SELECT jsonb_agg(jsonb_build_object(
             'assignment_id', a.id,
             'staff_id', a.staff_id,
             'staff_name', s.full_name,
             'role', a.assignment_role,
             'response_status', a.response_status,
             'scheduled_start_time', a.scheduled_start_time::text,
             'scheduled_end_time', a.scheduled_end_time::text,
             'outside_new_window', (
               v_target_start IS NOT NULL AND v_target_end IS NOT NULL
               AND a.scheduled_start_time IS NOT NULL AND a.scheduled_end_time IS NOT NULL
               AND (a.scheduled_start_time < v_target_start::time OR a.scheduled_end_time > v_target_end::time)
             )
           ) ORDER BY a.created_at)
    INTO v_staff
    FROM public.booking_staff_assignments a
    LEFT JOIN public.staff_members s ON s.id = a.staff_id
    WHERE a.booking_id = p_booking_id
      AND a.status NOT IN ('cancelled', 'completed')
      AND COALESCE(a.response_status, 'pending') <> 'rejected';

    IF v_staff IS NOT NULL THEN
      UPDATE public.booking_money_reviews
      SET status = 'superseded', resolved_at = now()
      WHERE booking_id = p_booking_id AND kind = 'staff_hours' AND status = 'open';
      INSERT INTO public.booking_money_reviews (booking_id, kind, details)
      VALUES (p_booking_id, 'staff_hours', jsonb_build_object(
        'assignments', v_staff,
        'old_values', v_old_values,
        'new_event_date', p_new_date,
        'new_start_time', v_target_start,
        'new_end_time', v_target_end,
        'date_changed', p_new_date IS DISTINCT FROM v_booking.event_date,
        'hours_changed', v_hours_changed
      ))
      RETURNING id INTO v_staff_review_id;
    END IF;
  END IF;

  -- Build new values for audit
  v_new_values := jsonb_build_object(
    'event_date', p_new_date,
    'start_time', v_target_start,
    'end_time', v_target_end,
    'booking_type', v_booking.booking_type,
    'package_start_time', v_new_pkg_start::text,
    'package_end_time', v_new_pkg_end::text
  );

  -- Record audit event
  INSERT INTO public.booking_events (
    booking_id,
    event_type,
    channel,
    metadata
  ) VALUES (
    p_booking_id,
    'booking_rescheduled',
    'admin',
    jsonb_build_object(
      'old_values', v_old_values,
      'new_values', v_new_values,
      'changed', v_changed,
      'reason', COALESCE(p_reason, ''),
      'actor_id', p_actor_id,
      'jobs_updated', v_jobs_updated,
      'jobs_cancelled_past_due', v_jobs_cancelled_past_due,
      'blocks_moved', v_blocks_moved,
      'one_hour_report_reopened', v_one_hour_report_reopened,
      'date_shift_days', v_date_shift_days,
      'price', v_price,
      'price_review_id', v_price_review_id,
      'staff_review_id', v_staff_review_id,
      'package_note', v_pkg_note
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'changed', v_changed,
    'old_values', v_old_values,
    'new_values', v_new_values,
    'jobs_updated', v_jobs_updated,
    'jobs_cancelled_past_due', v_jobs_cancelled_past_due,
    'blocks_moved', v_blocks_moved,
    'one_hour_report_reopened', v_one_hour_report_reopened,
    'date_shift_days', v_date_shift_days,
    'lifecycle_status', v_booking.lifecycle_status,
    'payment_status', v_booking.payment_status,
    'has_event_window', (v_target_start IS NOT NULL AND v_target_end IS NOT NULL),
    'price', v_price,
    'price_review_id', v_price_review_id,
    'staff_review_id', v_staff_review_id,
    'staff_to_review', COALESCE(jsonb_array_length(v_staff), 0),
    'package_note', v_pkg_note
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', 'internal_error',
    'message', SQLERRM
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.reschedule_booking(uuid, date, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid, date, text, text, text, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- The office's answer to a price review (D8).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_resolve_reschedule_price(
  p_review_id uuid,
  p_decision text,
  p_reference text DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_review public.booking_money_reviews%ROWTYPE;
  v_b public.bookings%ROWTYPE;
  v_delta numeric;
  v_new_balance numeric;
  v_reference text := NULLIF(btrim(COALESCE(p_reference, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_details jsonb;
  v_link_job boolean := false;
BEGIN
  PERFORM public._assert_admin_or_service();

  IF p_decision IS NULL OR p_decision NOT IN ('apply_to_balance', 'charged_separately', 'refunded_separately', 'waived') THEN
    RAISE EXCEPTION 'decision must be apply_to_balance, charged_separately, refunded_separately or waived'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_review FROM public.booking_money_reviews WHERE id = p_review_id;
  IF NOT FOUND OR v_review.kind <> 'reschedule_price' THEN
    RAISE EXCEPTION 'price review not found' USING ERRCODE = 'P0002';
  END IF;

  -- Lock order: booking, then review (same as reschedule_booking).
  SELECT * INTO v_b FROM public.bookings WHERE id = v_review.booking_id FOR UPDATE;
  SELECT * INTO v_review FROM public.booking_money_reviews WHERE id = p_review_id FOR UPDATE;
  IF v_review.status <> 'open' THEN
    RAISE EXCEPTION 'this price review is already %; reload the page', v_review.status USING ERRCODE = 'P0001';
  END IF;
  IF v_b.status = 'cancelled'::booking_status OR v_b.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is cancelled; use the refund decision instead' USING ERRCODE = 'P0001';
  END IF;

  v_delta := (v_review.details->>'delta')::numeric;

  IF p_decision = 'apply_to_balance' THEN
    IF abs(COALESCE(v_b.total_amount, 0) - (v_review.details->>'stored_total')::numeric) > 0.01 THEN
      RAISE EXCEPTION 'the booking total changed since this review; reschedule again to get a fresh price'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_b.balance_paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'the balance is already paid; charge or refund the difference separately'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_b.balance_link_expires_at IS NOT NULL AND v_b.balance_link_expires_at > now() THEN
      RAISE EXCEPTION 'a balance payment link for the old amount is live until %; apply after it expires or charge/refund separately',
        to_char(v_b.balance_link_expires_at AT TIME ZONE 'America/New_York', 'Mon DD HH12:MI AM')
        USING ERRCODE = 'P0001';
    END IF;
    v_new_balance := round(COALESCE(v_b.balance_amount, 0) + v_delta, 2);
    IF v_new_balance < 0 THEN
      RAISE EXCEPTION 'the reduction (%) is larger than the unpaid balance (%); refund the rest separately',
        to_char(-v_delta, 'FM999999990.00'), to_char(COALESCE(v_b.balance_amount, 0), 'FM999999990.00')
        USING ERRCODE = 'P0001';
    END IF;

    -- Increments, not absolutes: earlier differences settled outside the
    -- booking (charged/refunded separately) stay out of its totals.
    UPDATE public.bookings
    SET base_rental = COALESCE(base_rental, 0) + (v_review.details->>'delta_base_rental')::numeric,
        package_cost = COALESCE(package_cost, 0) + (v_review.details->>'delta_package_cost')::numeric,
        discount_amount = COALESCE(discount_amount, 0) + (v_review.details->>'delta_discount')::numeric,
        total_amount = COALESCE(total_amount, 0) + v_delta,
        balance_amount = v_new_balance,
        -- An expired link for the old amount must not count as "already sent":
        -- the balance chain creates a fresh one for the new amount.
        balance_payment_url = NULL,
        balance_link_expires_at = NULL,
        updated_at = now()
    WHERE id = v_b.id;

    PERFORM public.populate_booking_revenue_items(v_b.id, false);

    -- Codex review: create-balance-payment-link refuses a balance that differs
    -- from the latest price snapshot, so the approved adjustment is recorded
    -- as one (same transaction).
    INSERT INTO public.booking_price_snapshots (
      booking_id, reason, coupon_id, discount_code, discount_type, discount_value, discount_applies_to,
      discount_amount, gross_subtotal, total_amount, deposit_amount, balance_amount,
      processing_fee_pct, deposit_fee, deposit_total_charged, note, created_by)
    SELECT b.id, 'admin_correction', s.coupon_id, b.discount_code, s.discount_type, s.discount_value, s.discount_applies_to,
           COALESCE(b.discount_amount, 0), COALESCE(b.total_amount, 0) + COALESCE(b.discount_amount, 0), b.total_amount,
           b.deposit_amount, b.balance_amount,
           s.processing_fee_pct, b.deposit_fee, b.deposit_total_charged,
           'reschedule price review ' || p_review_id::text, COALESCE(v_actor::text, 'admin')
    FROM public.bookings b
    LEFT JOIN LATERAL (
      SELECT * FROM public.booking_price_snapshots ps WHERE ps.booking_id = b.id ORDER BY ps.created_at DESC LIMIT 1
    ) s ON true
    WHERE b.id = v_b.id;

    -- Codex review: the new amount must reach the guest. Pending balance
    -- jobs already read the booking at run time; if none is left, queue a
    -- link (at the T-15 point, or now if that has passed). Same transaction,
    -- so the decision cannot be saved without its follow-up.
    IF v_new_balance > 0 AND v_b.deposit_paid_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.scheduled_jobs
      WHERE booking_id = v_b.id
        AND job_type IN ('balance_retry_1', 'balance_retry_2', 'balance_retry_3', 'create_balance_payment_link')
        AND status IN ('pending', 'processing')
    ) THEN
      INSERT INTO public.scheduled_jobs (job_type, booking_id, run_at, status)
      VALUES ('create_balance_payment_link', v_b.id,
              greatest(now(), ((v_b.event_date - 15) + time '09:00') AT TIME ZONE 'America/New_York'),
              'pending');
      v_link_job := true;
    END IF;
  ELSIF p_decision = 'charged_separately' THEN
    IF v_delta <= 0 THEN
      RAISE EXCEPTION 'nothing to charge: the new hours cost less' USING ERRCODE = 'P0001';
    END IF;
    IF v_reference IS NULL THEN
      RAISE EXCEPTION 'add the invoice number or payment reference' USING ERRCODE = '22023';
    END IF;
  ELSIF p_decision = 'refunded_separately' THEN
    IF v_delta >= 0 THEN
      RAISE EXCEPTION 'nothing to refund: the new hours cost more' USING ERRCODE = 'P0001';
    END IF;
    IF v_reference IS NULL THEN
      RAISE EXCEPTION 'add the refund reference (Stripe refund id, Zelle confirmation, check #)' USING ERRCODE = '22023';
    END IF;
  ELSE
    IF v_note IS NULL THEN
      RAISE EXCEPTION 'say why the difference is waived' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;
  END IF;
  v_details := jsonb_build_object(
    'delta', v_delta,
    'reference', v_reference,
    'note', v_note,
    'new_balance', v_new_balance,
    'balance_link_job_queued', v_link_job,
    'recorded_by_email', v_actor_email
  );

  UPDATE public.booking_money_reviews
  SET status = 'resolved', decision = p_decision, decision_details = v_details,
      resolved_at = now(), resolved_by = v_actor
  WHERE id = p_review_id;

  -- Whatever was decided, this window's price is settled: the next
  -- reschedule is priced from here.
  PERFORM public._settle_price_window(v_b.id, v_review.details->'new_window');

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (v_b.id, 'reschedule_price_resolved', 'admin',
          v_details || jsonb_build_object('review_id', p_review_id, 'decision', p_decision, 'recorded_by', v_actor));

  RETURN jsonb_build_object('review_id', p_review_id, 'decision', p_decision, 'delta', v_delta, 'new_balance', v_new_balance);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_resolve_reschedule_price(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_resolve_reschedule_price(uuid, text, text, text) TO authenticated, service_role;

-- Staff hours reviewed (the office checked each person's hours).
CREATE OR REPLACE FUNCTION public.admin_mark_staff_hours_reviewed(p_review_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := auth.uid();
  v_booking uuid;
BEGIN
  PERFORM public._assert_admin_or_service();
  UPDATE public.booking_money_reviews
  SET status = 'resolved', decision = 'reviewed',
      decision_details = jsonb_build_object('note', NULLIF(btrim(COALESCE(p_note, '')), '')),
      resolved_at = now(), resolved_by = v_actor
  WHERE id = p_review_id AND kind = 'staff_hours' AND status = 'open'
  RETURNING booking_id INTO v_booking;
  IF v_booking IS NULL THEN
    RAISE EXCEPTION 'staff hours review not found or already closed; reload the page' USING ERRCODE = 'P0001';
  END IF;
  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (v_booking, 'staff_hours_reviewed', 'admin', jsonb_build_object('review_id', p_review_id, 'recorded_by', v_actor));
  RETURN jsonb_build_object('review_id', p_review_id, 'status', 'resolved');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_mark_staff_hours_reviewed(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_mark_staff_hours_reviewed(uuid, text) TO authenticated, service_role;
