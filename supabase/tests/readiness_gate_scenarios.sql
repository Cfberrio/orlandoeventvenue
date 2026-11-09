-- =============================================================================
-- Regression scenarios for the pre-event readiness gate (ClickUp 86e3zjfq6)
-- Migration under test: supabase/migrations/20261109170000_booking_readiness_gate.sql
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

  -- T7 all selected staff accept: eligible; the DB does NOT promote on its own;
  --    the GHL workflow's write (simulated) now passes the gate --------------------
  SELECT count(*) INTO q0 FROM net.http_request_queue WHERE url LIKE '%sync-to-ghl%';
  UPDATE booking_staff_assignments SET response_status = 'accepted' WHERE id = a2;
  SELECT count(*) INTO q1 FROM net.http_request_queue WHERE url LIKE '%sync-to-ghl%';
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'confirmed' OR NOT (booking_readiness(bk)->>'ready')::boolean THEN
    RAISE EXCEPTION 'FAIL T7a all accepted: lc=% (want confirmed, eligible) r=%', lc, booking_readiness(bk); END IF;
  -- T14 a staff response reaches GHL (so the workflow can promote)
  IF q1 <> q0 + 1 THEN RAISE EXCEPTION 'FAIL T14 staff response did not queue sync-to-ghl (% -> %)', q0, q1; END IF;
  UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = bk;   -- what ghl-update-booking-status does
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'pre_event_ready' THEN RAISE EXCEPTION 'FAIL T7b GHL promotion blocked when eligible: lc=%', lc; END IF;
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
  IF NOT (booking_readiness(bk)->>'ready')::boolean THEN RAISE EXCEPTION 'FAIL T9 removal did not restore eligibility'; END IF;
  UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = bk;   -- GHL re-promotes
  log := log || 'T9 ';

  -- T10 checklist unchecked -> confirmed; checked again -> pre_event_ready --------
  UPDATE bookings SET pre_event_ready = 'false' WHERE id = bk;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'confirmed' THEN RAISE EXCEPTION 'FAIL T10a incomplete checklist kept ready: lc=%', lc; END IF;
  UPDATE bookings SET pre_event_ready = 'true' WHERE id = bk;
  IF NOT (booking_readiness(bk)->>'ready')::boolean THEN RAISE EXCEPTION 'FAIL T10b complete checklist not eligible'; END IF;
  UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = bk;   -- GHL re-promotes
  -- T15 event not started yet (2031) -> GHL in_progress would be deferred
  IF (booking_readiness(bk)->>'event_started')::boolean THEN RAISE EXCEPTION 'FAIL T15 event_started true for 2031'; END IF;
  log := log || 'T10 T15 ';

  -- T11 in_progress transition still works and still completes assignments --------
  UPDATE bookings SET lifecycle_status = 'in_progress' WHERE id = bk;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bk;
  IF lc <> 'in_progress' THEN RAISE EXCEPTION 'FAIL T11 in_progress blocked: lc=%', lc; END IF;
  IF EXISTS (SELECT 1 FROM booking_staff_assignments WHERE booking_id = bk AND status <> 'completed') THEN
    RAISE EXCEPTION 'FAIL T11 auto-complete on in_progress broke'; END IF;
  log := log || 'T11 ';

  -- T12 external booking: staff-exempt, checklist still required -------------------
  r := booking_readiness(bx);
  IF (r->>'ready')::boolean OR NOT (r->>'staff_exempt')::boolean THEN RAISE EXCEPTION 'FAIL T12a external: %', r; END IF;
  UPDATE bookings SET pre_event_ready = 'true' WHERE id = bx;
  IF NOT (booking_readiness(bx)->>'ready')::boolean THEN RAISE EXCEPTION 'FAIL T12b external not eligible'; END IF;
  UPDATE bookings SET lifecycle_status = 'pre_event_ready' WHERE id = bx;
  SELECT lifecycle_status INTO lc FROM bookings WHERE id = bx;
  IF lc <> 'pre_event_ready' THEN RAISE EXCEPTION 'FAIL T12c external promotion blocked: lc=%', lc; END IF;
  log := log || 'T12 ';

  -- T13 auto-reject cron is gone ----------------------------------------------------
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-reject-stale-staff-assignments') THEN
    RAISE EXCEPTION 'FAIL T13 auto-reject cron still scheduled'; END IF;
  log := log || 'T13 ';

  RAISE EXCEPTION 'READINESS_SCENARIOS_PASS %', log;
END $$;
