-- ClickUp 86e40ach2, second pass: status by booking type (L2) and guest/office
-- communications (CM2). Idempotent; every CREATE OR REPLACE / in-place patch
-- is based on the production definition read on 2026-11-19.
--
--  L2-06  admin_booking_close_eta tells the UI when the cron will NOT close it
--  L2-07  admin_close_event_silently: post_event with no automation, no GHL
--  L2-08  admin_transition_booking refuses in_progress before the start
--  L2-09  internal bookings get readiness + the event-start job at creation
--  L2-10  admin_stuck_bookings (Dashboard + daily-health-check)
--  L2-15  one start rule (_booking_event_start_at) in readiness/recompute
--  L2-17  rescheduling an in_progress booking to a future start -> confirmed
--  CM2-02 Guest Report stays open until end+24h (report only, no door code)
--  CM2-03 guest_message_sends: one-send markers for guest emails
--  CM2-08 auto_fix_missing_jobs also repairs confirmed bookings
--  CM2-09 readiness syncs to GHL carry sync_reason 'readiness_change'
--  CM2-12 popup lead unsubscribe (token, single writer)
--  CM2-14 internal bookings get a reservation number
--  CM2-15 send_cleaning_report honored by the cleaning-reminder trigger
--  CM2-16 admin_deposit_unconfirmed (deposit paid, still pending after 20h)

-- ---------------------------------------------------------------------------
-- L2-15: one start-time rule. _booking_event_start_at (start_time or 00:00) is
-- what the cron and "Close event" use; readiness used 06:00. Now both use it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_readiness(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b record;
BEGIN
  SELECT id, lifecycle_status, pre_event_ready, booking_origin, event_date, start_time
    INTO b
    FROM public.bookings
   WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN public.evaluate_booking_readiness(b.id, b.pre_event_ready, b.booking_origin::text)
    || jsonb_build_object(
         'lifecycle_status', b.lifecycle_status,
         'checklist_complete', COALESCE(b.pre_event_ready, 'false') = 'true',
         'event_started', now() >= public._booking_event_start_at(b.id)
       );
END;
$function$;

-- L2-15 + CM2-09: same start rule; a readiness demotion's GHL sync is labeled
-- so GHL workflows can ignore it (sync-to-ghl marks any non-default
-- sync_reason automation_suppressed = "true").
CREATE OR REPLACE FUNCTION public.recompute_booking_readiness(p_booking_id uuid, p_source text DEFAULT 'system'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b record;
  v jsonb;
  v_to text;
  v_start timestamptz;
  v_silent boolean := COALESCE(current_setting('oev.readiness_silent', true), '') = 'on';
  v_prev_writer text;
BEGIN
  SELECT id, lifecycle_status, pre_event_ready, booking_origin, status, event_date, start_time
    INTO b
    FROM public.bookings
   WHERE id = p_booking_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v := public.evaluate_booking_readiness(b.id, b.pre_event_ready, b.booking_origin::text);

  v_start := public._booking_event_start_at(b.id);

  IF b.status IS DISTINCT FROM 'cancelled'::booking_status AND v_start > now() THEN
    IF b.lifecycle_status = 'pre_event_ready' AND NOT (v->>'ready')::boolean THEN
      v_to := 'confirmed';
    ELSIF b.lifecycle_status = 'confirmed' AND b.status = 'confirmed'::booking_status
          AND (v->>'ready')::boolean THEN
      v_to := 'pre_event_ready';
    END IF;
  END IF;

  IF v_to IS NOT NULL THEN
    v_prev_writer := COALESCE(current_setting('oev.lifecycle_writer', true), '');
    PERFORM set_config('oev.lifecycle_writer', 'on', true);
    UPDATE public.bookings
       SET lifecycle_status = v_to,
           updated_at = now()
     WHERE id = b.id;
    PERFORM set_config('oev.lifecycle_writer', v_prev_writer, true);

    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      b.id,
      'lifecycle_readiness_changed',
      'system',
      jsonb_build_object(
        'from_lifecycle', b.lifecycle_status,
        'to_lifecycle', v_to,
        'source', p_source,
        'silent', v_silent,
        'unmet', v->'unmet'
      )
    );

    IF NOT v_silent THEN
      PERFORM net.http_post(
        url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-to-ghl',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        -- Only demotions are labeled (suppressed). A promotion to Pre-Event
        -- Ready stays a normal sync: GHL's Pre-Event Ready workflow may need it
        -- and GHL's filters are not visible from here.
        body := CASE WHEN v_to = 'confirmed'
                     THEN jsonb_build_object('booking_id', b.id, 'sync_reason', 'readiness_change')
                     ELSE jsonb_build_object('booking_id', b.id) END
      );
    END IF;
  END IF;

  IF COALESCE(v_to, b.lifecycle_status) IN ('confirmed', 'pre_event_ready')
     AND b.status IS DISTINCT FROM 'cancelled'::booking_status
     AND v_start > now() THEN
    INSERT INTO public.scheduled_jobs (job_type, booking_id, run_at, status)
    VALUES ('set_lifecycle_in_progress', b.id, v_start, 'pending')
    ON CONFLICT (booking_id, job_type) WHERE status = 'pending' DO NOTHING;
  END IF;

  RETURN v || jsonb_build_object(
    'lifecycle_status', COALESCE(v_to, b.lifecycle_status),
    'changed', v_to IS NOT NULL
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- L2-08: "Event In Progress" before the event starts only as a correction with
-- a reason (one click reproduced the 9CMUGG early In Progress).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_transition_booking(p_booking_id uuid, p_to text, p_reason text DEFAULT NULL::text, p_force boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_allowed boolean;
  v_early boolean := false;
BEGIN
  PERFORM public._assert_admin_or_service();
  IF p_to NOT IN ('pending', 'confirmed', 'pre_event_ready', 'in_progress', 'post_event', 'closed_review_complete') THEN
    RAISE EXCEPTION 'unknown status %; cancel through the Cancel booking dialog', p_to USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status = 'cancelled'::booking_status OR v_b.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'this booking is cancelled; it cannot change status' USING ERRCODE = 'P0001';
  END IF;
  IF v_b.lifecycle_status = p_to THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'lifecycle_status', p_to);
  END IF;
  v_allowed := public._lifecycle_transition_allowed(v_b.lifecycle_status, p_to);
  IF NOT v_allowed THEN
    IF NOT p_force THEN
      RAISE EXCEPTION 'cannot move from % to %: use "Correct status" with a reason if this fixes a mistake',
        replace(v_b.lifecycle_status, '_', ' '), replace(p_to, '_', ' ') USING ERRCODE = 'P0001';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'say why the status is being corrected' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF p_to = 'in_progress' AND public._booking_event_start_at(p_booking_id) > now() THEN
    v_early := true;
    IF NOT p_force THEN
      RAISE EXCEPTION 'the event has not started yet: use "Correct status" with a reason to start it early' USING ERRCODE = 'P0001';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION 'say why the event is being started early' USING ERRCODE = '22023';
    END IF;
  END IF;
  PERFORM set_config('oev.lifecycle_writer', 'on', true);
  UPDATE public.bookings SET lifecycle_status = p_to, updated_at = now() WHERE id = p_booking_id;
  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, 'lifecycle_transition', 'admin', jsonb_build_object(
    'from', v_b.lifecycle_status, 'to', p_to, 'reason', v_reason,
    'forced', NOT v_allowed OR v_early, 'started_early', v_early, 'actor', auth.uid()));
  RETURN jsonb_build_object('ok', true, 'changed', true, 'from', v_b.lifecycle_status, 'lifecycle_status', p_to,
                            'forced', NOT v_allowed OR v_early);
END;
$function$;

-- ---------------------------------------------------------------------------
-- L2-06: the close card needs to know whether the cron will close this booking
-- (same scope as lifecycle_moves_due) so it stops promising past dates.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_booking_close_eta(p_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_end timestamptz;
  v_eligible boolean;
  v_found boolean;
BEGIN
  PERFORM public._assert_admin_or_service();
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  v_found := FOUND;
  v_end := public._booking_event_end_at(p_booking_id);
  v_eligible := v_found
    AND v_b.status NOT IN ('cancelled'::booking_status, 'declined'::booking_status)
    AND v_end >= timestamptz '2026-11-12 00:00 America/New_York'
    AND (
      v_b.lifecycle_status = 'in_progress'
      OR (v_b.lifecycle_status IN ('confirmed', 'pre_event_ready')
          AND v_b.event_date >= date '2026-11-12'
          AND v_b.payment_status NOT IN ('pending'::payment_status, 'failed'::payment_status, 'refunded'::payment_status))
    );
  RETURN jsonb_build_object(
    'event_start_at', public._booking_event_start_at(p_booking_id),
    'event_end_at', v_end,
    'auto_close_at', v_end + interval '24 hours',
    'auto_close_eligible', COALESCE(v_eligible, false)
  );
END;
$function$;

-- ---------------------------------------------------------------------------
-- L2-07: close a past, stuck event with no side effects. "Close event now"
-- goes through in_progress, which fires trigger-booking-automation and a GHL
-- sync. This writes post_event directly (lifecycle writer flag), logs a
-- booking_event, cancels the booking's pending lifecycle/guest jobs and calls
-- nothing. Accepted staff are still marked completed by the existing
-- post_event trigger (the event has ended). NOT run on any booking here: Luis
-- approves the 5 backlog bookings first.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_close_event_silently(p_booking_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_jobs int := 0;
BEGIN
  PERFORM public._assert_admin_or_service();
  IF v_reason IS NULL THEN
    RAISE EXCEPTION 'say why this event is being closed without messages' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status IN ('cancelled'::booking_status, 'declined'::booking_status) OR v_b.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF v_b.lifecycle_status NOT IN ('confirmed', 'pre_event_ready', 'in_progress') THEN
    RAISE EXCEPTION 'only an event still Confirmed, Pre-Event Ready or In Progress can be closed this way (now %)',
      replace(v_b.lifecycle_status, '_', ' ') USING ERRCODE = 'P0001';
  END IF;
  IF public._booking_event_end_at(p_booking_id) > now() THEN
    RAISE EXCEPTION 'the event has not ended yet' USING ERRCODE = 'P0001';
  END IF;

  PERFORM set_config('oev.lifecycle_writer', 'on', true);
  UPDATE public.bookings SET lifecycle_status = 'post_event', updated_at = now() WHERE id = p_booking_id;
  PERFORM set_config('oev.lifecycle_writer', '', true);

  UPDATE public.scheduled_jobs
     SET status = 'cancelled', last_error = 'closed_silently', updated_at = now()
   WHERE booking_id = p_booking_id
     AND status = 'pending'
     AND job_type IN ('set_lifecycle_in_progress', 'set_lifecycle_post_event',
                      'host_report_pre_start', 'host_report_during', 'host_report_post',
                      'one_hour_report', 'guest_feedback_post_event');
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, 'lifecycle_transition', 'admin', jsonb_build_object(
    'from', v_b.lifecycle_status, 'to', 'post_event', 'reason', v_reason,
    'forced', true, 'silent', true, 'jobs_cancelled', v_jobs, 'actor', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'changed', true, 'from', v_b.lifecycle_status,
                            'lifecycle_status', 'post_event', 'jobs_cancelled', v_jobs);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_close_event_silently(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_event_silently(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- L2-10: stuck bookings. Start passed (1h grace for the 15-min cron) while
-- Confirmed / Pre-Event Ready, or end+24h passed (1h grace) while In Progress.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_stuck_bookings()
 RETURNS TABLE(booking_id uuid, reservation_number text, full_name text, event_date date,
               lifecycle_status text, booking_origin text, reason text, overdue_since timestamptz)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY
  SELECT s.id, s.reservation_number, s.full_name, s.event_date, s.lifecycle_status,
         s.booking_origin::text, s.reason, s.overdue_since
  FROM (
    SELECT b.id, b.reservation_number, b.full_name, b.event_date, b.lifecycle_status, b.booking_origin,
           'start_passed'::text AS reason, public._booking_event_start_at(b.id) AS overdue_since
    FROM public.bookings b
    WHERE b.lifecycle_status IN ('confirmed', 'pre_event_ready')
      AND b.status NOT IN ('cancelled'::booking_status, 'declined'::booking_status)
      AND public._booking_event_start_at(b.id) + interval '1 hour' <= now()
    UNION ALL
    SELECT b.id, b.reservation_number, b.full_name, b.event_date, b.lifecycle_status, b.booking_origin,
           'end_plus_24h_passed'::text, public._booking_event_end_at(b.id) + interval '24 hours'
    FROM public.bookings b
    WHERE b.lifecycle_status = 'in_progress'
      AND b.status NOT IN ('cancelled'::booking_status, 'declined'::booking_status)
      AND public._booking_event_end_at(b.id) + interval '25 hours' <= now()
  ) s
  ORDER BY s.overdue_since;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_stuck_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_stuck_bookings() TO authenticated, service_role;

-- CM2-16: the deposit email promises a confirmation within about 24 hours.
CREATE OR REPLACE FUNCTION public.admin_deposit_unconfirmed(p_hours integer DEFAULT 20)
 RETURNS TABLE(booking_id uuid, reservation_number text, full_name text, event_date date,
               deposit_paid_at timestamptz, hours_waiting numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY
  SELECT b.id, b.reservation_number, b.full_name, b.event_date, b.deposit_paid_at,
         round(extract(epoch FROM now() - b.deposit_paid_at)::numeric / 3600, 1)
  FROM public.bookings b
  WHERE b.lifecycle_status = 'pending'
    AND b.deposit_paid_at IS NOT NULL
    AND b.deposit_paid_at <= now() - make_interval(hours => GREATEST(COALESCE(p_hours, 20), 1))
    AND b.status NOT IN ('cancelled'::booking_status, 'declined'::booking_status)
    AND b.event_date >= (now() AT TIME ZONE 'America/New_York')::date
  ORDER BY b.deposit_paid_at;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_deposit_unconfirmed(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_deposit_unconfirmed(integer) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- L2-09 + CM2-14: internal bookings get a reservation number (the S04 email
-- tells the guest to enter it) and run readiness at creation, which creates
-- their set_lifecycle_in_progress job (recompute only ran on UPDATE before).
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.admin_create_blocking_booking(jsonb)'::regprocedure);
  v_cols_old text := $o$        initials, signer_name, signature, signature_date, client_notes, booking_origin, policy_id, series_id
      ) VALUES ($o$;
  v_cols_new text := $n$        initials, signer_name, signature, signature_date, client_notes, booking_origin, policy_id, series_id,
        reservation_number
      ) VALUES ($n$;
  v_vals_old text := $o$        v_initials, v_name, 'Internal Booking', v_d, v_notes, 'internal'::booking_origin, v_policy, v_series
      ) RETURNING id INTO v_id;$o$;
  v_vals_new text := $n$        v_initials, v_name, 'Internal Booking', v_d, v_notes, 'internal'::booking_origin, v_policy, v_series,
        v_res
      ) RETURNING id INTO v_id;
      PERFORM public.recompute_booking_readiness(v_id, 'admin_create');$n$;
  v_ins_old text := $o$    IF v_kind = 'internal' THEN
      INSERT INTO public.bookings ($o$;
  v_ins_new text := $n$    IF v_kind = 'internal' THEN
      LOOP
        SELECT 'OEV-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
        INTO v_res FROM generate_series(1, 6);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM public.bookings WHERE reservation_number = v_res);
      END LOOP;
      INSERT INTO public.bookings ($n$;
BEGIN
  IF position('recompute_booking_readiness(v_id, ''admin_create'')' IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF position(v_cols_old IN v_def) = 0 OR position(v_vals_old IN v_def) = 0 OR position(v_ins_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'admin_create_blocking_booking changed; internal branch anchors not found';
  END IF;
  v_def := replace(v_def, v_cols_old, v_cols_new);
  v_def := replace(v_def, v_vals_old, v_vals_new);
  v_def := replace(v_def, v_ins_old, v_ins_new);
  EXECUTE v_def;
END
$mig$;

-- ---------------------------------------------------------------------------
-- L2-17: rescheduling an In Progress booking to a later start moves it back to
-- Confirmed; the readiness trigger then re-promotes it and recreates its
-- event-start job.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.reschedule_booking(uuid,date,text,text,text,uuid)'::regprocedure);
  v_anchor text := $o$  IF v_date_shift_days <> 0 THEN
    UPDATE public.scheduled_jobs
    SET
      status = 'cancelled',$o$;
  v_insert text := $n$  IF v_booking.lifecycle_status = 'in_progress'
     AND public._booking_event_start_at(p_booking_id) > now() THEN
    PERFORM set_config('oev.lifecycle_writer', 'on', true);
    UPDATE public.bookings SET lifecycle_status = 'confirmed', updated_at = now() WHERE id = p_booking_id;
    PERFORM set_config('oev.lifecycle_writer', '', true);
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (p_booking_id, 'lifecycle_transition', 'admin', jsonb_build_object(
      'from', 'in_progress', 'to', 'confirmed', 'reason', 'rescheduled_to_future_start', 'actor', p_actor_id));
    PERFORM public.recompute_booking_readiness(p_booking_id, 'reschedule');
  END IF;
$n$;
  v_ret_old text := $o$    'lifecycle_status', v_booking.lifecycle_status,$o$;
  v_ret_new text := $n$    'lifecycle_status', (SELECT bl.lifecycle_status FROM public.bookings bl WHERE bl.id = p_booking_id),$n$;
BEGIN
  IF position('rescheduled_to_future_start' IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF position(v_anchor IN v_def) = 0 OR position(v_ret_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'reschedule_booking changed; anchors not found';
  END IF;
  IF (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1
     OR (length(v_def) - length(replace(v_def, v_ret_old, ''))) / length(v_ret_old) <> 1 THEN
    RAISE EXCEPTION 'reschedule_booking anchors are not unique';
  END IF;
  v_def := replace(v_def, v_anchor, v_insert || v_anchor);
  v_def := replace(v_def, v_ret_old, v_ret_new);
  EXECUTE v_def;
END
$mig$;

-- ---------------------------------------------------------------------------
-- CM2-02: one end rule for the Event Page (the door code closes at the event
-- end from _booking_event_end_at, the same instant one_hour_report and the
-- lifecycle cron use) ...
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.get_access_code_for_reservation(text,text)'::regprocedure);
  v_old text := $o$  IF v_booking.end_time IS NOT NULL THEN
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
  END IF;$o$;
  v_new text := $n$  v_close := public._booking_event_end_at(v_booking.id);$n$;
BEGIN
  IF position(v_new IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'get_access_code_for_reservation changed; close-window block not found';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

-- ... and the Guest Report stays reachable for 24h after the end. The door
-- code is never returned here; only what the report form needs.
CREATE OR REPLACE FUNCTION public.get_guest_report_window(p_reservation_number text DEFAULT NULL::text, p_email text DEFAULT NULL::text)
 RETURNS TABLE(booking_id uuid, reservation_number text, full_name text, email text, phone text,
               event_date date, start_time time without time zone, end_time time without time zone,
               event_type text, event_ended_at timestamptz, report_open_until timestamptz, report_submitted boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res text := nullif(trim(p_reservation_number), '');
  v_email text := nullif(lower(trim(p_email)), '');
  v_res_norm text;
  v_b record;
  v_end timestamptz;
BEGIN
  IF v_res IS NULL AND v_email IS NULL THEN
    RAISE EXCEPTION 'reservation_number_or_email_required' USING ERRCODE = '22023';
  END IF;
  v_res_norm := public.normalize_reservation_number(v_res);

  SELECT b.id, b.reservation_number, b.full_name, b.email, b.phone, b.event_date, b.start_time,
         b.end_time, b.event_type, b.status, b.lifecycle_status
    INTO v_b
    FROM public.bookings b
   WHERE (v_res IS NULL OR upper(trim(b.reservation_number)) = upper(v_res)
          OR (v_res_norm <> '' AND public.normalize_reservation_number(b.reservation_number) = v_res_norm))
     AND (v_email IS NULL OR lower(trim(b.email)) = v_email)
     AND b.reservation_number IS NOT NULL
   ORDER BY (upper(trim(b.reservation_number)) = upper(COALESCE(v_res, ''))) DESC, b.event_date DESC
   LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status IN ('cancelled', 'declined') OR v_b.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'reservation_inactive' USING ERRCODE = 'P0001';
  END IF;

  v_end := public._booking_event_end_at(v_b.id);
  IF now() < v_end OR now() > v_end + interval '24 hours' THEN
    RAISE EXCEPTION 'report_window_closed' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT v_b.id, v_b.reservation_number, v_b.full_name, v_b.email, v_b.phone, v_b.event_date,
         v_b.start_time, v_b.end_time, v_b.event_type, v_end, v_end + interval '24 hours',
         EXISTS (SELECT 1 FROM public.guest_report_submissions g WHERE g.booking_id = v_b.id)
         OR EXISTS (SELECT 1 FROM public.booking_host_reports h WHERE h.booking_id = v_b.id);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_guest_report_window(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_guest_report_window(text, text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- CM2-03: one-send markers for guest emails (claim before sending). Service
-- role only.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.guest_message_sends (
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (booking_id, kind)
);
ALTER TABLE public.guest_message_sends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.guest_message_sends FROM anon, authenticated;
GRANT ALL ON public.guest_message_sends TO service_role;

-- ---------------------------------------------------------------------------
-- CM2-08: since the readiness gate every upcoming booking sits in Confirmed,
-- so the safety net checked nothing. Confirmed is included now. The balance
-- repair calls schedule-balance-payment directly: trigger-booking-automation
-- only schedules the balance for pre_event_ready bookings.
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.auto_fix_missing_jobs()'::regprocedure);
  v_bal_old text := $o$      AND b.lifecycle_status = 'pre_event_ready'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_jobs sj
        WHERE sj.booking_id = b.id AND sj.job_type LIKE 'balance%'
      )
  LOOP
    SELECT net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation',$o$;
  v_bal_new text := $n$      AND b.lifecycle_status IN ('confirmed', 'pre_event_ready')
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_jobs sj
        WHERE sj.booking_id = b.id AND sj.job_type LIKE 'balance%'
      )
  LOOP
    SELECT net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/schedule-balance-payment',$n$;
  v_host_old text := $o$      AND b.lifecycle_status IN ('pre_event_ready', 'in_progress')$o$;
  v_host_new text := $n$      AND b.lifecycle_status IN ('confirmed', 'pre_event_ready', 'in_progress')$n$;
BEGIN
  IF position(v_host_new IN v_def) > 0 THEN
    RETURN; -- already applied
  END IF;
  IF position(v_bal_old IN v_def) = 0 OR position(v_host_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'auto_fix_missing_jobs changed; anchors not found';
  END IF;
  v_def := replace(v_def, v_bal_old, v_bal_new);
  v_def := replace(v_def, v_host_old, v_host_new);
  EXECUTE v_def;
END
$mig$;

-- ---------------------------------------------------------------------------
-- CM2-15: send_cleaning_report=false (INTERNAL_BLOCK_FLOW,
-- EXTERNAL_BLOCK_FLOW) means no cleaning-report reminder job.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_schedule_cleaning_reminder()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lifecycle_status = 'in_progress'
     AND OLD.lifecycle_status IS DISTINCT FROM 'in_progress'
     AND COALESCE((SELECT p.send_cleaning_report FROM public.booking_policies p WHERE p.id = NEW.policy_id), true)
     AND NOT EXISTS (
       SELECT 1 FROM public.scheduled_jobs
       WHERE booking_id = NEW.id AND job_type = 'cleaning_report_reminder' AND status IN ('pending', 'processing')
     ) THEN
    INSERT INTO public.scheduled_jobs (job_type, booking_id, run_at, status)
    VALUES ('cleaning_report_reminder', NEW.id, public._booking_event_end_at(NEW.id) + interval '24 hours', 'pending');
  END IF;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- CM2-12: popup-lead unsubscribe. Opaque token per lead; only the RPC may set
-- unsubscribed_at and nobody may change the token (anon has a broad UPDATE
-- policy on popup_leads for "converted").
-- ---------------------------------------------------------------------------
ALTER TABLE public.popup_leads ADD COLUMN IF NOT EXISTS unsubscribed_at timestamptz;
ALTER TABLE public.popup_leads ADD COLUMN IF NOT EXISTS unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX IF NOT EXISTS popup_leads_unsubscribe_token_key ON public.popup_leads (unsubscribe_token);

CREATE OR REPLACE FUNCTION public.trg_guard_popup_lead_unsubscribe()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.unsubscribe_token IS DISTINCT FROM OLD.unsubscribe_token THEN
    RAISE EXCEPTION 'unsubscribe_token cannot change' USING ERRCODE = '42501';
  END IF;
  IF NEW.unsubscribed_at IS DISTINCT FROM OLD.unsubscribed_at
     AND COALESCE(current_setting('oev.unsubscribe_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'unsubscribed_at changes go through unsubscribe_lead' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_popup_lead_unsubscribe ON public.popup_leads;
CREATE TRIGGER trg_guard_popup_lead_unsubscribe
  BEFORE UPDATE OF unsubscribed_at, unsubscribe_token ON public.popup_leads
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_popup_lead_unsubscribe();

CREATE OR REPLACE FUNCTION public.unsubscribe_lead(p_token uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_at timestamptz;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  PERFORM set_config('oev.unsubscribe_writer', 'on', true);
  UPDATE public.popup_leads
     SET unsubscribed_at = COALESCE(unsubscribed_at, now())
   WHERE unsubscribe_token = p_token
  RETURNING unsubscribed_at INTO v_at;
  PERFORM set_config('oev.unsubscribe_writer', '', true);
  IF v_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'unsubscribed_at', v_at);
END;
$function$;

REVOKE ALL ON FUNCTION public.unsubscribe_lead(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.unsubscribe_lead(uuid) TO anon, authenticated, service_role;
