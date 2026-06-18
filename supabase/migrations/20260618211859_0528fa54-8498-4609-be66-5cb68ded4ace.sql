
CREATE OR REPLACE FUNCTION public.get_access_code_for_reservation(p_reservation_number text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS TABLE(code text, label text, booking_id uuid, reservation_number text, full_name text, email text, phone text, event_date date, end_time time without time zone, event_type text, host_report_step text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking record;
  v_res text;
  v_email text;
  v_today date;
BEGIN
  v_res   := nullif(trim(p_reservation_number), '');
  v_email := nullif(trim(p_email), '');

  IF v_res IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'reservation_number_or_email_required' USING ERRCODE = '22023';
  END IF;

  IF v_res IS NOT NULL AND v_email IS NOT NULL THEN
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
      AND lower(trim(b.email)) = lower(v_email)
    LIMIT 1;
  ELSIF v_res IS NOT NULL THEN
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
    LIMIT 1;
  ELSE
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE lower(trim(b.email)) = lower(v_email)
      AND b.status NOT IN ('cancelled', 'declined')
    ORDER BY b.event_date DESC
    LIMIT 1;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status IN ('cancelled', 'declined') THEN
    RAISE EXCEPTION 'reservation_inactive' USING ERRCODE = 'P0001';
  END IF;

  -- Gate: only release code on or after the event date (America/New_York)
  v_today := (now() AT TIME ZONE 'America/New_York')::date;
  IF v_booking.event_date > v_today THEN
    RAISE EXCEPTION 'access_code_locked_until_event_day' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT vac.code, vac.label,
         v_booking.id, v_booking.reservation_number, v_booking.full_name,
         v_booking.email, v_booking.phone, v_booking.event_date, v_booking.end_time,
         v_booking.event_type, v_booking.host_report_step
  FROM public.venue_access_code vac
  WHERE vac.id = 1;
END;
$function$;
