-- Phase 2E fixes (ClickUp 86e40ach2, Codex review).
-- 1. Forward copy of the ghl_apply_booking_status cancel acceptance: the
--    change was edited into 20261117170000 after it was applied; production was
--    patched in place on 2026-11-17, this file makes any other database match.
-- 2. _booking_slot_conflict also refuses blackout dates.

DO $p$
DECLARE d text; a text; b text;
BEGIN
  d := pg_get_functiondef('public.ghl_apply_booking_status(uuid, text, text, text, text)'::regprocedure);
  a := E'    IF p_lifecycle = ''cancelled'' THEN\n      RETURN jsonb_build_object(''applied'', false, ''reason'', ''cancel_through_cancel_booking'');\n    END IF;\n    IF NOT public._lifecycle_transition_allowed(COALESCE(v_b.lifecycle_status, ''pending''), p_lifecycle) THEN';
  b := E'    IF p_lifecycle = ''cancelled'' THEN\n      IF COALESCE(v_b.lifecycle_status, ''pending'') NOT IN (''pending'', ''confirmed'', ''pre_event_ready'', ''in_progress'', ''post_event'') THEN\n        RETURN jsonb_build_object(''applied'', false, ''reason'', ''transition_not_allowed'');\n      END IF;\n    ELSIF NOT public._lifecycle_transition_allowed(COALESCE(v_b.lifecycle_status, ''pending''), p_lifecycle) THEN';
  IF position(a IN d) > 0 THEN
    EXECUTE replace(d, a, b);
  ELSIF position('ELSIF NOT public._lifecycle_transition_allowed' IN d) = 0 THEN
    RAISE EXCEPTION 'ghl_apply_booking_status has an unexpected body; patch by hand';
  END IF;

  d := pg_get_functiondef('public._booking_slot_conflict(date, date, text, time, time, uuid)'::regprocedure);
  IF position('blackout_dates' IN d) = 0 THEN
    a := E'    v_d := v_d + 1;\n  END LOOP;';
    IF position(a IN d) = 0 THEN RAISE EXCEPTION '_booking_slot_conflict changed; patch by hand'; END IF;
    EXECUTE replace(d, a, E'    IF EXISTS (SELECT 1 FROM public.blackout_dates bd WHERE v_d BETWEEN bd.start_date AND bd.end_date) THEN\n      RETURN format(''%s is a blackout date'', to_char(v_d, ''MM/DD/YYYY''));\n    END IF;\n' || a);
  END IF;
END $p$;
