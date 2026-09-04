-- Access page changes agreed in the 09/04/2026 SyncUp (ClickUp 86e34hqa4).
--
-- 1. Close the whole access page 6 hours after the reservation ends.
--    Until now the page stayed open forever once the code was released, so the
--    door code, the entry instructions and the guest report were reachable days
--    after the event. After the window closes the lookup raises
--    'access_window_closed' and the page shows a closed state.
--
-- 2. Normalize reservation-number matching. Guests paste the number with a
--    leading '#' or without the dash ("#OEV-T7N6HL", "OEVT7N6HL"), and the exact
--    match failed. Lookup now falls back to comparing only letters and digits.
--    Exact (upper+trim) matching is still tried first so current behavior and
--    the unique reservation number always win.

CREATE OR REPLACE FUNCTION public.normalize_reservation_number(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $function$
  SELECT regexp_replace(upper(coalesce(p_value, '')), '[^A-Z0-9]', '', 'g');
$function$;

COMMENT ON FUNCTION public.normalize_reservation_number(text) IS
  'Strips every character that is not a letter or a digit and uppercases the rest. Used to match reservation numbers typed with or without the # and the dash.';

-- Keeps the normalized fallback lookup off a sequential scan.
CREATE INDEX IF NOT EXISTS idx_bookings_reservation_number_normalized
  ON public.bookings (public.normalize_reservation_number(reservation_number));

CREATE INDEX IF NOT EXISTS idx_recurring_access_codes_reservation_number_normalized
  ON public.recurring_access_codes (public.normalize_reservation_number(reservation_number));

-- Return type is unchanged; replace in place.
CREATE OR REPLACE FUNCTION public.get_access_code_for_reservation(p_reservation_number text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS TABLE(code text, label text, access_released boolean, booking_id uuid, reservation_number text, full_name text, email text, phone text, event_date date, start_time time without time zone, end_time time without time zone, event_type text, host_report_step text, is_recurring boolean, expires_on date)
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

  -- '#OEV-T7N6HL' and 'oevt7n6hl' both normalize to 'OEVT7N6HL'.
  v_res_norm := public.normalize_reservation_number(v_res);
  IF v_res IS NOT NULL AND v_res_norm = '' THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_today := (now() AT TIME ZONE 'America/New_York')::date;

  -- Recurring codes: the reservation number itself is the credential.
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
    -- Email-only lookup: bookings first (unchanged), recurring as fallback.
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
           NULL::text, NULL::text, true, v_recurring.expires_on
    FROM public.venue_access_code vac
    WHERE vac.id = 1;
    RETURN;
  END IF;

  -- One-time booking lookup by reservation number: exact first, then normalized.
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

  -- Close moment: 6 hours after the reservation ends, Orlando local time
  -- (SyncUp 09/04 — 12h and 24h were discussed and 6h was chosen).
  -- Bookings without an end_time close 6 hours after the end of the event day.
  IF v_booking.end_time IS NOT NULL THEN
    -- An end_time at or before start_time means the event runs past midnight.
    v_end_date := CASE
      WHEN v_booking.start_time IS NOT NULL AND v_booking.end_time <= v_booking.start_time
        THEN v_booking.event_date + 1
      ELSE v_booking.event_date
    END;
    v_close := ((v_end_date::text || ' ' || v_booking.end_time::text)::timestamp
                AT TIME ZONE 'America/New_York') + interval '6 hours';
  ELSE
    v_close := (((v_booking.event_date + 1)::text || ' 00:00:00')::timestamp
                AT TIME ZONE 'America/New_York') + interval '6 hours';
  END IF;

  IF now() > v_close THEN
    RAISE EXCEPTION 'access_window_closed' USING ERRCODE = 'P0001';
  END IF;

  -- Release moment: 1 hour before event start, Orlando local time.
  -- Bookings without a start_time release at midnight on the event day.
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
           false, NULL::date;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT vac.code, vac.label, true,
         v_booking.id, v_booking.reservation_number, v_booking.full_name,
         v_booking.email, v_booking.phone, v_booking.event_date, v_booking.start_time,
         v_booking.end_time, v_booking.event_type, v_booking.host_report_step,
         false, NULL::date
  FROM public.venue_access_code vac
  WHERE vac.id = 1;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_access_code_for_reservation(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_reservation_number(text) TO anon, authenticated;

-- Guardrail for change #4 (the admin form no longer forces the OEV-R prefix).
-- get_access_code_for_reservation resolves recurring codes BEFORE bookings, so a
-- recurring code that collides with a real reservation number would hand out
-- permanent, always-released access for that booking and skip both the
-- cancelled/declined check and the new 6-hour close window. Normalized matching
-- widens that surface (a code typed without the dash still collides), so the
-- check runs on the normalized form.
CREATE OR REPLACE FUNCTION public.reject_recurring_code_colliding_with_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE public.normalize_reservation_number(b.reservation_number)
        = public.normalize_reservation_number(NEW.reservation_number)
  ) THEN
    RAISE EXCEPTION
      'reservation_number % collides with an existing booking reservation number',
      NEW.reservation_number
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_recurring_access_codes_no_booking_collision
  ON public.recurring_access_codes;

CREATE TRIGGER trg_recurring_access_codes_no_booking_collision
  BEFORE INSERT OR UPDATE OF reservation_number ON public.recurring_access_codes
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_recurring_code_colliding_with_booking();
