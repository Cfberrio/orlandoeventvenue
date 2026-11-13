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
-- Price of the new hours at the rates this booking was sold at (implied from
-- its stored lines), not today's price list. Discount follows its snapshot
-- terms when known, otherwise scales with the base rental.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._reschedule_price_preview(
  p_booking public.bookings,
  p_new_start text,
  p_new_end text,
  p_new_pkg_start text,
  p_new_pkg_end text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_old_hours numeric;
  v_new_hours numeric;
  v_old_pkg_hours numeric;
  v_new_pkg_hours numeric;
  v_old_base numeric := COALESCE(p_booking.base_rental, 0);
  v_old_pkg numeric := COALESCE(p_booking.package_cost, 0);
  v_old_disc numeric := COALESCE(p_booking.discount_amount, 0);
  v_old_total numeric := COALESCE(p_booking.total_amount, 0);
  v_new_base numeric;
  v_new_pkg numeric;
  v_new_disc numeric;
  v_new_gross numeric;
  v_new_total numeric;
  v_snap record;
  v_disc_basis text := 'none';
BEGIN
  IF p_booking.booking_type = 'hourly'
     AND p_booking.start_time IS NOT NULL AND p_booking.end_time IS NOT NULL
     AND p_new_start IS NOT NULL AND p_new_end IS NOT NULL THEN
    v_old_hours := extract(epoch FROM (p_booking.end_time - p_booking.start_time)) / 3600.0;
    v_new_hours := extract(epoch FROM (p_new_end::time - p_new_start::time)) / 3600.0;
  END IF;
  v_new_base := CASE WHEN v_old_hours > 0 AND v_new_hours > 0
                     THEN round(v_old_base / v_old_hours * v_new_hours, 2)
                     ELSE v_old_base END;

  IF COALESCE(p_booking.package, 'none') <> 'none'
     AND p_booking.package_start_time IS NOT NULL AND p_booking.package_end_time IS NOT NULL
     AND p_new_pkg_start IS NOT NULL AND p_new_pkg_end IS NOT NULL
     AND p_booking.package_end_time::time > p_booking.package_start_time::time
     AND p_new_pkg_end::time > p_new_pkg_start::time THEN
    v_old_pkg_hours := extract(epoch FROM (p_booking.package_end_time::time - p_booking.package_start_time::time)) / 3600.0;
    v_new_pkg_hours := extract(epoch FROM (p_new_pkg_end::time - p_new_pkg_start::time)) / 3600.0;
  END IF;
  v_new_pkg := CASE WHEN v_old_pkg_hours > 0 AND v_new_pkg_hours > 0
                    THEN round(v_old_pkg / v_old_pkg_hours * v_new_pkg_hours, 2)
                    ELSE v_old_pkg END;

  v_new_gross := (v_old_total + v_old_disc) - v_old_base - v_old_pkg + v_new_base + v_new_pkg;

  SELECT discount_type, discount_value, discount_applies_to INTO v_snap
  FROM public.booking_price_snapshots
  WHERE booking_id = p_booking.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_old_disc <= 0 THEN
    v_new_disc := 0;
  ELSIF v_snap.discount_type = 'fixed_amount' THEN
    v_disc_basis := 'fixed';
    v_new_disc := least(COALESCE(v_snap.discount_value, v_old_disc),
                        CASE WHEN v_snap.discount_applies_to = 'total' THEN v_new_gross ELSE v_new_base END);
  ELSIF v_snap.discount_type = 'percentage' THEN
    v_disc_basis := 'percentage';
    v_new_disc := round(
      CASE WHEN v_snap.discount_applies_to = 'total' THEN v_new_gross ELSE v_new_base END
      * least(COALESCE(v_snap.discount_value, 0), 100) / 100.0, 2);
  ELSIF v_old_base > 0 THEN
    v_disc_basis := 'scaled_with_base';
    v_new_disc := round(v_old_disc * v_new_base / v_old_base, 2);
  ELSE
    v_disc_basis := 'unchanged';
    v_new_disc := v_old_disc;
  END IF;
  v_new_disc := greatest(0, least(v_new_disc, v_new_gross));

  v_new_total := round(v_new_gross - v_new_disc, 2);

  RETURN jsonb_build_object(
    'old_hours', round(v_old_hours, 2),
    'new_hours', round(v_new_hours, 2),
    'old_package_hours', round(v_old_pkg_hours, 2),
    'new_package_hours', round(v_new_pkg_hours, 2),
    'old_base_rental', v_old_base,
    'new_base_rental', v_new_base,
    'old_package_cost', v_old_pkg,
    'new_package_cost', v_new_pkg,
    'old_discount', v_old_disc,
    'new_discount', v_new_disc,
    'discount_basis', v_disc_basis,
    'old_total', v_old_total,
    'new_total', v_new_total,
    'delta', round(v_new_total - v_old_total, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._reschedule_price_preview(public.bookings, text, text, text, text) FROM PUBLIC, anon, authenticated;

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
  v_booking_row public.bookings%ROWTYPE;
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

  -- M-1: price of the new hours (before the row changes).
  SELECT * INTO v_booking_row FROM public.bookings WHERE id = p_booking_id;
  v_price := public._reschedule_price_preview(v_booking_row, v_target_start, v_target_end, v_new_pkg_start::text, v_new_pkg_end::text);

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
    -- Back to the sold hours: an open price review no longer applies.
    UPDATE public.booking_money_reviews
    SET status = 'superseded', resolved_at = now()
    WHERE booking_id = p_booking_id AND kind = 'reschedule_price' AND status = 'open';
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
    IF abs(COALESCE(v_b.total_amount, 0) - (v_review.details->>'old_total')::numeric) > 0.01 THEN
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

    UPDATE public.bookings
    SET base_rental = (v_review.details->>'new_base_rental')::numeric,
        package_cost = (v_review.details->>'new_package_cost')::numeric,
        discount_amount = (v_review.details->>'new_discount')::numeric,
        total_amount = (v_review.details->>'new_total')::numeric,
        balance_amount = v_new_balance,
        -- An expired link for the old amount must not count as "already sent":
        -- the balance chain creates a fresh one for the new amount.
        balance_payment_url = NULL,
        balance_link_expires_at = NULL,
        updated_at = now()
    WHERE id = v_b.id;

    PERFORM public.populate_booking_revenue_items(v_b.id, false);
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
    'recorded_by_email', v_actor_email
  );

  UPDATE public.booking_money_reviews
  SET status = 'resolved', decision = p_decision, decision_details = v_details,
      resolved_at = now(), resolved_by = v_actor
  WHERE id = p_review_id;

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
