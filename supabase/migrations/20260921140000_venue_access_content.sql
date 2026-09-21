-- Editable content for the /accesscode guest page: entry instructions,
-- lighting instructions, Wi-Fi info, and venue rules. Previously all four
-- were hardcoded in src/pages/AccessCode.tsx with zero admin control.
--
-- Same singleton pattern as venue_access_code (id=1, admin/staff-only via
-- RLS). Guests never read this table directly -- get_access_code_for_reservation
-- joins it and returns these fields only inside the same release/close-window
-- gate that already protects the door code, so the security posture of the
-- access page is unchanged.
--
-- entry_steps / lighting_steps text can contain the token "{{code}}", which
-- the frontend replaces with the guest's actual door code at render time
-- (mirrors the old hardcoded "Enter your door code: {code}" line).

CREATE TABLE public.venue_access_content (
  id integer PRIMARY KEY DEFAULT 1,
  entry_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  lighting_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  wifi_network text,
  wifi_password text,
  venue_rules jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT venue_access_content_singleton CHECK (id = 1)
);

INSERT INTO public.venue_access_content (
  id, entry_steps, lighting_steps, wifi_network, wifi_password, venue_rules
) VALUES (
  1,
  '[
    {"title": "1. Find the Entrance", "text": "Look for the GLOBAL sign with the number 3847. When facing the sign, use the door on the left."},
    {"title": "2. Open the Lockbox", "text": "Tap the black lockbox screen to wake it. Enter your door code: {{code}}. Open the lockbox and remove the magnetic key."},
    {"title": "3. Unlock the Door", "text": "Tap the magnetic key against the sensor located to the right of the door."},
    {"title": "4. Return the Key", "text": "Immediately return the magnetic key to the lockbox and close it securely. Do not take the key inside the venue."}
  ]'::jsonb,
  '[
    {"text": "The white remote labeled Light is located on the left wall."},
    {"text": "The buttons on the left turn the lights on. The buttons on the right turn the lights off."},
    {"text": "Return the remote to the same place before leaving."},
    {"text": "If the lights do not turn on, turn on the wall switch first. Then use the white remote."}
  ]'::jsonb,
  'TMOBILE-9371',
  '7km6r7y5ybn',
  '[
    {
      "title": "Capacity and Reservation Time",
      "rules": [
        {"rule": "The venue holds a maximum of 90 guests. Do not exceed this limit.", "fee": "$500 and risk of the event being shut down"},
        {"rule": "Your booked time includes setup and breakdown. Together, they should use no more than 50% of the reservation.", "fee": "$350 per additional hour"},
        {"rule": "The venue must be fully restored before the reservation ends.", "fee": "Additional $300 if the space is not restored"}
      ]
    },
    {
      "title": "Tables, Chairs, and Trash",
      "rules": [
        {"rule": "You are responsible for setting up and breaking down the tables and chairs.", "fee": null},
        {"rule": "Return all tables and chairs to their original arrangement before leaving.", "fee": "$400 if not restored"},
        {"rule": "Bag all trash and place it on the back patio. Do not leave trash inside. Our team handles the cleaning.", "fee": null}
      ]
    },
    {
      "title": "Alcohol, Drugs, and Smoking",
      "rules": [
        {"rule": "All alcohol service must be arranged through Orlando Event Venue. Outside alcohol, outside bartenders, and bringing your own alcohol are not allowed. Guests must be 21 or older to drink.", "fee": "$500 and possible event termination without a refund"},
        {"rule": "Drugs are not allowed anywhere on the property.", "fee": "$500, immediate termination, and possible law enforcement notification"},
        {"rule": "Smoking and vaping are not allowed indoors or in the immediate outdoor area.", "fee": "$500"}
      ]
    },
    {
      "title": "Catering and Kitchen Use",
      "rules": [
        {"rule": "Outside caterers are welcome but must be approved. Professional caterers must provide proof of insurance.", "fee": null},
        {"rule": "Cooking is not allowed on site. The prep kitchen may only be used for staging and reheating.", "fee": "$500 for cooking or using an unapproved caterer"}
      ]
    },
    {
      "title": "Decorations and Venue Equipment",
      "rules": [
        {"rule": "Glitter, confetti, rice, and sparklers are not allowed.", "fee": "$500"},
        {"rule": "Do not use nails, staples, tape that leaves residue, or open flames unless approved in advance.", "fee": "$400 per violation"},
        {"rule": "The stage, screens, and audio or visual equipment may only be used with the matching production package.", "fee": "$400 per violation"},
        {"rule": "Damage to the venue, furniture, or equipment will be charged at the repair or replacement cost.", "fee": "$400 minimum"}
      ]
    },
    {
      "title": "Noise, Doors, and Pets",
      "rules": [
        {"rule": "Keep music and noise within local noise limits. Doors must remain closed after 9:00 PM.", "fee": "$350 and possible termination for severe violations"},
        {"rule": "Pets are not allowed. Documented service animals are welcome.", "fee": "$250"}
      ]
    }
  ]'::jsonb
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.venue_access_content ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can read venue_access_content"
  ON public.venue_access_content FOR SELECT
  USING (public.is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can update venue_access_content"
  ON public.venue_access_content FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- RETURNS TABLE column list changes, so CREATE OR REPLACE is not allowed --
-- drop and recreate (see 20260904160000's own comment on this constraint).
DROP FUNCTION IF EXISTS public.get_access_code_for_reservation(text, text);

CREATE FUNCTION public.get_access_code_for_reservation(p_reservation_number text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
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

  IF v_booking.end_time IS NOT NULL THEN
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
