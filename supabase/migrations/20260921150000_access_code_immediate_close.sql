-- Requested by Luis: the 6-hour post-event grace window let the door code,
-- entry/lighting instructions, wifi, and rules stay visible for 6 hours after
-- the reservation ended. That's gone -- access now closes the instant the
-- event's end_time passes (or at midnight of the event day when a booking
-- has no end_time). Release timing (1h before start) is unchanged.
--
-- RETURNS TABLE is unchanged from 20260921140000, so CREATE OR REPLACE is
-- fine here (unlike that migration, which had to DROP+CREATE for a new
-- column list).

CREATE OR REPLACE FUNCTION public.get_access_code_for_reservation(p_reservation_number text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS TABLE(code text, label text, access_released boolean, booking_id uuid, reservation_number text, full_name text, email text, phone text, event_date date, start_time time without time zone, end_time time without time zone, event_type text, host_report_step text, is_recurring boolean, expires_on date, entry_steps jsonb, lighting_steps jsonb, wifi_network text, wifi_password text, venue_rules jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking record;
  v_recurring record;
  v_has_booking boolean := false;
  v_has_recurring boolean := false;
  v_res text;
  v_res_norm text;
  v_email text;
  v_release timestamptz;
  v_close timestamptz;
  v_end_date date;
  v_today date;
BEGIN
  v_res   := nullif(trim(p_reservation_number), '');
  v_email := nullif(trim(p_email), '');

  IF v_res IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'reservation_number_or_email_required' USING ERRCODE = '22023';
  END IF;

  v_res_norm := public.normalize_reservation_number(v_res);
  IF v_res IS NOT NULL AND v_res_norm = '' THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_today := (now() AT TIME ZONE 'America/New_York')::date;

  IF v_res IS NOT NULL THEN
    SELECT r.* INTO v_recurring
    FROM public.recurring_access_codes r
    WHERE upper(trim(r.reservation_number)) = upper(v_res)
    LIMIT 1;
    v_has_recurring := FOUND;

    IF NOT v_has_recurring THEN
      SELECT r.* INTO v_recurring
      FROM public.recurring_access_codes r
      WHERE public.normalize_reservation_number(r.reservation_number) = v_res_norm
      ORDER BY r.expires_on DESC
      LIMIT 1;
      v_has_recurring := FOUND;
    END IF;
  ELSE
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.start_time, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE lower(trim(b.email)) = lower(v_email)
      AND b.status NOT IN ('cancelled', 'declined')
    ORDER BY b.event_date DESC
    LIMIT 1;
    v_has_booking := FOUND;

    IF NOT v_has_booking THEN
      SELECT r.* INTO v_recurring
      FROM public.recurring_access_codes r
      WHERE r.email IS NOT NULL AND lower(trim(r.email)) = lower(v_email)
      ORDER BY r.expires_on DESC
      LIMIT 1;
      v_has_recurring := FOUND;
    END IF;
  END IF;

  IF v_has_recurring THEN
    IF v_recurring.status = 'paused' THEN
      RAISE EXCEPTION 'recurring_code_paused' USING ERRCODE = 'P0001';
    END IF;
    IF v_today < v_recurring.valid_from OR v_today > v_recurring.expires_on THEN
      RAISE EXCEPTION 'recurring_code_expired' USING ERRCODE = 'P0001';
    END IF;

    RETURN QUERY
    SELECT vac.code, vac.label, true,
           v_recurring.id, v_recurring.reservation_number, v_recurring.holder_name,
           v_recurring.email, NULL::text, v_today, NULL::time, NULL::time,
           NULL::text, NULL::text, true, v_recurring.expires_on,
           vc.entry_steps, vc.lighting_steps, vc.wifi_network, vc.wifi_password, vc.venue_rules
    FROM public.venue_access_code vac
    LEFT JOIN public.venue_access_content vc ON vc.id = 1
    WHERE vac.id = 1;
    RETURN;
  END IF;

  IF NOT v_has_booking AND v_res IS NOT NULL AND v_email IS NOT NULL THEN
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.start_time, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
      AND lower(trim(b.email)) = lower(v_email)
    LIMIT 1;
    v_has_booking := FOUND;

    IF NOT v_has_booking THEN
      SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
             b.event_date, b.start_time, b.end_time, b.event_type, b.host_report_step, b.status
        INTO v_booking
      FROM public.bookings b
      WHERE public.normalize_reservation_number(b.reservation_number) = v_res_norm
        AND lower(trim(b.email)) = lower(v_email)
      ORDER BY b.event_date DESC
      LIMIT 1;
      v_has_booking := FOUND;
    END IF;
  ELSIF NOT v_has_booking AND v_res IS NOT NULL THEN
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.start_time, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
    LIMIT 1;
    v_has_booking := FOUND;

    IF NOT v_has_booking THEN
      SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
             b.event_date, b.start_time, b.end_time, b.event_type, b.host_report_step, b.status
        INTO v_booking
      FROM public.bookings b
      WHERE public.normalize_reservation_number(b.reservation_number) = v_res_norm
      ORDER BY b.event_date DESC
      LIMIT 1;
      v_has_booking := FOUND;
    END IF;
  END IF;

  IF NOT v_has_booking THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status IN ('cancelled', 'declined') THEN
    RAISE EXCEPTION 'reservation_inactive' USING ERRCODE = 'P0001';
  END IF;

  -- Close moment: the event's own end_time, Orlando local time, no grace
  -- window (Luis, 09/21/2026 -- the previous +6h buffer is removed).
  -- Bookings without an end_time close at midnight of the event day.
  IF v_booking.end_time IS NOT NULL THEN
    -- An end_time at or before start_time means the event runs past midnight.
    v_end_date := CASE
      WHEN v_booking.start_time IS NOT NULL AND v_booking.end_time <= v_booking.start_time
        THEN v_booking.event_date + 1
      ELSE v_booking.event_date
    END;
    v_close := (v_end_date::text || ' ' || v_booking.end_time::text)::timestamp
               AT TIME ZONE 'America/New_York';
  ELSE
    v_close := ((v_booking.event_date + 1)::text || ' 00:00:00')::timestamp
               AT TIME ZONE 'America/New_York';
  END IF;

  IF now() > v_close THEN
    RAISE EXCEPTION 'access_window_closed' USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.start_time IS NOT NULL THEN
    v_release := ((v_booking.event_date::text || ' ' || v_booking.start_time::text)::timestamp
                  AT TIME ZONE 'America/New_York') - interval '1 hour';
  ELSE
    v_release := (v_booking.event_date::text || ' 00:00:00')::timestamp
                 AT TIME ZONE 'America/New_York';
  END IF;

  IF now() < v_release THEN
    RETURN QUERY
    SELECT NULL::text, NULL::text, false,
           v_booking.id, v_booking.reservation_number, v_booking.full_name,
           v_booking.email, v_booking.phone, v_booking.event_date, v_booking.start_time,
           v_booking.end_time, v_booking.event_type, v_booking.host_report_step,
           false, NULL::date,
           NULL::jsonb, NULL::jsonb, NULL::text, NULL::text, NULL::jsonb;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT vac.code, vac.label, true,
         v_booking.id, v_booking.reservation_number, v_booking.full_name,
         v_booking.email, v_booking.phone, v_booking.event_date, v_booking.start_time,
         v_booking.end_time, v_booking.event_type, v_booking.host_report_step,
         false, NULL::date,
         vc.entry_steps, vc.lighting_steps, vc.wifi_network, vc.wifi_password, vc.venue_rules
  FROM public.venue_access_code vac
  LEFT JOIN public.venue_access_content vc ON vc.id = 1
  WHERE vac.id = 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_access_code_for_reservation(text, text) TO anon, authenticated;
