-- Phase 1B / M-23..M-25 (ClickUp 86e40ach2): one guarded lifecycle writer
-- for the automations, and events that actually close.
--
-- Before:
--   * M-23: closing an event needed the GUEST's post-event report; it almost
--     never came, so 27 of 27 bookings since August sat "In Progress" for the
--     10-day timeout.
--   * M-24: deposit-paid / invoiced bookings never moved to In Progress (the
--     job demanded fully_paid); 0 of 61 jobs ever completed.
--   * M-25: the post-event cron wrote lifecycle with no compare-and-set and
--     no cancelled check (OEV-Y4UP6Y: cancelled but post_event).
--
-- Now (Luis D7, recommendation c): events close 24h after they end, no guest
-- report needed, and the office can close an event by hand. Every automated
-- move goes through transition_booking(): row lock, allowed-transition table,
-- compare-and-set on the state the caller read, never on a cancelled booking.
-- Phase 2 (E-4) routes the admin dropdown and GHL through it as well.

CREATE OR REPLACE FUNCTION public._lifecycle_transition_allowed(p_from text, p_to text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT (p_from, p_to) IN (
    ('pending', 'confirmed'),
    ('confirmed', 'pre_event_ready'),
    ('pre_event_ready', 'confirmed'),
    ('confirmed', 'in_progress'),
    ('pre_event_ready', 'in_progress'),
    ('in_progress', 'post_event'),
    ('post_event', 'closed_review_complete')
  );
$function$;

CREATE OR REPLACE FUNCTION public.transition_booking(
  p_booking_id uuid,
  p_to text,
  p_expected_from text[] DEFAULT NULL,
  p_reason text DEFAULT NULL,
  p_channel text DEFAULT 'system'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
BEGIN
  PERFORM public._assert_admin_or_service();

  IF p_to = 'cancelled' THEN
    RAISE EXCEPTION 'cancel through cancel-booking, not transition_booking' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_not_found');
  END IF;
  IF v_b.status = 'cancelled'::booking_status OR v_b.lifecycle_status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'booking_cancelled', 'from', v_b.lifecycle_status);
  END IF;
  IF v_b.lifecycle_status = p_to THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'from', v_b.lifecycle_status, 'to', p_to);
  END IF;
  IF p_expected_from IS NOT NULL AND NOT (v_b.lifecycle_status = ANY (p_expected_from)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'stale_state', 'from', v_b.lifecycle_status, 'expected', p_expected_from);
  END IF;
  IF NOT public._lifecycle_transition_allowed(v_b.lifecycle_status, p_to) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'transition_not_allowed', 'from', v_b.lifecycle_status, 'to', p_to);
  END IF;

  -- The pre_event_ready gate trigger still applies to this write.
  UPDATE public.bookings
  SET lifecycle_status = p_to, updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, 'lifecycle_transition', COALESCE(p_channel, 'system'),
          jsonb_build_object('from', v_b.lifecycle_status, 'to', p_to, 'reason', p_reason, 'actor', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'changed', true, 'from', v_b.lifecycle_status, 'to', p_to);
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_booking(uuid, text, text[], text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_booking(uuid, text, text[], text, text) TO service_role;
REVOKE ALL ON FUNCTION public._lifecycle_transition_allowed(text, text) FROM PUBLIC, anon;

-- ---------------------------------------------------------------------------
-- When an event starts / closes (Orlando wall clock, overnight-aware), for
-- the crons and the admin screen.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._booking_event_start_at(p_booking_id uuid)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT ((b.event_date + COALESCE(b.start_time, time '00:00')) AT TIME ZONE 'America/New_York')
  FROM public.bookings b
  WHERE b.id = p_booking_id;
$function$;

REVOKE ALL ON FUNCTION public._booking_event_start_at(uuid) FROM PUBLIC, anon, authenticated;

-- Bookings the lifecycle cron should move now. Events before 2026-11-12 are
-- left alone: moving them would complete old assignments and create payroll
-- for the backlog Luis reviews in D5 (same cutoff as the payroll sweep).
CREATE OR REPLACE FUNCTION public.lifecycle_moves_due()
RETURNS TABLE (booking_id uuid, reservation_number text, from_lifecycle text, to_lifecycle text, reason text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Event started: confirmed / pre_event_ready -> in_progress, whatever the
  -- payment state (M-24). Unpaid website leads (payment pending) never move.
  SELECT b.id, b.reservation_number, b.lifecycle_status, 'in_progress', 'event_started'
  FROM public.bookings b
  WHERE b.lifecycle_status IN ('confirmed', 'pre_event_ready')
    AND b.status NOT IN ('cancelled'::booking_status, 'declined'::booking_status)
    AND b.payment_status NOT IN ('pending'::payment_status, 'failed'::payment_status, 'refunded'::payment_status)
    AND b.event_date >= date '2026-11-12'
    AND public._booking_event_start_at(b.id) <= now()
  UNION ALL
  -- Event ended 24h ago: in_progress -> post_event (D7: no guest report).
  -- Same backlog cutoff (Codex review): closing completes accepted
  -- assignments, so events that ended before 2026-11-12 are closed by the
  -- office (Close event) once D5 is decided. Today that is only OEV-9CMUGG.
  SELECT b.id, b.reservation_number, b.lifecycle_status, 'post_event', 'event_end_plus_24h'
  FROM public.bookings b
  WHERE b.lifecycle_status = 'in_progress'
    AND b.status NOT IN ('cancelled'::booking_status, 'declined'::booking_status)
    AND public._booking_event_end_at(b.id) >= timestamptz '2026-11-12 00:00 America/New_York'
    AND public._booking_event_end_at(b.id) + interval '24 hours' <= now();
$function$;

REVOKE ALL ON FUNCTION public.lifecycle_moves_due() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lifecycle_moves_due() TO service_role;

-- ---------------------------------------------------------------------------
-- Office "Close event" (D7). Allowed once the event has started; walks the
-- normal steps so every automation fires in order.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_close_event(p_booking_id uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_r jsonb;
BEGIN
  PERFORM public._assert_admin_or_service();
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status = 'cancelled'::booking_status OR v_b.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF public._booking_event_start_at(p_booking_id) > now() THEN
    RAISE EXCEPTION 'the event has not started yet' USING ERRCODE = 'P0001';
  END IF;
  IF v_b.lifecycle_status IN ('post_event', 'closed_review_complete') THEN
    RETURN jsonb_build_object('ok', true, 'changed', false, 'lifecycle_status', v_b.lifecycle_status);
  END IF;
  IF v_b.lifecycle_status IN ('confirmed', 'pre_event_ready') THEN
    v_r := public.transition_booking(p_booking_id, 'in_progress', ARRAY[v_b.lifecycle_status], 'office_closed_event', 'admin');
    IF NOT (v_r->>'ok')::boolean THEN
      RAISE EXCEPTION 'could not start the event: %', v_r->>'reason' USING ERRCODE = 'P0001';
    END IF;
  ELSIF v_b.lifecycle_status <> 'in_progress' THEN
    RAISE EXCEPTION 'cannot close an event from %', v_b.lifecycle_status USING ERRCODE = 'P0001';
  END IF;
  v_r := public.transition_booking(p_booking_id, 'post_event', ARRAY['in_progress'],
                                   COALESCE('office_closed_event: ' || NULLIF(btrim(p_note), ''), 'office_closed_event'), 'admin');
  IF NOT (v_r->>'ok')::boolean THEN
    RAISE EXCEPTION 'could not close the event: %', v_r->>'reason' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object('ok', true, 'changed', true, 'lifecycle_status', 'post_event');
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_close_event(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_close_event(uuid, text) TO authenticated, service_role;

-- Admin screen: when this booking closes on its own.
CREATE OR REPLACE FUNCTION public.admin_booking_close_eta(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN jsonb_build_object(
    'event_start_at', public._booking_event_start_at(p_booking_id),
    'event_end_at', public._booking_event_end_at(p_booking_id),
    'auto_close_at', public._booking_event_end_at(p_booking_id) + interval '24 hours'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_booking_close_eta(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_booking_close_eta(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- M-27: the cleaning-report reminder is scheduled here, in Orlando time,
-- whenever a booking enters in_progress (any writer). It used to be created
-- only by one job path, from a UTC-parsed time (4-5h early), and never ran.
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

DROP TRIGGER IF EXISTS trg_schedule_cleaning_reminder ON public.bookings;
CREATE TRIGGER trg_schedule_cleaning_reminder
  AFTER UPDATE OF lifecycle_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_schedule_cleaning_reminder();

REVOKE ALL ON FUNCTION public.trg_schedule_cleaning_reminder() FROM PUBLIC, anon, authenticated;

-- The lifecycle cron owns post_event now; no set_lifecycle_post_event job
-- may write it behind transition_booking's back (none exist today).
UPDATE public.scheduled_jobs
SET status = 'cancelled', last_error = 'replaced_by_lifecycle_cron', updated_at = now()
WHERE job_type = 'set_lifecycle_post_event' AND status IN ('pending', 'processing');

-- M-27: jobs that used up their 3 attempts were left "pending" forever (the
-- processor only picks attempts < 3) and looked alive. Mark them failed so
-- the health check and the office see them.
UPDATE public.scheduled_jobs
SET status = 'failed', last_error = COALESCE(last_error, '') || ' [max_attempts_reached]', updated_at = now()
WHERE status = 'pending' AND attempts >= 3;
