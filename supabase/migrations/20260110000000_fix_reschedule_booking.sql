-- =====================================================
-- FIX RESCHEDULE BOOKING RPC FUNCTION
-- =====================================================
-- Changes:
-- 1. Remove p_new_booking_type parameter (booking_type never changes)
-- 2. Add validation for daily event window (optional, but if provided both times required and end > start)
-- 3. Correct conflict validation (daily blocks entire day)
-- 4. Simplify job rescheduling (always date shift, no recreation)

CREATE OR REPLACE FUNCTION public.reschedule_booking(
  p_booking_id uuid,
  p_new_date date,
  p_new_start_time time DEFAULT NULL,
  p_new_end_time time DEFAULT NULL,
  -- p_new_booking_type REMOVED (booking type never changes)
  p_reason text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_booking record;
  v_target_booking_type text;
  v_target_start time;
  v_target_end time;
  v_conflict_count integer;
  v_daily_conflict integer;
  v_conflicting_booking record;
  v_new_start_min integer;
  v_new_end_min integer;
  v_old_values jsonb;
  v_date_shift_days integer;
  v_jobs_updated integer := 0;
BEGIN
  -- 1. Lock booking (prevents race conditions)
  SELECT * INTO v_booking 
  FROM bookings 
  WHERE id = p_booking_id 
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'booking_not_found',
      'message', 'Booking not found'
    );
  END IF;
  
  -- 2. Determine target values (booking_type NEVER changes, use existing)
  v_target_booking_type := v_booking.booking_type::text;
  v_target_start := COALESCE(p_new_start_time, v_booking.start_time);
  v_target_end := COALESCE(p_new_end_time, v_booking.end_time);
  
  -- 3. Validate based on booking type
  
  -- For HOURLY: start and end times are required
  IF v_target_booking_type = 'hourly' AND (v_target_start IS NULL OR v_target_end IS NULL) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'validation_failed',
      'message', 'Hourly bookings require start_time and end_time'
    );
  END IF;
  
  -- For DAILY: event window is optional, but if provided, both times required and end > start
  IF v_target_booking_type = 'daily' THEN
    -- If both times provided, validate end > start
    IF v_target_start IS NOT NULL AND v_target_end IS NOT NULL THEN
      IF v_target_end <= v_target_start THEN
        RETURN jsonb_build_object(
          'ok', false,
          'error', 'validation_failed',
          'message', 'Event window end time must be after start time'
        );
      END IF;
    END IF;
    
    -- If only one time provided, reject
    IF (v_target_start IS NULL AND v_target_end IS NOT NULL) 
       OR (v_target_start IS NOT NULL AND v_target_end IS NULL) THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'validation_failed',
        'message', 'For event window, both start and end times must be provided (or both omitted)'
      );
    END IF;
  END IF;
  
  -- 4. Validate new date is not in the past
  IF p_new_date < CURRENT_DATE THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'validation_failed',
      'message', 'Cannot reschedule to a past date'
    );
  END IF;
  
  -- 5. Check conflicts (exclude self)
  
  -- For DAILY bookings: block entire day (reject if ANY booking exists)
  IF v_target_booking_type = 'daily' THEN
    SELECT COUNT(*) INTO v_conflict_count
    FROM bookings
    WHERE id != p_booking_id
      AND event_date = p_new_date
      AND status NOT IN ('cancelled', 'declined')
      AND payment_status IN ('deposit_paid', 'fully_paid', 'invoiced');
    
    IF v_conflict_count > 0 THEN
      -- Get details of one conflicting booking for error message
      SELECT * INTO v_conflicting_booking
      FROM bookings
      WHERE id != p_booking_id
        AND event_date = p_new_date
        AND status NOT IN ('cancelled', 'declined')
        AND payment_status IN ('deposit_paid', 'fully_paid', 'invoiced')
      LIMIT 1;
      
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'conflict',
        'message', 'That date is already reserved. Daily bookings block the entire day.',
        'conflict_booking', row_to_json(v_conflicting_booking)
      );
    END IF;
  END IF;
  
  -- For HOURLY bookings: check for daily blocks and hourly overlaps
  IF v_target_booking_type = 'hourly' THEN
    -- Check if any DAILY booking exists on that date
    SELECT COUNT(*) INTO v_daily_conflict
    FROM bookings
    WHERE id != p_booking_id
      AND event_date = p_new_date
      AND booking_type = 'daily'
      AND status NOT IN ('cancelled', 'declined')
      AND payment_status IN ('deposit_paid', 'fully_paid', 'invoiced');
    
    IF v_daily_conflict > 0 THEN
      SELECT * INTO v_conflicting_booking
      FROM bookings
      WHERE id != p_booking_id
        AND event_date = p_new_date
        AND booking_type = 'daily'
        AND status NOT IN ('cancelled', 'declined')
        AND payment_status IN ('deposit_paid', 'fully_paid', 'invoiced')
      LIMIT 1;
      
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'conflict',
        'message', 'That date has a daily booking (all times blocked)',
        'conflict_booking', row_to_json(v_conflicting_booking)
      );
    END IF;
    
    -- Check HOURLY overlaps (convert TIME to minutes for comparison)
    v_new_start_min := EXTRACT(HOUR FROM v_target_start)::integer * 60 + EXTRACT(MINUTE FROM v_target_start)::integer;
    v_new_end_min := EXTRACT(HOUR FROM v_target_end)::integer * 60 + EXTRACT(MINUTE FROM v_target_end)::integer;
    
    SELECT * INTO v_conflicting_booking
    FROM bookings b
    WHERE b.id != p_booking_id
      AND b.event_date = p_new_date
      AND b.booking_type = 'hourly'
      AND b.status NOT IN ('cancelled', 'declined')
      AND b.payment_status IN ('deposit_paid', 'fully_paid', 'invoiced')
      AND b.start_time IS NOT NULL
      AND b.end_time IS NOT NULL
      AND (
        -- Overlap: new_start < existing_end AND new_end > existing_start
        v_new_start_min < (EXTRACT(HOUR FROM b.end_time)::integer * 60 + EXTRACT(MINUTE FROM b.end_time)::integer)
        AND v_new_end_min > (EXTRACT(HOUR FROM b.start_time)::integer * 60 + EXTRACT(MINUTE FROM b.start_time)::integer)
      )
    LIMIT 1;
    
    IF FOUND THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'conflict',
        'message', 'That time range overlaps with an existing booking',
        'conflict_booking', row_to_json(v_conflicting_booking)
      );
    END IF;
  END IF;
  
  -- 6. Capture old values for audit
  v_old_values := jsonb_build_object(
    'event_date', v_booking.event_date,
    'start_time', v_booking.start_time,
    'end_time', v_booking.end_time,
    'booking_type', v_booking.booking_type
  );
  
  -- 7. Update booking (booking_type NEVER changes)
  UPDATE bookings
  SET event_date = p_new_date,
      start_time = v_target_start,
      end_time = v_target_end,
      -- NO cambiar booking_type (se mantiene)
      updated_at = now()
  WHERE id = p_booking_id;
  
  -- 8. Job rescheduling (always simple date shift now, since booking_type never changes)
  v_date_shift_days := p_new_date - v_booking.event_date;
  
  -- Shift all pending future jobs by the date difference
  UPDATE scheduled_jobs
  SET run_at = run_at + (v_date_shift_days || ' days')::interval,
      updated_at = now()
  WHERE booking_id = p_booking_id
    AND status = 'pending'
    AND run_at > now();
  
  GET DIAGNOSTICS v_jobs_updated = ROW_COUNT;
  
  -- 9. Insert audit event
  INSERT INTO booking_events (booking_id, event_type, channel, metadata)
  VALUES (
    p_booking_id,
    'booking_rescheduled',
    'system',
    jsonb_build_object(
      'old_values', v_old_values,
      'new_values', jsonb_build_object(
        'event_date', p_new_date,
        'start_time', v_target_start,
        'end_time', v_target_end,
        'booking_type', v_target_booking_type
      ),
      'reason', p_reason,
      'actor_id', p_actor_id,
      'date_shift_days', v_date_shift_days,
      'jobs_updated', v_jobs_updated
    )
  );
  
  -- 10. Return success (no job recreation needed since booking_type never changes)
  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'updated', true,
    'jobs_updated', v_jobs_updated,
    'jobs_cancelled', 0,
    'needs_job_recreation', false,
    'date_shift_days', v_date_shift_days
  );
  
EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'internal_error',
      'message', SQLERRM,
      'detail', SQLSTATE
    );
END;
$$;

-- Update comment
COMMENT ON FUNCTION public.reschedule_booking IS 
  'Reschedule a booking to a different date/time. Booking type never changes. ' ||
  'Daily bookings can have optional event window (start/end times for planning). ' ||
  'Includes conflict validation, job rescheduling via date shift, and audit trail.';
