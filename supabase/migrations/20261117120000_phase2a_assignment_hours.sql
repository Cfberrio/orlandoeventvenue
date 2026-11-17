-- Phase 2A, E-7 (ClickUp 86e40ach2): hourly staff closed out with no hours.
--
-- Assignments are completed by the database when the event moves to
-- post_event, so completion cannot be blocked. When an hourly assignment has
-- no hours_worked, no scheduled window and the booking has no package window,
-- populate_staff_payroll_items writes nothing and the person is paid $0 with
-- no warning (WRSPVF, X7J8MN, V8LGPT, 9MUYQS). The office now sees those
-- assignments on Payroll and enters the hours, which recalculates the line.

CREATE OR REPLACE FUNCTION public.admin_assignments_missing_hours()
RETURNS TABLE (
  assignment_id uuid,
  booking_id uuid,
  reservation_number text,
  event_date date,
  staff_id uuid,
  staff_name text,
  assignment_role text,
  hourly_rate numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY
  SELECT a.id, b.id, b.reservation_number, COALESCE(a.scheduled_date, b.event_date), s.id, s.full_name,
         a.assignment_role, COALESCE(s.hourly_rate, 50.00)
  FROM public.booking_staff_assignments a
  JOIN public.staff_members s ON s.id = a.staff_id
  LEFT JOIN public.bookings b ON b.id = a.booking_id
  WHERE a.status = 'completed'
    AND s.payroll_type = 'hourly'
    AND COALESCE(a.hours_worked, 0) = 0
    AND (a.scheduled_start_time IS NULL OR a.scheduled_end_time IS NULL)
    AND (b.id IS NULL OR b.package_start_time IS NULL OR b.package_end_time IS NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_payroll_items p
      WHERE p.assignment_id = a.id AND p.pay_category NOT IN ('bonus', 'deduction')
    )
  ORDER BY COALESCE(a.scheduled_date, b.event_date) DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_assignments_missing_hours() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_assignments_missing_hours() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_set_assignment_hours(p_assignment_id uuid, p_hours numeric, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.booking_staff_assignments%ROWTYPE;
  v_type text;
  v_amount numeric;
BEGIN
  PERFORM public._assert_admin_or_service();
  IF p_hours IS NULL OR p_hours <= 0 OR p_hours > 24 THEN
    RAISE EXCEPTION 'hours must be between 0 and 24' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.booking_staff_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'P0002';
  END IF;
  SELECT payroll_type INTO v_type FROM public.staff_members WHERE id = v_a.staff_id;
  IF v_type IS DISTINCT FROM 'hourly' THEN
    RAISE EXCEPTION 'this staff member is not paid hourly; set the pay type on Staff first' USING ERRCODE = 'P0001';
  END IF;
  IF v_a.status <> 'completed' THEN
    RAISE EXCEPTION 'hours can be entered after the assignment is completed' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.booking_staff_assignments
  SET hours_worked = round(p_hours, 2), updated_at = now()
  WHERE id = p_assignment_id;

  -- Raises if this assignment's payroll is already paid (S-8 rule).
  PERFORM public.populate_staff_payroll_items(p_assignment_id, false);

  SELECT COALESCE(sum(amount), 0) INTO v_amount
  FROM public.staff_payroll_items
  WHERE assignment_id = p_assignment_id AND pay_category NOT IN ('bonus', 'deduction');

  IF v_a.booking_id IS NOT NULL THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (v_a.booking_id, 'assignment_hours_entered', 'admin', jsonb_build_object(
      'assignment_id', p_assignment_id, 'hours', round(p_hours, 2), 'amount', v_amount,
      'note', NULLIF(btrim(COALESCE(p_note, '')), ''), 'recorded_by', auth.uid()));
  END IF;

  RETURN jsonb_build_object('assignment_id', p_assignment_id, 'hours', round(p_hours, 2), 'amount', v_amount);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_assignment_hours(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_assignment_hours(uuid, numeric, text) TO authenticated, service_role;

-- E-5 guard (Codex review): payroll has per-event rules only for Bar Vendor,
-- Assistant and Custodial; hourly pay needs a rate (the $50 fallback hid it).
ALTER TABLE public.staff_members DROP CONSTRAINT IF EXISTS staff_members_pay_config_check;
ALTER TABLE public.staff_members ADD CONSTRAINT staff_members_pay_config_check CHECK (
  (payroll_type IS DISTINCT FROM 'per_assignment' OR role IN ('Bar Vendor', 'Assistant', 'Custodial'))
  AND (payroll_type IS DISTINCT FROM 'hourly' OR COALESCE(hourly_rate, 0) > 0)
  AND (payroll_type IS DISTINCT FROM 'per_assignment' OR role <> 'Bar Vendor' OR COALESCE(hourly_rate, 0) > 0)
) NOT VALID;
ALTER TABLE public.staff_members VALIDATE CONSTRAINT staff_members_pay_config_check;
