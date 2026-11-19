-- =============================================================================
-- ClickUp 1dfqjx6vh17 — OEV audit follow-up
--
-- Luis's rule: a booking reaches Pre-Event Ready ONLY after the staff assigned
-- to THAT booking accept. It never moves forward on its own, from any path.
--
-- What production showed on 2026-11-19 (before this migration):
--   * 7 of 7 bookings in pre_event_ready were external. The 11/09 rule exempted
--     external bookings from staff, and admin_create_blocking_booking created
--     them directly in pre_event_ready. OEV-JSNXY6 (event 11/20) sat in
--     Pre-Event Ready with its cleaner still "pending".
--   * Internal bookings were held correctly, but nothing moved them forward
--     after acceptance except the GHL workflow (never exercised since 11/09).
--   * 14 payroll lines (+3 rejected) belonged to staff who never accepted.
--     None paid, but nothing in the DB stopped "Mark paid".
--   * OEV-JTURTY had two duplicate cleaning assignments marked completed two
--     weeks before the event (old early in_progress bug).
--   * 5 past bookings were stuck before in_progress (3 external, 2 internal).
--
-- This migration:
--   1. Readiness rule applies to every origin (no external exemption).
--   2. The DB promotes confirmed -> pre_event_ready the moment the rule holds
--      (and still demotes when it stops holding). GHL is told either way.
--   3. admin_create_blocking_booking creates externals in confirmed with the
--      checklist done; they move once their staff accept.
--   4. Payroll: no base pay line exists for an assignment whose staff did not
--      accept, and no line of such an assignment can be marked paid.
--   5. admin_record_staff_response: the office records an acceptance or a
--      decline given by phone/text (audited), so the rule is workable.
--   6. Backfill (idempotent, guarded by current state). Past stuck bookings
--      are left alone on purpose (see 6, end).
-- =============================================================================

-- 1. Readiness rule: every origin -------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_booking_readiness(p_booking_id uuid, p_checklist text, p_origin text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_unmet jsonb := '[]'::jsonb;
  v_total int := 0;
  v_accepted int := 0;
  v_pending text[];
  v_rejected text[];
BEGIN
  -- p_origin is kept for the signature; since 1dfqjx6vh17 no origin is exempt.
  IF COALESCE(p_checklist, 'false') <> 'true' THEN
    v_unmet := v_unmet || jsonb_build_array(jsonb_build_object(
      'code', 'checklist_incomplete',
      'message', 'Confirmation checklist is not complete'
    ));
  END IF;

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

  RETURN jsonb_build_object(
    'ready', jsonb_array_length(v_unmet) = 0,
    'staff_exempt', false,
    'staff_total', v_total,
    'staff_accepted', v_accepted,
    'unmet', v_unmet
  );
END;
$function$;

-- 2. Recompute: demote when unmet, PROMOTE when met ---------------------------------
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

  v_start := (b.event_date + COALESCE(b.start_time, time '06:00')) AT TIME ZONE 'America/New_York';

  IF b.status IS DISTINCT FROM 'cancelled'::booking_status AND v_start > now() THEN
    IF b.lifecycle_status = 'pre_event_ready' AND NOT (v->>'ready')::boolean THEN
      v_to := 'confirmed';
    ELSIF b.lifecycle_status = 'confirmed' AND b.status = 'confirmed'::booking_status
          AND (v->>'ready')::boolean THEN
      v_to := 'pre_event_ready';
    END IF;
  END IF;

  IF v_to IS NOT NULL THEN
    -- Go through the lifecycle writer guard explicitly, then restore the flag
    -- so it does not leak into the rest of the caller's transaction.
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
        body := jsonb_build_object('booking_id', b.id)
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

-- 3. External bookings start in confirmed (checklist done, waiting for staff) -----
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.admin_create_blocking_booking(jsonb)'::regprocedure);
  v_old text := $old$      BEGIN
        PERFORM set_config('oev.lifecycle_writer', 'on', true);
        UPDATE public.bookings SET pre_event_ready = 'true', lifecycle_status = 'pre_event_ready' WHERE id = v_id;
      EXCEPTION WHEN OTHERS THEN
        v_warnings := v_warnings || ('pre_event_ready: ' || SQLERRM);
      END;$old$;
  v_new text := $new$      -- 1dfqjx6vh17: the client already paid, so the checklist is done, but
      -- the booking stays confirmed until its staff accept. The readiness
      -- trigger promotes it then (recompute_booking_readiness).
      UPDATE public.bookings SET pre_event_ready = 'true' WHERE id = v_id;$new$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    IF position('UPDATE public.bookings SET pre_event_ready = ''true'' WHERE id = v_id;' IN v_def) > 0 THEN
      RETURN; -- already applied
    END IF;
    RAISE EXCEPTION 'admin_create_blocking_booking changed; external block not found';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$mig$;

-- 4. Payroll exists and is payable only for staff who accepted --------------------
CREATE OR REPLACE FUNCTION public.trg_payroll_requires_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resp text;
  v_name text;
  v_res text;
BEGIN
  IF NEW.assignment_id IS NULL THEN
    RETURN NEW;
  END IF;
  -- The rule is per booking. Standalone jobs (no booking, created by the office
  -- for work already agreed) and bar vendors (outside the readiness rule, no
  -- portal acceptance) are not gated here.
  SELECT a.response_status, s.full_name, b.reservation_number
    INTO v_resp, v_name, v_res
    FROM public.booking_staff_assignments a
    LEFT JOIN public.staff_members s ON s.id = a.staff_id
    LEFT JOIN public.bookings b ON b.id = a.booking_id
   WHERE a.id = NEW.assignment_id
     AND a.booking_id IS NOT NULL
     AND COALESCE(a.assignment_type, '') <> 'bar_service'
     FOR SHARE OF a;  -- a concurrent decline cannot slip past a Mark paid
  IF NOT FOUND OR v_resp = 'accepted' THEN
    RETURN NEW;
  END IF;

  IF NEW.paid_status = 'paid'
     AND (TG_OP = 'INSERT' OR OLD.paid_status IS DISTINCT FROM 'paid') THEN
    RAISE EXCEPTION 'Cannot mark paid: % has not accepted this assignment%. Record their acceptance on the booking first.',
      COALESCE(v_name, 'this staff member'), COALESCE(' (' || v_res || ')', '')
      USING ERRCODE = 'P0001';
  END IF;

  -- Base pay is created only for accepted staff. Skipping (not raising) keeps
  -- every caller of populate_staff_payroll_items working: it deletes the
  -- unpaid lines and simply inserts none. Bonus/deduction lines may exist but
  -- stay unpayable until the staff accepted.
  IF TG_OP = 'INSERT' AND NEW.pay_category NOT IN ('bonus', 'deduction') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_payroll_requires_acceptance ON public.staff_payroll_items;
CREATE TRIGGER trg_payroll_requires_acceptance
  BEFORE INSERT OR UPDATE OF paid_status ON public.staff_payroll_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_payroll_requires_acceptance();

REVOKE ALL ON FUNCTION public.trg_payroll_requires_acceptance() FROM PUBLIC, anon, authenticated;

-- 5. Office records a response given outside the portal ---------------------------
CREATE OR REPLACE FUNCTION public.admin_record_staff_response(p_assignment_id uuid, p_response text, p_note text DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.booking_staff_assignments%ROWTYPE;
  v_row public.booking_staff_assignments%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_name text;
BEGIN
  PERFORM public._assert_admin_or_service();
  IF p_response IS NULL OR p_response NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'response must be accepted or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.booking_staff_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION 'this assignment was cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.response_status IS NOT DISTINCT FROM p_response THEN
    RETURN jsonb_build_object('changed', false, 'assignment_id', v_old.id,
                              'booking_id', v_old.booking_id, 'response_status', v_old.response_status);
  END IF;

  UPDATE public.booking_staff_assignments
     SET response_status = p_response,
         response_at = now(),
         updated_at = now()
   WHERE id = p_assignment_id
  RETURNING * INTO v_row;

  -- Work already done (assignment completed) whose pay line was skipped or
  -- removed while unaccepted: rebuild it now. Never touches a paid line.
  IF p_response = 'accepted' AND v_row.status = 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_payroll_items
        WHERE assignment_id = v_row.id AND paid_status = 'paid'
          AND pay_category NOT IN ('bonus', 'deduction')
     ) THEN
    PERFORM public.populate_staff_payroll_items(v_row.id, false);
  END IF;

  IF v_row.booking_id IS NOT NULL THEN
    SELECT full_name INTO v_name FROM public.staff_members WHERE id = v_row.staff_id;
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      v_row.booking_id,
      CASE WHEN p_response = 'accepted' THEN 'staff_assignment_accepted' ELSE 'staff_assignment_rejected' END,
      'admin',
      jsonb_build_object(
        'assignment_id', v_row.id,
        'staff_id', v_row.staff_id,
        'staff_name', v_name,
        'assignment_role', v_row.assignment_role,
        'responded_at', v_row.response_at,
        'previous_response', v_old.response_status,
        'recorded_by_office', true,
        'recorded_by', auth.uid(),
        'note', v_note
      )
    );
  END IF;

  RETURN jsonb_build_object('changed', true, 'assignment_id', v_row.id,
                            'booking_id', v_row.booking_id, 'response_status', v_row.response_status);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_record_staff_response(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_staff_response(uuid, text, text) TO authenticated, service_role;

-- 6. Backfill -----------------------------------------------------------------------
DO $bf$
DECLARE
  r record;
  v_ids uuid[];
BEGIN
  -- 6a. OEV-JTURTY: double-click duplicate cleaning assignment + both marked
  --     completed on 11/07 for an event on 11/21. Cancel the duplicate (its
  --     unpaid line is voided by trg_void_payroll_on_assignment_exit), return
  --     the other to assigned and void its unpaid line.
  UPDATE public.booking_staff_assignments
     SET status = 'cancelled', updated_at = now()
   WHERE id = '0c73fd30-75fe-4c96-ac0e-b46d19974bab'
     AND status = 'completed' AND response_status = 'pending';

  UPDATE public.booking_staff_assignments
     SET status = 'assigned', completed_at = NULL, updated_at = now()
   WHERE id = '9666bd7c-00b8-4c7d-8faa-0c6958c2e2af'
     AND status = 'completed' AND response_status = 'pending';

  -- 6b. Unpaid base pay of staff who have not accepted, for events that have
  --     not ended yet. Recreated at completion if they accept. Past events are
  --     left for the office: the line stays, but cannot be paid until the
  --     acceptance is recorded.
  SELECT array_agg(DISTINCT a.id) INTO v_ids
    FROM public.booking_staff_assignments a
    JOIN public.staff_payroll_items p ON p.assignment_id = a.id
   WHERE a.booking_id IS NOT NULL
     AND a.response_status IS DISTINCT FROM 'accepted'
     AND COALESCE(a.assignment_type, '') <> 'bar_service'
     AND COALESCE(p.paid_status, 'pending') <> 'paid'
     AND p.pay_category NOT IN ('bonus', 'deduction')
     AND public._booking_event_end_at(a.booking_id) > now();
  IF v_ids IS NOT NULL THEN
    PERFORM public._void_unpaid_payroll(v_ids, 'staff_not_accepted');
  END IF;

  -- 6c. Apply the rule to every upcoming booking (demotes the externals that
  --     have no accepted staff; promotes any booking whose staff all accepted).
  FOR r IN
    SELECT id FROM public.bookings
     WHERE lifecycle_status IN ('confirmed', 'pre_event_ready')
       AND status IS DISTINCT FROM 'cancelled'::booking_status
       AND (event_date + COALESCE(start_time, time '06:00')) AT TIME ZONE 'America/New_York' > now()
  LOOP
    PERFORM public.recompute_booking_readiness(r.id, 'rule_every_origin_backfill');
  END LOOP;

  -- Past events stuck before in_progress (OEV-0BB240, OEV-9SQGNT, OEV-EQRH57 +
  -- 2 internal blocks from May/June) are deliberately NOT moved here: walking
  -- them through in_progress/post_event fires host-report catch-up and GHL
  -- syncs on contacts that may belong to newer bookings. They need a silent
  -- close, decided separately.
END
$bf$;
