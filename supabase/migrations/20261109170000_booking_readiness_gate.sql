-- =============================================================================
-- Pre-event readiness: one rule, enforced in the database
-- ClickUp 86e3zjfq6 — "Fix inconsistent pre-event readiness and booking
-- lifecycle updates in OEV"
--
-- Before this migration:
--   * confirmed -> pre_event_ready was decided by a GHL workflow that fired
--     when sync-to-ghl reported has_staff_assigned=true, and wrote the
--     lifecycle back through ghl-update-booking-status with no validation.
--     Assignment alone was enough; acceptance was never checked.
--   * GHL also wrote in_progress right after balance payment (20/20 cases,
--     1-38 days before the event), which marked staff assignments completed
--     early via auto_complete_assignments_on_in_progress.
--   * pg_cron auto-rejected staff invitations 24h after assignment.
--
-- After this migration:
--   * evaluate_booking_readiness() is the single readiness rule:
--       - confirmation checklist complete (bookings.pre_event_ready = 'true')
--       - non-external bookings: >= 1 selected staff member, and EVERY
--         selected staff member (bar vendors excluded, cancelled excluded)
--         accepted THIS booking. Pending or rejected blocks.
--       - external bookings are exempt from the staff requirement.
--   * enforce_pre_event_ready_gate (BEFORE UPDATE) rejects any write that
--     moves a booking into pre_event_ready while the rule is unmet.
--   * "GHL proposes, the DB validates": the GHL workflows keep driving the
--     forward lifecycle (confirmed -> pre_event_ready, -> in_progress) through
--     ghl-update-booking-status, which now checks booking_readiness() first.
--     sync-to-ghl reports pre_event_ready_eligible / staff_all_accepted /
--     event_started so the workflow can wait for acceptance and event start.
--   * The DB never promotes on its own. recompute_booking_readiness() only
--     DEMOTES pre_event_ready -> confirmed when the rule stops holding (new
--     pending staff, a decline, checklist unchecked) and tells GHL.
--   * Every staff response (accept/decline from the staff portal) triggers
--     sync-to-ghl, so the GHL workflow learns about it within seconds.
--   * Event-day safety net: confirmed bookings also get a
--     set_lifecycle_in_progress job, so an event whose staff never answered
--     still goes in_progress at start time (process-scheduled-jobs accepts
--     confirmed as a source state).
--   * Auto-reject cron removed; reopened invitations on future events.
-- =============================================================================

-- 1) Stop auto-rejecting unanswered staff invitations -------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('auto-reject-stale-staff-assignments');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[READINESS] auto-reject cron not present: %', SQLERRM;
END $$;

-- 2) The rule (pure: takes the checklist/origin values so it can evaluate a
--    row that is still being written inside a BEFORE trigger) -----------------
CREATE OR REPLACE FUNCTION public.evaluate_booking_readiness(
  p_booking_id uuid,
  p_checklist text,
  p_origin text
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_unmet jsonb := '[]'::jsonb;
  v_staff_exempt boolean := COALESCE(p_origin, '') = 'external';
  v_total int := 0;
  v_accepted int := 0;
  v_pending text[];
  v_rejected text[];
BEGIN
  IF COALESCE(p_checklist, 'false') <> 'true' THEN
    v_unmet := v_unmet || jsonb_build_array(jsonb_build_object(
      'code', 'checklist_incomplete',
      'message', 'Confirmation checklist is not complete'
    ));
  END IF;

  IF NOT v_staff_exempt THEN
    SELECT
      count(*),
      count(*) FILTER (WHERE a.response_status = 'accepted'),
      array_agg(COALESCE(s.full_name, 'Unknown staff') || ' (' || a.assignment_role || ')' ORDER BY a.created_at)
        FILTER (WHERE COALESCE(a.response_status, 'pending') = 'pending'),
      array_agg(COALESCE(s.full_name, 'Unknown staff') || ' (' || a.assignment_role || ')' ORDER BY a.created_at)
        FILTER (WHERE a.response_status = 'rejected')
    INTO v_total, v_accepted, v_pending, v_rejected
    FROM public.booking_staff_assignments a
    LEFT JOIN public.staff_members s ON s.id = a.staff_id
    WHERE a.booking_id = p_booking_id
      AND a.status <> 'cancelled'
      AND COALESCE(a.assignment_type, '') <> 'bar_service';

    IF v_total = 0 THEN
      v_unmet := v_unmet || jsonb_build_array(jsonb_build_object(
        'code', 'no_staff',
        'message', 'No staff assigned'
      ));
    END IF;

    IF v_pending IS NOT NULL THEN
      v_unmet := v_unmet || jsonb_build_array(jsonb_build_object(
        'code', 'staff_pending',
        'message', 'Waiting for staff to accept: ' || array_to_string(v_pending, ', '),
        'staff', to_jsonb(v_pending)
      ));
    END IF;

    IF v_rejected IS NOT NULL THEN
      v_unmet := v_unmet || jsonb_build_array(jsonb_build_object(
        'code', 'staff_rejected',
        'message', 'Staff declined, remove or replace: ' || array_to_string(v_rejected, ', '),
        'staff', to_jsonb(v_rejected)
      ));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_unmet) = 0,
    'staff_exempt', v_staff_exempt,
    'staff_total', v_total,
    'staff_accepted', v_accepted,
    'unmet', v_unmet
  );
END;
$function$;

-- 3) Read API for the admin UI --------------------------------------------------
CREATE OR REPLACE FUNCTION public.booking_readiness(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
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
         -- Same anchor as the event-start job: start_time, or 06:00 for daily.
         'event_started', now() >= (b.event_date + COALESCE(b.start_time, time '06:00')) AT TIME ZONE 'America/New_York'
       );
END;
$function$;

-- 4) Gate: nothing (admin dropdown, GHL, edge functions) can move a booking
--    into pre_event_ready while the rule is unmet ------------------------------
CREATE OR REPLACE FUNCTION public.enforce_pre_event_ready_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
  v_msg text;
BEGIN
  IF NEW.lifecycle_status = 'pre_event_ready'
     AND OLD.lifecycle_status IS DISTINCT FROM 'pre_event_ready' THEN
    v := public.evaluate_booking_readiness(NEW.id, NEW.pre_event_ready, NEW.booking_origin::text);
    IF NOT (v->>'ready')::boolean THEN
      SELECT string_agg(e->>'message', '; ') INTO v_msg
        FROM jsonb_array_elements(v->'unmet') e;
      RAISE EXCEPTION 'Cannot move to Pre-Event Ready: %', v_msg
        USING ERRCODE = 'check_violation', DETAIL = v::text;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_enforce_pre_event_ready_gate ON public.bookings;
CREATE TRIGGER trg_enforce_pre_event_ready_gate
  BEFORE UPDATE OF lifecycle_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.enforce_pre_event_ready_gate();

-- 5) Recompute: re-apply the rule to one booking. DEMOTES only; promotion is
--    the GHL workflow's job (validated by the gate). Row-locks the booking so
--    concurrent staff responses serialize instead of racing. -----------------
CREATE OR REPLACE FUNCTION public.recompute_booking_readiness(
  p_booking_id uuid,
  p_source text DEFAULT 'system'
) RETURNS jsonb
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

  -- Same anchor process-scheduled-jobs uses: start_time, or 06:00 for daily.
  v_start := (b.event_date + COALESCE(b.start_time, time '06:00')) AT TIME ZONE 'America/New_York';

  IF b.status IS DISTINCT FROM 'cancelled' AND v_start > now()
     AND b.lifecycle_status = 'pre_event_ready' AND NOT (v->>'ready')::boolean THEN
    v_to := 'confirmed';
  END IF;

  IF v_to IS NOT NULL THEN
    UPDATE public.bookings
       SET lifecycle_status = v_to,
           updated_at = now()
     WHERE id = b.id;

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

    -- Tell GHL (lifecycle + pre_event_ready_eligible) so its workflow can
    -- re-promote once everyone accepts again.
    IF NOT v_silent THEN
      PERFORM net.http_post(
        url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-to-ghl',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('booking_id', b.id)
      );
    END IF;
  END IF;

  -- Event-day safety net: the in_progress job must exist even while the
  -- booking waits in confirmed for staff acceptance.
  IF COALESCE(v_to, b.lifecycle_status) IN ('confirmed', 'pre_event_ready')
     AND b.status IS DISTINCT FROM 'cancelled'
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

-- 6) Triggers that keep lifecycle in sync with the rule ------------------------
CREATE OR REPLACE FUNCTION public.trg_readiness_on_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.booking_id IS NOT NULL THEN
    v := public.recompute_booking_readiness(OLD.booking_id, 'staff_' || lower(TG_OP));

    -- A staff response from the portal never reached GHL before, so the
    -- workflow could not wait for acceptance. Sync it (recompute already
    -- synced if it demoted).
    IF TG_OP = 'UPDATE'
       AND NEW.response_status IS DISTINCT FROM OLD.response_status
       AND v IS NOT NULL
       AND NOT COALESCE((v->>'changed')::boolean, false)
       AND COALESCE(current_setting('oev.readiness_silent', true), '') <> 'on' THEN
      PERFORM net.http_post(
        url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-to-ghl',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('booking_id', OLD.booking_id, 'sync_reason', 'staff_response')
      );
    END IF;
  END IF;
  IF TG_OP = 'INSERT' AND NEW.booking_id IS NOT NULL THEN
    PERFORM public.recompute_booking_readiness(NEW.booking_id, 'staff_insert');
  ELSIF TG_OP = 'UPDATE' AND NEW.booking_id IS NOT NULL
        AND NEW.booking_id IS DISTINCT FROM OLD.booking_id THEN
    PERFORM public.recompute_booking_readiness(NEW.booking_id, 'staff_update');
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_readiness_on_assignment ON public.booking_staff_assignments;
CREATE TRIGGER trg_readiness_on_assignment
  AFTER INSERT OR DELETE OR UPDATE OF response_status, status, booking_id, assignment_type
  ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_readiness_on_assignment();

CREATE OR REPLACE FUNCTION public.trg_readiness_on_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- recompute's own UPDATE re-enters here at depth 2; it already applied the rule.
  IF pg_trigger_depth() > 1 THEN
    RETURN NULL;
  END IF;
  IF NEW.pre_event_ready IS DISTINCT FROM OLD.pre_event_ready
     OR NEW.booking_origin IS DISTINCT FROM OLD.booking_origin
     OR (NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status
         AND NEW.lifecycle_status IN ('confirmed', 'pre_event_ready')) THEN
    PERFORM public.recompute_booking_readiness(NEW.id, 'booking_update');
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_readiness_on_booking ON public.bookings;
CREATE TRIGGER trg_readiness_on_booking
  AFTER UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_readiness_on_booking();

-- 7) Privileges: the UI only reads; state changes only happen through triggers.
REVOKE ALL ON FUNCTION public.evaluate_booking_readiness(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_booking_readiness(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_readiness(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.booking_readiness(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recompute_booking_readiness(uuid, text) TO service_role;

-- 8) One-time backfill (silent: no sync-to-ghl, no notifications) -------------
DO $$
DECLARE
  r record;
  v_reopened int := 0;
  v_early int := 0;
  v_recomputed int := 0;
  v_target text;
BEGIN
  PERFORM set_config('oev.readiness_silent', 'on', true);

  -- a) Auto-rejected invitations on future, non-cancelled events go back to
  --    pending so the staff member can still answer.
  WITH upd AS (
    UPDATE public.booking_staff_assignments a
       SET response_status = 'pending',
           auto_rejected = false,
           response_at = NULL,
           updated_at = now()
      FROM public.bookings b
     WHERE b.id = a.booking_id
       AND a.auto_rejected
       AND a.response_status = 'rejected'
       AND b.status IS DISTINCT FROM 'cancelled'
       AND b.lifecycle_status <> 'cancelled'
       AND (b.event_date + COALESCE(b.start_time, time '06:00')) AT TIME ZONE 'America/New_York' > now()
    RETURNING a.id, a.booking_id
  ), ev AS (
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    SELECT booking_id, 'staff_assignment_auto_reject_reverted', 'system',
           jsonb_build_object('assignment_id', id, 'reason', 'auto-reject removed (ClickUp 86e3zjfq6)')
      FROM upd
    RETURNING 1
  )
  SELECT count(*) INTO v_reopened FROM ev;

  -- b) Undo in_progress that GHL wrote at balance payment, before the event.
  FOR r IN
    SELECT id
      FROM public.bookings
     WHERE lifecycle_status = 'in_progress'
       AND status IS DISTINCT FROM 'cancelled'
       AND (event_date + COALESCE(start_time, time '06:00')) AT TIME ZONE 'America/New_York' > now()
  LOOP
    -- Back to where it was before GHL jumped ahead: pre_event_ready if the
    -- rule holds (passes the gate), confirmed otherwise.
    SELECT CASE WHEN (public.booking_readiness(r.id)->>'ready')::boolean
                THEN 'pre_event_ready' ELSE 'confirmed' END
      INTO v_target;
    UPDATE public.bookings
       SET lifecycle_status = v_target, updated_at = now()
     WHERE id = r.id;
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (r.id, 'lifecycle_early_in_progress_reverted', 'system',
            jsonb_build_object('to_lifecycle', v_target,
                               'reason', 'in_progress set before event start (GHL on balance payment), ClickUp 86e3zjfq6'));
    v_early := v_early + 1;
  END LOOP;

  -- c) Apply the rule to every future confirmed / pre_event_ready booking.
  FOR r IN
    SELECT id
      FROM public.bookings
     WHERE lifecycle_status IN ('confirmed', 'pre_event_ready')
       AND status IS DISTINCT FROM 'cancelled'
       AND (event_date + COALESCE(start_time, time '06:00')) AT TIME ZONE 'America/New_York' > now()
  LOOP
    PERFORM public.recompute_booking_readiness(r.id, 'backfill_86e3zjfq6');
    v_recomputed := v_recomputed + 1;
  END LOOP;

  RAISE NOTICE '[READINESS] backfill: reopened=% early_in_progress_reverted=% recomputed=%',
    v_reopened, v_early, v_recomputed;
END $$;
