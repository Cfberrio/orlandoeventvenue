-- Phase 2D, E-4 (ClickUp 86e40ach2): one way to change lifecycle_status.
--
-- The admin dropdown wrote any lifecycle to any other with no record, and
-- closed_review_complete was only reachable through a checkbox writing the
-- column directly. Writers now go through server functions that mark the
-- write with the transaction-local flag oev.lifecycle_writer; the guard
-- trigger in 20261117170100 (applied after the edge functions and frontend
-- that use these functions are live) rejects any other lifecycle write.
--
--   transition_booking        service: crons, close event (already in use)
--   admin_transition_booking  admin dropdown / review checkbox; allowed moves,
--                             or a forced correction with a reason
--   ghl_apply_booking_status  ghl-update-booking-status (compare-and-set)
--   submit_guest_report       in_progress -> post_event after the guest report
-- Cancels keep their own path (cancel-booking + trg_booking_cancel_normalize);
-- writes made by other triggers (readiness recompute) are nested and allowed.

DO $patch$
DECLARE
  v_def text;
  v_old text;
BEGIN
  v_def := pg_get_functiondef('public.transition_booking(uuid, text, text[], text, text)'::regprocedure);
  IF position('oev.lifecycle_writer' IN v_def) = 0 THEN
    v_old := E'  UPDATE public.bookings\n  SET lifecycle_status = p_to, updated_at = now()';
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'transition_booking changed; add the lifecycle writer flag by hand';
    END IF;
    EXECUTE replace(v_def, v_old, E'  PERFORM set_config(''oev.lifecycle_writer'', ''on'', true);\n' || v_old);
  END IF;

  v_def := pg_get_functiondef('public.submit_guest_report(uuid, text, jsonb, jsonb)'::regprocedure);
  IF position('oev.lifecycle_writer' IN v_def) = 0 THEN
    v_old := E'  UPDATE public.bookings\n  SET lifecycle_status = ''post_event'', updated_at = now()';
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'submit_guest_report changed; add the lifecycle writer flag by hand';
    END IF;
    EXECUTE replace(v_def, v_old, E'  PERFORM set_config(''oev.lifecycle_writer'', ''on'', true);\n' || v_old);
  END IF;
END
$patch$;

CREATE OR REPLACE FUNCTION public.admin_transition_booking(
  p_booking_id uuid, p_to text, p_reason text DEFAULT NULL, p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_allowed boolean;
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

  PERFORM set_config('oev.lifecycle_writer', 'on', true);
  -- enforce_pre_event_ready_gate still applies (23514 when not ready).
  UPDATE public.bookings SET lifecycle_status = p_to, updated_at = now() WHERE id = p_booking_id;

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, 'lifecycle_transition', 'admin', jsonb_build_object(
    'from', v_b.lifecycle_status, 'to', p_to, 'reason', v_reason,
    'forced', NOT v_allowed, 'actor', auth.uid()));

  RETURN jsonb_build_object('ok', true, 'changed', true, 'from', v_b.lifecycle_status, 'lifecycle_status', p_to, 'forced', NOT v_allowed);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_transition_booking(uuid, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_transition_booking(uuid, text, text, boolean) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ghl_apply_booking_status(
  p_booking_id uuid, p_from_status text, p_from_lifecycle text, p_status text, p_lifecycle text
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
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'booking_not_found');
  END IF;
  -- Compare-and-set on both fields the caller decided from.
  IF v_b.status::text IS DISTINCT FROM p_from_status OR v_b.lifecycle_status IS DISTINCT FROM p_from_lifecycle THEN
    RETURN jsonb_build_object('applied', false, 'reason', 'stale_state');
  END IF;
  IF p_lifecycle IS NOT NULL AND p_lifecycle IS DISTINCT FROM v_b.lifecycle_status THEN
    -- A GHL cancel is applied here (trg_booking_cancel_normalize + cascade do
    -- the cleanup; the edge function then calls cancel-booking for Stripe).
    IF p_lifecycle = 'cancelled' THEN
      IF COALESCE(v_b.lifecycle_status, 'pending') NOT IN ('pending', 'confirmed', 'pre_event_ready', 'in_progress', 'post_event') THEN
        RETURN jsonb_build_object('applied', false, 'reason', 'transition_not_allowed');
      END IF;
    ELSIF NOT public._lifecycle_transition_allowed(COALESCE(v_b.lifecycle_status, 'pending'), p_lifecycle) THEN
      RETURN jsonb_build_object('applied', false, 'reason', 'transition_not_allowed');
    END IF;
    PERFORM set_config('oev.lifecycle_writer', 'on', true);
  END IF;

  UPDATE public.bookings SET
    status = COALESCE(p_status::booking_status, status),
    lifecycle_status = COALESCE(p_lifecycle, lifecycle_status),
    updated_at = now()
  WHERE id = p_booking_id;

  IF p_lifecycle IS NOT NULL AND p_lifecycle IS DISTINCT FROM v_b.lifecycle_status THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (p_booking_id, 'lifecycle_transition', 'ghl', jsonb_build_object(
      'from', v_b.lifecycle_status, 'to', p_lifecycle, 'reason', 'ghl_workflow'));
  END IF;
  RETURN jsonb_build_object('applied', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.ghl_apply_booking_status(uuid, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ghl_apply_booking_status(uuid, text, text, text, text) TO service_role;
