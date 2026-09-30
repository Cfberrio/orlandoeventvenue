-- reschedule_booking v2
--
-- The admin Reschedule dialog never reached this RPC in production (the
-- frontend fetched "undefined/functions/v1/reschedule-booking"). Fixing that
-- exposed gaps in the RPC itself:
--   * no past-date check (the client-side check was the only guard)
--   * availability_blocks were ignored: manual blackouts did not conflict, and
--     an external booking's own block stayed on the old date, so the public
--     calendar kept the old day taken and showed the new day free
--   * pending jobs were shifted by whole days, so moving a booking earlier
--     could land them in the past and the 5-minute cron fired them at once
--     (e.g. balance_retry_1/2/3 together)
--
-- Jobs keep the whole-day shift as a fallback, but any shifted job that would
-- land in the past is cancelled instead. reschedule-booking then rebuilds every
-- event-anchored job from the new date/time through the schedulers
-- (force_reschedule) and syncs GHL.
--
-- Signature and return shape are unchanged except for added keys. EXECUTE is
-- now limited to service_role (see the end of this file).

CREATE OR REPLACE FUNCTION public.reschedule_booking(
  p_booking_id uuid,
  p_new_date date,
  p_new_start_time text DEFAULT NULL::text,
  p_new_end_time text DEFAULT NULL::text,
  p_reason text DEFAULT NULL::text,
  p_actor_id uuid DEFAULT NULL::uuid
)
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
  IF v_booking.status = 'cancelled' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'booking_cancelled',
      'message', 'Cannot reschedule a cancelled booking'
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

  -- Capture old values for audit
  v_old_values := jsonb_build_object(
    'event_date', v_booking.event_date,
    'start_time', v_booking.start_time::text,
    'end_time', v_booking.end_time::text,
    'booking_type', v_booking.booking_type
  );

  v_changed := p_new_date IS DISTINCT FROM v_booking.event_date
    OR v_target_start::time IS DISTINCT FROM v_booking.start_time
    OR v_target_end::time IS DISTINCT FROM v_booking.end_time;

  -- Calculate date shift for job rescheduling
  v_date_shift_days := p_new_date - v_booking.event_date;

  -- Update the booking (NEVER change booking_type)
  UPDATE public.bookings
  SET
    event_date = p_new_date,
    start_time = CASE WHEN v_target_start IS NOT NULL THEN v_target_start::time ELSE NULL END,
    end_time = CASE WHEN v_target_end IS NOT NULL THEN v_target_end::time ELSE NULL END,
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

  -- Build new values for audit
  v_new_values := jsonb_build_object(
    'event_date', p_new_date,
    'start_time', v_target_start,
    'end_time', v_target_end,
    'booking_type', v_booking.booking_type
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
      'date_shift_days', v_date_shift_days
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
    'has_event_window', (v_target_start IS NOT NULL AND v_target_end IS NOT NULL)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', 'internal_error',
    'message', SQLERRM
  );
END;
$function$;

-- SECURITY DEFINER + EXECUTE for PUBLIC/anon/authenticated meant anyone with
-- the public anon key could reschedule any booking by calling this RPC
-- directly, skipping the admin check in reschedule-booking. The edge function
-- now calls it with a service-role client after verifying the admin role.
REVOKE EXECUTE ON FUNCTION public.reschedule_booking(uuid, date, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reschedule_booking(uuid, date, text, text, text, uuid) TO service_role;

-- At most one pending job per (booking, job_type). The force_reschedule paths
-- in the schedulers cancel then insert in separate requests; two overlapping
-- reschedules of the same booking could otherwise both insert a full chain
-- (and, on short notice, both create a Stripe balance link — the link is only
-- created after its retry job inserts, so the loser now fails first).
-- Checked 2026-09-30: no booking currently has duplicate pending jobs. Every
-- existing inserter either checks for a pending job first or only logs a
-- failed insert, so none of them breaks on the conflict.
CREATE UNIQUE INDEX IF NOT EXISTS scheduled_jobs_one_pending_per_type
  ON public.scheduled_jobs (booking_id, job_type)
  WHERE status = 'pending';
