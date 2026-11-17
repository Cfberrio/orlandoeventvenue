-- Phase 2C, E-6 (ClickUp 86e40ach2): pay lines could not be voided or
-- overridden; recalculation rebuilt the computed line from scratch, so any
-- hand edit was lost. The override now lives on the assignment (with who /
-- when / why) and populate_staff_payroll_items honours it on every recalc:
--   override -> one 'base_pay' line with the agreed amount
--   excluded -> no generated line (the assignment is not paid)
-- Bonuses / deductions are manual lines and can be removed with a reason.
-- Paid assignments stay frozen (S-8 rule): change pay with a bonus/deduction.

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS pay_override_mode text,
  ADD COLUMN IF NOT EXISTS pay_override_amount numeric,
  ADD COLUMN IF NOT EXISTS pay_override_reason text,
  ADD COLUMN IF NOT EXISTS pay_override_by uuid,
  ADD COLUMN IF NOT EXISTS pay_override_at timestamptz;

ALTER TABLE public.booking_staff_assignments DROP CONSTRAINT IF EXISTS booking_staff_assignments_pay_override_check;
ALTER TABLE public.booking_staff_assignments ADD CONSTRAINT booking_staff_assignments_pay_override_check CHECK (
  (pay_override_mode IS NULL AND pay_override_amount IS NULL)
  OR (pay_override_mode = 'excluded' AND pay_override_amount IS NULL AND pay_override_reason IS NOT NULL)
  OR (pay_override_mode = 'override' AND pay_override_amount >= 0 AND pay_override_reason IS NOT NULL)
);

CREATE OR REPLACE FUNCTION public.populate_staff_payroll_items(p_assignment_id uuid, p_is_historical boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment RECORD;
  v_staff RECORD;
  v_booking RECORD;
  v_hourly_rate DECIMAL(10,2);
  v_hours DECIMAL(5,2);
  v_base_pay DECIMAL(10,2);
  v_flat_rate DECIMAL(10,2);
BEGIN
  IF pg_trigger_depth() = 0 THEN
    PERFORM public._assert_admin_or_service();
  END IF;
  SELECT * INTO v_assignment
  FROM public.booking_staff_assignments
  WHERE id = p_assignment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found: %', p_assignment_id;
  END IF;

  SELECT * INTO v_staff
  FROM public.staff_members
  WHERE id = v_assignment.staff_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found: %', v_assignment.staff_id;
  END IF;

  IF v_staff.payroll_type = 'none' AND v_assignment.pay_override_mode IS NULL THEN
    RAISE NOTICE 'Staff % has payroll_type=none, skipping payroll calculation', v_staff.full_name;
    RETURN;
  END IF;

  IF v_assignment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_assignment.booking_id;
  END IF;

  -- Recalculation keeps manual lines (bonus/deduction) and never rewrites a
  -- paid assignment (ClickUp 86e40ach2, S-8).
  IF EXISTS (
    SELECT 1 FROM public.staff_payroll_items
    WHERE assignment_id = p_assignment_id
      AND paid_status = 'paid'
      AND pay_category NOT IN ('bonus', 'deduction')
  ) THEN
    IF pg_trigger_depth() = 0 THEN
      RAISE EXCEPTION 'Payroll for assignment % is already paid; add a bonus or deduction instead of recalculating', p_assignment_id
        USING ERRCODE = 'P0001';
    END IF;
    RAISE NOTICE 'Payroll for assignment % already paid; not recalculated', p_assignment_id;
    RETURN;
  END IF;

  DELETE FROM public.staff_payroll_items
  WHERE assignment_id = p_assignment_id
    AND pay_category NOT IN ('bonus', 'deduction');

  -- E-6: an office override replaces the calculation.
  IF v_assignment.pay_override_mode = 'excluded' THEN
    RETURN;
  END IF;
  IF v_assignment.pay_override_mode = 'override' THEN
    IF v_assignment.pay_override_amount > 0 THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type, amount, description, metadata, is_historical
      ) VALUES (
        p_assignment_id, v_assignment.staff_id, 'base_pay', 'fixed', v_assignment.pay_override_amount,
        'Agreed amount: ' || v_assignment.pay_override_reason,
        jsonb_build_object('override', true, 'override_by', v_assignment.pay_override_by, 'override_at', v_assignment.pay_override_at),
        p_is_historical
      );
    END IF;
    RETURN;
  END IF;

  IF v_staff.payroll_type = 'hourly' THEN
    v_hourly_rate := COALESCE(v_staff.hourly_rate, 50.00);
    v_hours := COALESCE(v_assignment.hours_worked, 0);

    -- M-2 (86e40ach2): the assignment's own window first, as on the Staff tab.
    IF v_hours = 0 AND v_assignment.scheduled_start_time IS NOT NULL AND v_assignment.scheduled_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_assignment.scheduled_end_time - v_assignment.scheduled_start_time)) / 3600.0;
      IF v_hours < 0 THEN v_hours := v_hours + 24; END IF;
    END IF;

    IF v_hours = 0 AND v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_booking.package_end_time - v_booking.package_start_time)) / 3600.0;
      IF v_hours < 0 THEN v_hours := v_hours + 24; END IF;
    END IF;

    IF v_hours > 0 THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type,
        amount, hours, rate, description, is_historical
      )
      VALUES (
        p_assignment_id,
        v_assignment.staff_id,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'hourly_bar_vendor' ELSE 'hourly_production' END,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'bar_vendor' ELSE 'production' END,
        v_hours * v_hourly_rate,
        v_hours,
        v_hourly_rate,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'Bar Vendor Services' ELSE 'Production Services' END,
        p_is_historical
      );
    END IF;

  ELSIF v_staff.payroll_type = 'per_assignment' THEN
    IF v_assignment.assignment_role = 'Bar Vendor' THEN
      v_flat_rate := COALESCE(v_staff.hourly_rate, 0);
      IF v_flat_rate > 0 THEN
        INSERT INTO public.staff_payroll_items (
          assignment_id, staff_id, pay_category, pay_type,
          amount, description, is_historical
        )
        VALUES (
          p_assignment_id,
          v_assignment.staff_id,
          'bar_vendor_flat',
          'fixed',
          v_flat_rate,
          'Bar Vendor Assignment – Flat Rate ($' || v_flat_rate::text || ')',
          p_is_historical
        );
      END IF;
    ELSIF v_assignment.assignment_role = 'Assistant' THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type,
        amount, description, is_historical
      )
      VALUES (
        p_assignment_id,
        v_assignment.staff_id,
        'base_pay',
        'fixed',
        80.00,
        'Assistant Assignment – Flat Rate ($80)',
        p_is_historical
      );
    ELSIF v_assignment.cleaning_type IS NOT NULL THEN
      v_base_pay := CASE v_assignment.cleaning_type
        WHEN 'touch_up' THEN 40.00
        WHEN 'regular' THEN 80.00
        WHEN 'deep' THEN 150.00
        ELSE 0
      END;

      IF v_base_pay > 0 THEN
        INSERT INTO public.staff_payroll_items (
          assignment_id, staff_id, pay_category, pay_type,
          amount, description, is_historical
        )
        VALUES (
          p_assignment_id,
          v_assignment.staff_id,
          'cleaning_base',
          v_assignment.cleaning_type,
          v_base_pay,
          CASE v_assignment.cleaning_type
            WHEN 'touch_up' THEN 'Touch-Up Cleaning'
            WHEN 'regular' THEN 'Regular Cleaning'
            WHEN 'deep' THEN 'Deep Cleaning'
          END,
          p_is_historical
        );
      END IF;

      IF COALESCE(v_assignment.celebration_surcharge, 0) > 0 THEN
        INSERT INTO public.staff_payroll_items (
          assignment_id, staff_id, pay_category, pay_type,
          amount, description, is_historical
        )
        VALUES (
          p_assignment_id,
          v_assignment.staff_id,
          'cleaning_surcharge',
          'celebration',
          v_assignment.celebration_surcharge,
          'Celebration Surcharge',
          p_is_historical
        );
      END IF;
    END IF;
  END IF;

  RAISE NOTICE 'Payroll items populated for assignment % (staff: %)', p_assignment_id, v_staff.full_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_assignment_pay(
  p_assignment_id uuid, p_mode text, p_amount numeric DEFAULT NULL, p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_a public.booking_staff_assignments%ROWTYPE;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_total numeric;
BEGIN
  PERFORM public._assert_admin_or_service();
  IF p_mode NOT IN ('computed', 'override', 'excluded') THEN
    RAISE EXCEPTION 'mode must be computed, override or excluded' USING ERRCODE = '22023';
  END IF;
  IF p_mode <> 'computed' AND v_reason IS NULL THEN
    RAISE EXCEPTION 'say why the pay is changed' USING ERRCODE = '22023';
  END IF;
  IF p_mode = 'override' AND (p_amount IS NULL OR p_amount < 0 OR p_amount > 10000) THEN
    RAISE EXCEPTION 'amount must be between 0 and 10,000' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM public.booking_staff_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_payroll_items
    WHERE assignment_id = p_assignment_id AND paid_status = 'paid' AND pay_category NOT IN ('bonus', 'deduction')
  ) THEN
    RAISE EXCEPTION 'this assignment is already paid; add a bonus or deduction instead' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.booking_staff_assignments SET
    pay_override_mode = CASE WHEN p_mode = 'computed' THEN NULL ELSE p_mode END,
    pay_override_amount = CASE WHEN p_mode = 'override' THEN round(p_amount, 2) END,
    pay_override_reason = CASE WHEN p_mode = 'computed' THEN NULL ELSE v_reason END,
    pay_override_by = CASE WHEN p_mode = 'computed' THEN NULL ELSE auth.uid() END,
    pay_override_at = CASE WHEN p_mode = 'computed' THEN NULL ELSE now() END,
    updated_at = now()
  WHERE id = p_assignment_id;

  -- Lines exist only for completed work; a pending assignment gets them at completion.
  IF v_a.status = 'completed' THEN
    PERFORM public.populate_staff_payroll_items(p_assignment_id, false);
  END IF;

  SELECT COALESCE(sum(amount), 0) INTO v_total FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id;

  IF v_a.booking_id IS NOT NULL THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (v_a.booking_id, 'assignment_pay_changed', 'admin', jsonb_build_object(
      'assignment_id', p_assignment_id, 'mode', p_mode, 'amount', p_amount, 'reason', v_reason,
      'total_after', v_total, 'recorded_by', auth.uid()));
  END IF;

  RETURN jsonb_build_object('assignment_id', p_assignment_id, 'mode', p_mode, 'total', v_total);
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_payroll_adjustment(p_item_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_item public.staff_payroll_items%ROWTYPE;
  v_booking uuid;
BEGIN
  PERFORM public._assert_admin_or_service();
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'say why the line is removed' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.staff_payroll_items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll line not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_item.pay_category NOT IN ('bonus', 'deduction') THEN
    RAISE EXCEPTION 'only bonuses and deductions can be removed; use Override / No pay for the calculated line' USING ERRCODE = 'P0001';
  END IF;
  IF v_item.paid_status = 'paid' THEN
    RAISE EXCEPTION 'this line is already paid; add an opposite adjustment instead' USING ERRCODE = 'P0001';
  END IF;
  DELETE FROM public.staff_payroll_items WHERE id = p_item_id;
  SELECT booking_id INTO v_booking FROM public.booking_staff_assignments WHERE id = v_item.assignment_id;
  IF v_booking IS NOT NULL THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (v_booking, 'payroll_adjustment_removed', 'admin', jsonb_build_object(
      'item_id', p_item_id, 'assignment_id', v_item.assignment_id, 'category', v_item.pay_category,
      'amount', v_item.amount, 'description', v_item.description, 'reason', btrim(p_reason), 'recorded_by', auth.uid()));
  END IF;
  RETURN jsonb_build_object('removed', p_item_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_set_assignment_pay(uuid, text, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_remove_payroll_adjustment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_assignment_pay(uuid, text, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remove_payroll_adjustment(uuid, text) TO authenticated, service_role;
