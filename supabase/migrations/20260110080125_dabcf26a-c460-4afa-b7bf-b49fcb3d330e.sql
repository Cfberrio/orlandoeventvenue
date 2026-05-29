-- Fix reschedule_booking to cast text to time properly
DROP FUNCTION IF EXISTS public.reschedule_booking(uuid, date, text, text, text, uuid);

CREATE OR REPLACE FUNCTION public.reschedule_booking(
  p_booking_id uuid,
  p_new_date date,
  p_new_start_time text DEFAULT NULL,
  p_new_end_time text DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_conflict RECORD;
  v_old_values jsonb;
  v_new_values jsonb;
  v_date_shift_days integer;
  v_jobs_updated integer;
  v_target_start text;
  v_target_end text;
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

  -- Capture old values for audit
  v_old_values := jsonb_build_object(
    'event_date', v_booking.event_date,
    'start_time', v_booking.start_time::text,
    'end_time', v_booking.end_time::text,
    'booking_type', v_booking.booking_type
  );

  -- Calculate date shift for job rescheduling
  v_date_shift_days := p_new_date - v_booking.event_date;

  -- Update the booking (NEVER change booking_type)
  -- Cast text to time for the update
  UPDATE public.bookings
  SET 
    event_date = p_new_date,
    start_time = CASE WHEN v_target_start IS NOT NULL THEN v_target_start::time ELSE NULL END,
    end_time = CASE WHEN v_target_end IS NOT NULL THEN v_target_end::time ELSE NULL END,
    updated_at = NOW()
  WHERE id = p_booking_id;

  -- Reschedule pending jobs by shifting their run_at
  UPDATE public.scheduled_jobs
  SET 
    run_at = run_at + (v_date_shift_days || ' days')::interval,
    updated_at = NOW()
  WHERE booking_id = p_booking_id
    AND status = 'pending';
  
  GET DIAGNOSTICS v_jobs_updated = ROW_COUNT;

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
      'reason', COALESCE(p_reason, ''),
      'actor_id', p_actor_id,
      'jobs_updated', v_jobs_updated,
      'date_shift_days', v_date_shift_days
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'old_values', v_old_values,
    'new_values', v_new_values,
    'jobs_updated', v_jobs_updated,
    'date_shift_days', v_date_shift_days,
    'has_event_window', (v_target_start IS NOT NULL AND v_target_end IS NOT NULL)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'ok', false,
    'error', 'internal_error',
    'message', SQLERRM
  );
END;
$$;