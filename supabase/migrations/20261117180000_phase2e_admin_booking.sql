-- Phase 2E, E-16 / E-17 (ClickUp 86e40ach2): admin-created bookings.
--
-- E-16: the Internal/External wizards checked conflicts on browser data, then
-- inserted the booking and its blocks in separate calls; a failed block left
-- the booking unblocked and a retry could duplicate it. End time before start
-- time was accepted.
-- E-17: recurring hourly mode created ONE booking on the first date plus
-- blocks for the other dates; later dates had no booking, staff, status or
-- payroll of their own.
--
-- admin_create_blocking_booking does it in one transaction: per-date lock
-- (same key as reschedule_booking), conflict check against bookings and
-- availability blocks, one booking + block per occurrence, linked by
-- series_id. External bookings are single-date (the total is one payment)
-- and are moved to pre_event_ready through the lifecycle writer.

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS series_id uuid;
CREATE INDEX IF NOT EXISTS bookings_series_idx ON public.bookings (series_id) WHERE series_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public._booking_slot_conflict(
  p_date date, p_end_date date, p_type text, p_start time, p_end time, p_ignore uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_d date;
  v_who text;
BEGIN
  v_d := p_date;
  WHILE v_d <= COALESCE(p_end_date, p_date) LOOP
    SELECT full_name INTO v_who FROM public.bookings b
    WHERE b.event_date = v_d AND b.id IS DISTINCT FROM p_ignore
      AND b.status NOT IN ('cancelled', 'declined') AND b.payment_status NOT IN ('failed', 'refunded')
      AND COALESCE(b.lifecycle_status, '') <> 'cancelled'
      AND (
        p_type = 'daily' OR b.booking_type = 'daily'
        OR b.start_time IS NULL OR b.end_time IS NULL
        OR (b.start_time < p_end AND b.end_time > p_start)
      )
    LIMIT 1;
    IF FOUND THEN
      RETURN format('%s is already booked (%s)', to_char(v_d, 'MM/DD/YYYY'), v_who);
    END IF;
    SELECT COALESCE(ab.notes, ab.block_type) INTO v_who FROM public.availability_blocks ab
    WHERE v_d BETWEEN ab.start_date AND ab.end_date
      AND ab.booking_id IS DISTINCT FROM p_ignore
      AND (ab.booking_id IS NULL OR EXISTS (
        SELECT 1 FROM public.bookings ob WHERE ob.id = ab.booking_id
          AND ob.status NOT IN ('cancelled', 'declined') AND COALESCE(ob.lifecycle_status, '') <> 'cancelled'))
      AND (
        p_type = 'daily' OR ab.block_type = 'daily'
        OR ab.start_time IS NULL OR ab.end_time IS NULL
        OR (ab.start_time < p_end AND ab.end_time > p_start)
      )
    LIMIT 1;
    IF FOUND THEN
      RETURN format('%s is blocked on the calendar (%s)', to_char(v_d, 'MM/DD/YYYY'), v_who);
    END IF;
    v_d := v_d + 1;
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public._booking_slot_conflict(date, date, text, time, time, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_create_blocking_booking(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_kind text := p->>'kind';
  v_type text := p->>'booking_type';
  v_dates date[];
  v_end_date date := NULLIF(p->>'end_date', '')::date;
  v_start time := NULLIF(p->>'start_time', '')::time;
  v_end time := NULLIF(p->>'end_time', '')::time;
  v_name text := NULLIF(btrim(COALESCE(p->>'client_name', '')), '');
  v_email text := lower(NULLIF(btrim(COALESCE(p->>'client_email', '')), ''));
  v_phone text := NULLIF(btrim(COALESCE(p->>'client_phone', '')), '');
  v_guests int := COALESCE(NULLIF(p->>'number_of_guests', '')::int, 0);
  v_event_type text := COALESCE(NULLIF(btrim(COALESCE(p->>'event_type', '')), ''), 'Other');
  v_notes text := NULLIF(btrim(COALESCE(p->>'notes', '')), '');
  v_total numeric := COALESCE(NULLIF(p->>'total_amount', '')::numeric, 0);
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
  v_policy uuid;
  v_series uuid;
  v_conflict text;
  v_d date;
  v_id uuid;
  v_ids uuid[] := ARRAY[]::uuid[];
  v_warnings text[] := ARRAY[]::text[];
  v_initials text;
  v_dep numeric;
  v_res text;
  v_paid timestamptz := now();
BEGIN
  PERFORM public._assert_admin_or_service();
  IF v_kind NOT IN ('internal', 'external') THEN RAISE EXCEPTION 'kind must be internal or external' USING ERRCODE = '22023'; END IF;
  IF v_type NOT IN ('hourly', 'daily') THEN RAISE EXCEPTION 'booking type must be hourly or daily' USING ERRCODE = '22023'; END IF;
  IF v_name IS NULL OR v_email IS NULL OR v_phone IS NULL THEN
    RAISE EXCEPTION 'client name, email and phone are required' USING ERRCODE = '22023';
  END IF;
  IF v_guests < 1 THEN RAISE EXCEPTION 'enter the number of guests' USING ERRCODE = '22023'; END IF;
  SELECT array_agg(DISTINCT d::date ORDER BY d::date) INTO v_dates FROM jsonb_array_elements_text(COALESCE(p->'dates', '[]'::jsonb)) d;
  IF v_dates IS NULL OR array_length(v_dates, 1) IS NULL THEN RAISE EXCEPTION 'choose a date' USING ERRCODE = '22023'; END IF;
  IF array_length(v_dates, 1) > 60 THEN RAISE EXCEPTION 'at most 60 dates per series' USING ERRCODE = '22023'; END IF;
  IF v_dates[1] < v_today THEN RAISE EXCEPTION 'dates must be today or later' USING ERRCODE = '22023'; END IF;
  IF v_type = 'hourly' THEN
    IF v_start IS NULL OR v_end IS NULL THEN RAISE EXCEPTION 'start and end times are required for hourly bookings' USING ERRCODE = '22023'; END IF;
    IF v_end <= v_start THEN RAISE EXCEPTION 'end time must be after start time' USING ERRCODE = '22023'; END IF;
    v_end_date := NULL;
  ELSE
    IF array_length(v_dates, 1) > 1 THEN RAISE EXCEPTION 'repeating dates are for hourly bookings' USING ERRCODE = '22023'; END IF;
    v_end_date := COALESCE(v_end_date, v_dates[1]);
    IF v_end_date < v_dates[1] THEN RAISE EXCEPTION 'end date must be on or after the start date' USING ERRCODE = '22023'; END IF;
    IF v_end_date > v_dates[1] + 31 THEN RAISE EXCEPTION 'a daily booking can span at most 31 days' USING ERRCODE = '22023'; END IF;
  END IF;
  IF v_kind = 'external' THEN
    IF array_length(v_dates, 1) > 1 THEN
      RAISE EXCEPTION 'external bookings are one date each (one payment); create each date separately' USING ERRCODE = '22023';
    END IF;
    IF v_total <= 0 THEN RAISE EXCEPTION 'enter the amount the client paid' USING ERRCODE = '22023'; END IF;
  END IF;

  SELECT id INTO v_policy FROM public.booking_policies
  WHERE policy_name = CASE WHEN v_kind = 'internal' THEN 'INTERNAL_BLOCK_FLOW' ELSE 'WEBSITE_FULL_FLOW' END;
  IF v_policy IS NULL THEN RAISE EXCEPTION 'booking policy missing' USING ERRCODE = 'P0002'; END IF;

  v_series := CASE WHEN array_length(v_dates, 1) > 1 THEN gen_random_uuid() END;
  v_initials := upper(string_agg(left(w, 1), '')) FROM regexp_split_to_table(v_name, '\s+') w;

  -- Lock every date first (sorted, so two wizards cannot deadlock), then check.
  FOREACH v_d IN ARRAY v_dates LOOP
    PERFORM pg_advisory_xact_lock(hashtext('oev_booking_date:' || v_d::text));
  END LOOP;
  IF v_end_date IS NOT NULL AND v_end_date > v_dates[1] THEN
    v_d := v_dates[1] + 1;
    WHILE v_d <= v_end_date LOOP
      PERFORM pg_advisory_xact_lock(hashtext('oev_booking_date:' || v_d::text));
      v_d := v_d + 1;
    END LOOP;
  END IF;
  FOREACH v_d IN ARRAY v_dates LOOP
    v_conflict := public._booking_slot_conflict(v_d, COALESCE(v_end_date, v_d), v_type, v_start, v_end);
    IF v_conflict IS NOT NULL THEN
      RAISE EXCEPTION '%', v_conflict USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  FOREACH v_d IN ARRAY v_dates LOOP
    IF v_kind = 'internal' THEN
      INSERT INTO public.bookings (
        booking_type, event_date, start_time, end_time, number_of_guests, event_type, full_name, email, phone,
        lead_source, status, lifecycle_status, payment_status, base_rental, cleaning_fee, package_cost,
        optional_services, taxes_fees, total_amount, deposit_amount, balance_amount, agree_to_rules,
        initials, signer_name, signature, signature_date, client_notes, booking_origin, policy_id, series_id
      ) VALUES (
        v_type::booking_type, v_d, CASE WHEN v_type = 'hourly' THEN v_start END, CASE WHEN v_type = 'hourly' THEN v_end END,
        v_guests, v_event_type, v_name, v_email, v_phone,
        'internal_admin', 'confirmed'::booking_status, 'confirmed', 'invoiced'::payment_status, 0, 0, 0, 0, 0, 0, 0, 0, true,
        v_initials, v_name, 'Internal Booking', v_d, v_notes, 'internal'::booking_origin, v_policy, v_series
      ) RETURNING id INTO v_id;
      INSERT INTO public.availability_blocks (source, booking_id, block_type, start_date, end_date, start_time, end_time, notes)
      VALUES ('internal_admin', v_id, v_type, v_d, COALESCE(v_end_date, v_d),
              CASE WHEN v_type = 'hourly' THEN v_start END, CASE WHEN v_type = 'hourly' THEN v_end END,
              CASE WHEN v_series IS NULL THEN 'Internal booking: ' ELSE 'Internal booking (series): ' END || v_event_type || ' - ' || v_name);
    ELSE
      v_dep := round(v_total / 2, 2);
      LOOP
        SELECT 'OEV-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
        INTO v_res FROM generate_series(1, 6);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bookings WHERE reservation_number = v_res);
      END LOOP;
      INSERT INTO public.bookings (
        booking_type, event_date, start_time, end_time, number_of_guests, event_type, full_name, reservation_number,
        email, phone, lead_source, status, lifecycle_status, payment_status, package, base_rental, cleaning_fee,
        package_cost, optional_services, taxes_fees, total_amount, deposit_amount, balance_amount, deposit_fee,
        balance_fee, deposit_total_charged, balance_total_charged, deposit_paid_at, balance_paid_at, agree_to_rules,
        initials, signer_name, signature, signature_date, client_notes, booking_origin, policy_id
      ) VALUES (
        v_type::booking_type, v_d, CASE WHEN v_type = 'hourly' THEN v_start ELSE time '01:00' END,
        CASE WHEN v_type = 'hourly' THEN v_end ELSE time '23:00' END,
        v_guests, v_event_type,
        CASE WHEN v_name ILIKE '% - External' THEN v_name ELSE v_name || ' - External' END, v_res,
        v_email, v_phone, 'external_admin', 'confirmed'::booking_status, 'confirmed', 'fully_paid'::payment_status, 'none'::package_type, v_total, 0,
        0, 0, 0, v_total, v_dep, v_total - v_dep, 0,
        0, v_dep, v_total - v_dep, v_paid, v_paid, true,
        v_initials, v_name, 'External Booking', v_d, v_notes, 'external'::booking_origin, v_policy
      ) RETURNING id INTO v_id;
      INSERT INTO public.availability_blocks (source, booking_id, block_type, start_date, end_date, start_time, end_time, notes)
      VALUES ('system', v_id, v_type, v_d, COALESCE(v_end_date, v_d),
              CASE WHEN v_type = 'hourly' THEN v_start END, CASE WHEN v_type = 'hourly' THEN v_end END,
              'External booking: ' || v_event_type || ' - ' || v_name);
      -- Ready for the automation pipeline (host report jobs, reminders). If
      -- the readiness gate refuses, the booking stays confirmed with a warning.
      BEGIN
        PERFORM set_config('oev.lifecycle_writer', 'on', true);
        UPDATE public.bookings SET pre_event_ready = 'true', lifecycle_status = 'pre_event_ready' WHERE id = v_id;
      EXCEPTION WHEN OTHERS THEN
        v_warnings := v_warnings || ('pre_event_ready: ' || SQLERRM);
      END;
    END IF;
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (v_id, 'admin_booking_created', 'admin', jsonb_build_object(
      'kind', v_kind, 'series_id', v_series, 'occurrences', array_length(v_dates, 1), 'actor', auth.uid()));
    v_ids := v_ids || v_id;
  END LOOP;

  RETURN jsonb_build_object('booking_ids', to_jsonb(v_ids), 'series_id', v_series, 'warnings', to_jsonb(v_warnings));
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_create_blocking_booking(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_blocking_booking(jsonb) TO authenticated, service_role;
