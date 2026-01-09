-- =====================================================
-- RESCHEDULE BOOKING RPC FUNCTION
-- =====================================================
-- Allows admin to reschedule a booking to a different date/time
-- with conflict validation, job rescheduling, and audit trail

CREATE OR REPLACE FUNCTION public.reschedule_booking(
  p_booking_id uuid,
  p_new_date date,
  p_new_start_time time DEFAULT NULL,
  p_new_end_time time DEFAULT NULL,
  p_new_booking_type text DEFAULT NULL,
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
  v_jobs_cancelled integer := 0;
  v_needs_job_recreation boolean := false;
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
  
  -- 2. Determine target values (use provided or keep existing)
  v_target_booking_type := COALESCE(p_new_booking_type, v_booking.booking_type::text);
  v_target_start := COALESCE(p_new_start_time, v_booking.start_time);
  v_target_end := COALESCE(p_new_end_time, v_booking.end_time);
  
  -- 3. Validate hourly requirements
  IF v_target_booking_type = 'hourly' AND (v_target_start IS NULL OR v_target_end IS NULL) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'validation_failed',
      'message', 'Hourly bookings require start_time and end_time'
    );
  END IF;
  
  -- 4. Check conflicts (exclude self)
  
  -- For DAILY bookings: any booking on that date blocks it
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
        'message', 'That date is already booked',
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
  
  -- 5. Capture old values for audit
  v_old_values := jsonb_build_object(
    'event_date', v_booking.event_date,
    'start_time', v_booking.start_time,
    'end_time', v_booking.end_time,
    'booking_type', v_booking.booking_type
  );
  
  -- 6. Update booking
  UPDATE bookings
  SET event_date = p_new_date,
      start_time = v_target_start,
      end_time = v_target_end,
      booking_type = v_target_booking_type::booking_type,
      updated_at = now()
  WHERE id = p_booking_id;
  
  -- 7. Smart job rescheduling
  
  -- Simple case: only date changed, same booking_type (just shift dates)
  IF v_booking.booking_type::text = v_target_booking_type THEN
    -- Calculate date shift in days
    v_date_shift_days := p_new_date - v_booking.event_date;
    
    -- Update run_at for pending jobs (shift by same amount)
    UPDATE scheduled_jobs
    SET run_at = run_at + (v_date_shift_days || ' days')::interval,
        updated_at = now()
    WHERE booking_id = p_booking_id
      AND status = 'pending'
      AND run_at > now();
    
    GET DIAGNOSTICS v_jobs_updated = ROW_COUNT;
    
  ELSE
    -- Complex case: booking_type changed (need to recreate jobs with new logic)
    -- Mark jobs for recreation (actual recreation happens in Edge Function)
    UPDATE scheduled_jobs
    SET status = 'cancelled',
        last_error = 'reschedule_recreation_needed',
        updated_at = now()
    WHERE booking_id = p_booking_id
      AND status IN ('pending', 'failed')
      AND run_at > now();
    
    GET DIAGNOSTICS v_jobs_cancelled = ROW_COUNT;
    v_needs_job_recreation := true;
  END IF;
  
  -- 8. Insert audit event
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
      'jobs_updated', v_jobs_updated,
      'jobs_cancelled', v_jobs_cancelled
    )
  );
  
  -- 9. Return success
  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'updated', true,
    'jobs_updated', v_jobs_updated,
    'jobs_cancelled', v_jobs_cancelled,
    'needs_job_recreation', v_needs_job_recreation,
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

-- Grant execute permission to authenticated users (admin check happens in Edge Function)
GRANT EXECUTE ON FUNCTION public.reschedule_booking TO authenticated;

-- Add comment for documentation
COMMENT ON FUNCTION public.reschedule_booking IS 
  'Reschedule a booking to a different date/time with conflict validation, ' ||
  'smart job rescheduling, and audit trail. Returns jsonb with ok:true on success ' ||
  'or ok:false with error details on failure.';
