-- Recurring access code reservation numbers (Aug 2026).
-- Permanent "R"-prefixed reservation numbers (e.g. OEV-RFCG01) for recurring
-- tenants and internal staff. They resolve on /accesscode exactly like a
-- one-time booking code, but:
--   * the door code is always released (no 1-hour gate),
--   * they expire automatically on expires_on (checked at lookup time),
--   * they can be paused/resumed/deleted from the admin dashboard.

CREATE TABLE public.recurring_access_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_number text NOT NULL UNIQUE,
  holder_name text NOT NULL,
  email text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  expires_on date NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.recurring_access_codes ENABLE ROW LEVEL SECURITY;

-- Same access model as venue_access_code: staff can see, admin can manage.
-- The public page never reads the table directly — only through the
-- SECURITY DEFINER lookup function below.
CREATE POLICY "Admin and staff can read recurring_access_codes"
  ON public.recurring_access_codes FOR SELECT
  USING (public.is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can insert recurring_access_codes"
  ON public.recurring_access_codes FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin can update recurring_access_codes"
  ON public.recurring_access_codes FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin can delete recurring_access_codes"
  ON public.recurring_access_codes FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Seed the three codes from the Aug 2026 request.
-- Email is optional — the reservation number alone is the credential.
INSERT INTO public.recurring_access_codes
  (reservation_number, holder_name, email, valid_from, expires_on, notes)
VALUES
  ('OEV-RFCG01', 'FCG', NULL, '2026-08-03', '2027-02-03', 'Recurring weekly tenant.'),
  ('OEV-RGLB01', 'Global', 'orlandoeventvenue@gmail.com', '2026-08-03', '2027-02-03', 'Global Ministries, Inc. — parent organization.'),
  ('OEV-RGST01', 'Guest', 'grouptrellis@gmail.com', '2026-08-03', '2027-02-03', 'Internal/staff access (Trellis).')
ON CONFLICT (reservation_number) DO NOTHING;

-- Extend the public lookup to resolve recurring codes.
-- Return type changes (adds is_recurring + expires_on), so drop first.
DROP FUNCTION IF EXISTS public.get_access_code_for_reservation(text, text);

CREATE FUNCTION public.get_access_code_for_reservation(p_reservation_number text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
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
  v_email text;
  v_release timestamptz;
  v_today date;
BEGIN
  v_res   := nullif(trim(p_reservation_number), '');
  v_email := nullif(trim(p_email), '');

  IF v_res IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'reservation_number_or_email_required' USING ERRCODE = '22023';
  END IF;

  v_today := (now() AT TIME ZONE 'America/New_York')::date;

  -- Recurring codes: the reservation number itself is the credential.
  IF v_res IS NOT NULL THEN
    SELECT r.* INTO v_recurring
    FROM public.recurring_access_codes r
    WHERE upper(trim(r.reservation_number)) = upper(v_res)
    LIMIT 1;
    v_has_recurring := FOUND;
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

  -- One-time booking lookup by reservation number (unchanged behavior).
  IF NOT v_has_booking AND v_res IS NOT NULL AND v_email IS NOT NULL THEN
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.start_time, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
      AND lower(trim(b.email)) = lower(v_email)
    LIMIT 1;
    v_has_booking := FOUND;
  ELSIF NOT v_has_booking AND v_res IS NOT NULL THEN
    SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone,
           b.event_date, b.start_time, b.end_time, b.event_type, b.host_report_step, b.status
      INTO v_booking
    FROM public.bookings b
    WHERE upper(trim(b.reservation_number)) = upper(v_res)
    LIMIT 1;
    v_has_booking := FOUND;
  END IF;

  IF NOT v_has_booking THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status IN ('cancelled', 'declined') THEN
    RAISE EXCEPTION 'reservation_inactive' USING ERRCODE = 'P0001';
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
