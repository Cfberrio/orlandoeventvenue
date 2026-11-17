-- Phase 2C, E-19 (ClickUp 86e40ach2): bar vendor assignment.
-- BarServiceCard looked up the active bar assignment ignoring errors (a failed
-- lookup inserted a second assignment) and then updated the assignment and
-- the booking in two separate writes. One function now does both under a
-- booking row lock, and the database allows one active bar assignment per
-- booking (0 duplicates today).

CREATE UNIQUE INDEX IF NOT EXISTS booking_staff_assignments_one_bar_uidx
  ON public.booking_staff_assignments (booking_id)
  WHERE assignment_type = 'bar_service' AND status <> 'cancelled' AND booking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.admin_assign_bar_vendor(p_booking_id uuid, p_vendor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_vendor public.staff_members%ROWTYPE;
  v_a public.booking_staff_assignments%ROWTYPE;
  v_changed boolean;
  v_due timestamptz := now() + interval '24 hours';
BEGIN
  PERFORM public._assert_admin_or_service();
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF COALESCE(v_b.bar_package, 'none') = 'none' THEN
    RAISE EXCEPTION 'this booking has no bar service' USING ERRCODE = 'P0001';
  END IF;
  IF v_b.status = 'cancelled'::booking_status OR v_b.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is cancelled' USING ERRCODE = 'P0001';
  END IF;
  SELECT * INTO v_vendor FROM public.staff_members WHERE id = p_vendor_id;
  IF NOT FOUND OR NOT v_vendor.is_active THEN
    RAISE EXCEPTION 'vendor not found or inactive' USING ERRCODE = 'P0002';
  END IF;

  v_changed := v_b.bar_vendor_id IS DISTINCT FROM p_vendor_id;

  SELECT * INTO v_a FROM public.booking_staff_assignments
  WHERE booking_id = p_booking_id AND assignment_type = 'bar_service' AND status <> 'cancelled'
  FOR UPDATE;

  IF FOUND THEN
    IF v_a.status = 'completed' AND v_changed THEN
      RAISE EXCEPTION 'the bar assignment is already completed; it cannot move to another vendor' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.booking_staff_assignments SET
      staff_id = p_vendor_id,
      assignment_role = 'Bar Vendor',
      customer_contact_required = true,
      customer_contacted = CASE WHEN v_changed THEN false ELSE customer_contacted END,
      customer_contacted_at = CASE WHEN v_changed THEN NULL ELSE customer_contacted_at END,
      customer_contact_due_at = CASE WHEN v_changed THEN v_due ELSE customer_contact_due_at END,
      response_status = CASE WHEN v_changed THEN 'pending' ELSE response_status END,
      response_at = CASE WHEN v_changed THEN NULL ELSE response_at END,
      updated_at = now()
    WHERE id = v_a.id;
  ELSE
    INSERT INTO public.booking_staff_assignments (
      booking_id, staff_id, assignment_role, assignment_type, customer_contact_required,
      customer_contacted, customer_contact_due_at, status
    ) VALUES (
      p_booking_id, p_vendor_id, 'Bar Vendor', 'bar_service', true, false, v_due, 'assigned'
    ) RETURNING * INTO v_a;
    v_changed := true;
  END IF;

  UPDATE public.bookings SET
    bar_vendor_id = p_vendor_id,
    bar_vendor_assignment_id = v_a.id,
    bar_vendor_assigned_at = CASE WHEN v_changed OR bar_vendor_assigned_at IS NULL THEN now() ELSE bar_vendor_assigned_at END,
    bar_customer_contacted = CASE WHEN v_changed THEN false ELSE bar_customer_contacted END,
    bar_customer_contacted_at = CASE WHEN v_changed THEN NULL ELSE bar_customer_contacted_at END,
    bar_customer_contacted_by = CASE WHEN v_changed THEN NULL ELSE bar_customer_contacted_by END,
    updated_at = now()
  WHERE id = p_booking_id;

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, 'bar_vendor_assigned', 'admin', jsonb_build_object(
    'assignment_id', v_a.id, 'vendor_id', p_vendor_id, 'vendor_name', v_vendor.full_name,
    'previous_vendor_id', v_b.bar_vendor_id, 'vendor_changed', v_changed, 'recorded_by', auth.uid()));

  RETURN jsonb_build_object('assignment_id', v_a.id, 'vendor_changed', v_changed);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_assign_bar_vendor(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assign_bar_vendor(uuid, uuid) TO authenticated, service_role;
