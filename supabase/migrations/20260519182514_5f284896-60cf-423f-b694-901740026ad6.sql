CREATE OR REPLACE FUNCTION public.get_access_code_for_reservation(
  p_reservation_number text DEFAULT NULL,
  p_email text DEFAULT NULL
)
RETURNS TABLE(code text, label text, full_name text, event_date date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_res text;
  v_email text;
BEGIN
  v_res   := nullif(trim(p_reservation_number), '');
  v_email := nullif(trim(p_email), '');

  IF v_res IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'reservation_number_or_email_required' USING ERRCODE = '22023';
  END IF;

  IF v_res IS NOT NULL AND v_email IS NOT NULL THEN
    SELECT b.id, b.full_name, b.event_date, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
      AND lower(trim(b.email)) = lower(v_email)
    LIMIT 1;
  ELSIF v_res IS NOT NULL THEN
    SELECT b.id, b.full_name, b.event_date, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
    LIMIT 1;
  ELSE
    SELECT b.id, b.full_name, b.event_date, b.status
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

  RETURN QUERY
  SELECT vac.code, vac.label, v_booking.full_name, v_booking.event_date
  FROM public.venue_access_code vac
  WHERE vac.id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_access_code_for_reservation(text, text) TO anon, authenticated;