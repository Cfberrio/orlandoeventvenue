-- =============================================================================
-- Regression scenarios for the pre-event readiness gate (ClickUp 86e3zjfq6, 1dfqjx6vh17)
-- Migrations under test: supabase/migrations/20261109170000_booking_readiness_gate.sql
--                        supabase/migrations/20261119120000_readiness_every_origin_payroll_acceptance.sql
--
-- SAFE TO RUN AGAINST PRODUCTION: the block ALWAYS ends in RAISE EXCEPTION,
-- so every row it creates (test bookings, assignments, jobs, events, queued
-- pg_net requests) is rolled back. Run it wrapped:
--     begin; <this file>; rollback;
-- Expected result: an error whose message starts with "READINESS_SCENARIOS_PASS".
-- Any message starting with "FAIL" names the scenario that broke.
-- =============================================================================
DO $$
DECLARE
  bk  uuid := gen_random_uuid();   -- website booking under test
  bk2 uuid := gen_random_uuid();   -- a different event, same staff
  bx  uuid := gen_random_uuid();   -- external booking
  s1 uuid; s2 uuid;
  a1 uuid; a2 uuid; a3 uuid;
  lc text;
  r jsonb;
  q0 bigint; q1 bigint;
  codes text;
  raised boolean;
  log text := '';
BEGIN
  SELECT id INTO s1 FROM staff_members WHERE is_active ORDER BY full_name LIMIT 1;
  SELECT id INTO s2 FROM staff_members WHERE is_active AND id <> s1 ORDER BY full_name LIMIT 1;
  IF s1 IS NULL OR s2 IS NULL THEN RAISE EXCEPTION 'FAIL setup: need 2 active staff'; END IF;

  -- Clone a real booking so every NOT NULL column is filled.
  INSERT INTO bookings
  SELECT (jsonb_populate_record(NULL::bookings, to_jsonb(b) || jsonb_build_object(
    'id', bk, 'reservation_number', 'ZZTEST-RDY1', 'lifecycle_status', 'confirmed',
    'status', 'confirmed', 'pre_event_ready', 'false', 'booking_origin', 'website',
    'event_date', '2031-03-15', 'start_time', '18:00:00', 'bar_package', 'none',
    'ghl_contact_id', NULL, 'ghl_appointment_id', NULL))).*
  FROM bookings b WHERE b.status <> 'cancelled' ORDER BY b.created_at DESC LIMIT 1;

  INSERT INTO bookings
  SELECT (jsonb_populate_record(NULL::bookings, to_jsonb(b) || jsonb_build_object(
    'id', bk2, 'reservation_number', 'ZZTEST-RDY2', 'event_date', '2031-04-01'))).*
  FROM bookings b WHERE b.id = bk;

  INSERT INTO bookings
  SELECT (jsonb_populate_record(NULL::bookings, to_jsonb(b) || jsonb_build_object(
    'id', bx, 'reservation_number', 'ZZTEST-RDYX', 'booking_origin', 'external',
    'event_date', '2031-05-01'))).*
  FROM bookings b WHERE b.id = bk;

  -- T1 no staff, checklist incomplete -------------------------------------------
  r := booking_readiness(bk);
  SELECT string_agg(e->>'code', ',' ORDER BY e->>'code') INTO codes FROM jsonb_array_elements(r->'unmet') e;
  IF (r->>'ready')::boolean OR codes <> 'checklist_incomplete,no_staff' THEN
    RAISE EXCEPTION 'FAIL T1 no staff + checklist incomplete: %', r; END IF;
  log := log || 'T1 ';

  -- T2 checklist complete, still no staff: stays confirmed, gets in_progress job --
  UPDATE bookings SET pre_event_ready = 'true' WHERE id = bk;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  r := booking_readiness(bk);
  IF lc <> 'confirmed' OR (r->'unmet'->0->>'code') <> 'no_staff' THEN
    RAISE EXCEPTION 'FAIL T2 checklist done, no staff: lc=% r=%', lc, r; END IF;
  IF NOT EXISTS (SELECT 1 FROM scheduled_jobs WHERE booking_id = bk AND job_type = 'set_lifecycle_in_progress'
                 AND status = 'pending' AND run_at = timestamptz '2031-03-15 18:00:00 America/New_York') THEN
    RAISE EXCEPTION 'FAIL T2 event-day safety net job missing'; END IF;
  log := log || 'T2 ';

  -- T3 forcing pre_event_ready while unmet is rejected ---------------------------
  raised := false;
  BEGIN
    UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = bk;
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'FAIL T3 gate did not block forced pre_event_ready'; END IF;
  log := log || 'T3 ';

  -- T4 assigned staff with pending response: not ready ---------------------------
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, cleaning_type, response_status)
  VALUES (bk, s1, 'Custodial', 'cleaning', 'regular', 'pending') RETURNING id INTO a1;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  r := booking_readiness(bk);
  IF lc <> 'confirmed' OR (r->'unmet'->0->>'code') <> 'staff_pending' THEN
    RAISE EXCEPTION 'FAIL T4 assignment alone made it ready: lc=% r=%', lc, r; END IF;
  log := log || 'T4 ';

  -- T5 multiple staff, only some accepted: not ready -----------------------------
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, response_status)
  VALUES (bk, s2, 'Production', 'other', 'pending') RETURNING id INTO a2;
  UPDATE booking_staff_assignments SET response_status = 'accepted' WHERE id = a1;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'confirmed' THEN RAISE EXCEPTION 'FAIL T5 partial acceptance promoted: lc=%', lc; END IF;
  log := log || 'T5 ';

  -- T6 acceptance on ANOTHER event does not count for this one --------------------
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, response_status)
  VALUES (bk2, s2, 'Production', 'other', 'accepted');
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'confirmed' THEN RAISE EXCEPTION 'FAIL T6 other-event approval leaked: lc=%', lc; END IF;
  log := log || 'T6 ';

  -- T7 all selected staff accept: the DB promotes on its own (1dfqjx6vh17) and
  --    tells GHL; a later GHL write of the same state is a no-op ----------------
  SELECT count(*) INTO q0 FROM net.http_request_queue WHERE url LIKE '%sync-to-ghl%';
  UPDATE booking_staff_assignments SET response_status = 'accepted' WHERE id = a2;
  SELECT count(*) INTO q1 FROM net.http_request_queue WHERE url LIKE '%sync-to-ghl%';
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'pre_event_ready' THEN
    RAISE EXCEPTION 'FAIL T7a all accepted did not promote: lc=% r=%', lc, booking_readiness(bk); END IF;
  -- T14 the promotion reaches GHL
  IF q1 < q0 + 1 THEN RAISE EXCEPTION 'FAIL T14 promotion did not queue sync-to-ghl (% -> %)', q0, q1; END IF;
  UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = bk;   -- what ghl-update-booking-status does
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'pre_event_ready' THEN RAISE EXCEPTION 'FAIL T7b GHL write of same state broke: lc=%', lc; END IF;
  IF current_setting('oev.lifecycle_writer', true) = 'on' THEN
    RAISE EXCEPTION 'FAIL T7c lifecycle writer flag leaked out of recompute'; END IF;
  log := log || 'T7 T14 ';

  -- T8 new pending staff on a ready booking: demoted ------------------------------
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, response_status)
  VALUES (bk, s1, 'Assistant', 'other', 'pending') RETURNING id INTO a3;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'confirmed' THEN RAISE EXCEPTION 'FAIL T8 new pending staff did not demote: lc=%', lc; END IF;
  IF NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = bk AND event_type = 'lifecycle_readiness_changed'
                 AND metadata->>'to_lifecycle' = 'confirmed') THEN
    RAISE EXCEPTION 'FAIL T8 no audit event for demotion'; END IF;
  log := log || 'T8 ';

  -- T9 explicit rejection blocks; removing that person unblocks -------------------
  UPDATE booking_staff_assignments SET response_status = 'rejected' WHERE id = a3;
  r := booking_readiness(bk);
  IF (r->'unmet'->0->>'code') <> 'staff_rejected' THEN RAISE EXCEPTION 'FAIL T9 rejection not reported: %', r; END IF;
  DELETE FROM booking_staff_assignments WHERE id = a3;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'pre_event_ready' THEN RAISE EXCEPTION 'FAIL T9 removal did not re-promote: lc=%', lc; END IF;
  log := log || 'T9 ';

  -- T10 checklist unchecked -> confirmed; checked again -> pre_event_ready --------
  UPDATE bookings SET pre_event_ready = 'false' WHERE id = bk;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'confirmed' THEN RAISE EXCEPTION 'FAIL T10a incomplete checklist kept ready: lc=%', lc; END IF;
  UPDATE bookings SET pre_event_ready = 'true' WHERE id = bk;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'pre_event_ready' THEN RAISE EXCEPTION 'FAIL T10b complete checklist did not re-promote: lc=%', lc; END IF;
  -- T15 event not started yet (2031) -> GHL in_progress would be deferred
  IF (booking_readiness(bk)->>'event_started')::boolean THEN RAISE EXCEPTION 'FAIL T15 event_started true for 2031'; END IF;
  log := log || 'T10 T15 ';

  -- T11 in_progress through the lifecycle writer still works; assignments are
  --     NOT completed before the event really ends (phase 1B payroll rule) ----
  r := transition_booking(bk, 'in_progress', NULL, 'readiness_harness', 'system');
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'in_progress' THEN RAISE EXCEPTION 'FAIL T11a in_progress blocked: lc=% r=%', lc, r; END IF;
  IF EXISTS (SELECT 1 FROM booking_staff_assignments WHERE booking_id = bk AND status = 'completed') THEN
    RAISE EXCEPTION 'FAIL T11b assignments completed before the 2031 event ended'; END IF;
  PERFORM set_config('oev.lifecycle_writer', '', true);
  log := log || 'T11 ';

  -- T12 external booking: same rule as every booking (1dfqjx6vh17) ---------------
  UPDATE bookings SET pre_event_ready = 'true' WHERE id = bx;
  r := booking_readiness(bx);
  IF (r->>'ready')::boolean OR (r->>'staff_exempt')::boolean OR (r->'unmet'->0->>'code') <> 'no_staff' THEN
    RAISE EXCEPTION 'FAIL T12a external without staff is eligible: %', r; END IF;
  raised := false;
  BEGIN
    UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = bx;
  EXCEPTION WHEN check_violation THEN raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'FAIL T12b external forced to pre_event_ready without staff'; END IF;
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, cleaning_type, response_status)
  VALUES (bx, s1, 'Custodial', 'cleaning', 'regular', 'pending') RETURNING id INTO a3;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bx;
  IF lc <> 'confirmed' THEN RAISE EXCEPTION 'FAIL T12c external moved with pending staff: lc=%', lc; END IF;
  -- T16 office records an acceptance given by phone: audited, promotes ---------
  r := admin_record_staff_response(a3, 'accepted', 'confirmed by phone');
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bx;
  IF NOT (r->>'changed')::boolean OR lc <> 'pre_event_ready' THEN
    RAISE EXCEPTION 'FAIL T16a office acceptance: r=% lc=%', r, lc; END IF;
  IF NOT EXISTS (SELECT 1 FROM booking_events WHERE booking_id = bx AND event_type = 'staff_assignment_accepted'
                 AND channel = 'admin' AND metadata->>'note' = 'confirmed by phone') THEN
    RAISE EXCEPTION 'FAIL T16b office acceptance not audited'; END IF;
  IF (admin_record_staff_response(a3, 'accepted', NULL)->>'changed')::boolean THEN
    RAISE EXCEPTION 'FAIL T16c repeated acceptance changed something'; END IF;
  log := log || 'T12 T16 ';

  -- T17 payroll: no base line for staff who did not accept; not payable -------
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, response_status, status)
  VALUES (bk2, s1, 'Custodial', 'cleaning', 'pending', 'assigned') RETURNING id INTO a2;
  INSERT INTO staff_payroll_items (assignment_id, staff_id, pay_category, pay_type, amount, description)
  VALUES (a2, s1, 'cleaning_base', 'regular', 80, 'T17 base');
  IF EXISTS (SELECT 1 FROM staff_payroll_items WHERE assignment_id = a2) THEN
    RAISE EXCEPTION 'FAIL T17a base pay line created for unaccepted staff'; END IF;
  INSERT INTO staff_payroll_items (assignment_id, staff_id, pay_category, pay_type, amount, description)
  VALUES (a2, s1, 'bonus', 'bonus', 10, 'T17 bonus');
  raised := false;
  BEGIN
    UPDATE staff_payroll_items SET paid_status = 'paid', paid_at = now() WHERE assignment_id = a2;
  EXCEPTION WHEN raise_exception THEN raised := true;
  END;
  IF NOT raised THEN RAISE EXCEPTION 'FAIL T17b unaccepted staff line marked paid'; END IF;
  UPDATE booking_staff_assignments SET response_status = 'accepted' WHERE id = a2;
  UPDATE staff_payroll_items SET paid_status = 'paid', paid_at = now() WHERE assignment_id = a2;
  IF NOT EXISTS (SELECT 1 FROM staff_payroll_items WHERE assignment_id = a2 AND paid_status = 'paid') THEN
    RAISE EXCEPTION 'FAIL T17c accepted staff could not be paid'; END IF;
  -- T17e completed work with no line (skipped while unaccepted): recording the
  --      acceptance rebuilds the pay line
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, cleaning_type, response_status, status)
  VALUES (bk2, s2, 'Custodial', 'cleaning', 'regular', 'pending', 'assigned') RETURNING id INTO a3;
  UPDATE booking_staff_assignments SET status = 'completed', completed_at = now() WHERE id = a3;
  IF EXISTS (SELECT 1 FROM staff_payroll_items WHERE assignment_id = a3) THEN
    RAISE EXCEPTION 'FAIL T17e line created while unaccepted'; END IF;
  PERFORM admin_record_staff_response(a3, 'accepted', 'worked, confirmed by phone');
  IF NOT EXISTS (SELECT 1 FROM staff_payroll_items WHERE assignment_id = a3) THEN
    RAISE EXCEPTION 'FAIL T17e acceptance did not rebuild the pay line'; END IF;
  -- T17d standalone jobs (no booking) keep working without portal acceptance
  INSERT INTO booking_staff_assignments (booking_id, staff_id, assignment_role, assignment_type, cleaning_type, status, scheduled_date)
  VALUES (NULL, s1, 'cleaner', 'cleaning', 'regular', 'completed', '2031-06-01') RETURNING id INTO a2;
  INSERT INTO staff_payroll_items (assignment_id, staff_id, pay_category, pay_type, amount, description)
  VALUES (a2, s1, 'cleaning_base', 'regular', 40, 'T17d standalone');
  UPDATE staff_payroll_items SET paid_status = 'paid', paid_at = now() WHERE assignment_id = a2;
  IF NOT EXISTS (SELECT 1 FROM staff_payroll_items WHERE assignment_id = a2 AND paid_status = 'paid') THEN
    RAISE EXCEPTION 'FAIL T17d standalone job could not be paid'; END IF;
  log := log || 'T17 ';

  -- T13 auto-reject cron is gone ----------------------------------------------------
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-reject-stale-staff-assignments') THEN
    RAISE EXCEPTION 'FAIL T13 auto-reject cron still scheduled'; END IF;
  log := log || 'T13 ';

  RAISE EXCEPTION 'READINESS_SCENARIOS_PASS %', log;
END $$;
