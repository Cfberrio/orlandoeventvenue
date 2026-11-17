-- Phase 2C payroll fixes (ClickUp 86e40ach2, Codex review of E-6).
-- Forward migration: 20261117150000 is already applied.
--
-- 1. Override columns can only change through admin_set_assignment_pay
--    (transaction flag oev.pay_override_writer), whatever table policy a role
--    has; the amount is capped in the table too.
-- 2. populate_staff_payroll_items locks the assignment and its lines before
--    checking paid state, and never deletes a paid line, so two recalcs cannot
--    duplicate lines and a concurrent mark-paid cannot be erased.

ALTER TABLE public.booking_staff_assignments DROP CONSTRAINT IF EXISTS booking_staff_assignments_pay_override_amount_cap;
ALTER TABLE public.booking_staff_assignments ADD CONSTRAINT booking_staff_assignments_pay_override_amount_cap
  CHECK (pay_override_amount IS NULL OR pay_override_amount <= 10000);

CREATE OR REPLACE FUNCTION public.trg_guard_pay_override()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.pay_override_mode, NEW.pay_override_amount, NEW.pay_override_reason, NEW.pay_override_by, NEW.pay_override_at)
     IS DISTINCT FROM (OLD.pay_override_mode, OLD.pay_override_amount, OLD.pay_override_reason, OLD.pay_override_by, OLD.pay_override_at)
     AND COALESCE(current_setting('oev.pay_override_writer', true), '') <> 'on' THEN
    RAISE EXCEPTION 'pay overrides change only through admin_set_assignment_pay' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_pay_override ON public.booking_staff_assignments;
CREATE TRIGGER trg_guard_pay_override
  BEFORE UPDATE ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_guard_pay_override();

DO $patch$
DECLARE
  v_def text := pg_get_functiondef('public.admin_set_assignment_pay(uuid, text, numeric, text)'::regprocedure);
  v_old text := E'  UPDATE public.booking_staff_assignments SET\n    pay_override_mode =';
BEGIN
  IF position('oev.pay_override_writer' IN v_def) = 0 THEN
    IF position(v_old IN v_def) = 0 THEN
      RAISE EXCEPTION 'admin_set_assignment_pay changed; add the writer flag by hand';
    END IF;
    EXECUTE replace(v_def, v_old, E'  PERFORM set_config(''oev.pay_override_writer'', ''on'', true);\n' || v_old);
  END IF;
END
$patch$;

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
  -- Serialize recalculations of the same assignment (Codex review).
  SELECT * INTO v_assignment
  FROM public.booking_staff_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;

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

  -- Lock this assignment's lines before the paid check, so a concurrent
  -- mark-paid either finishes first (and is seen) or waits for this run.
  PERFORM 1 FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id FOR UPDATE;

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
    AND pay_category NOT IN ('bonus', 'deduction')
    AND paid_status IS DISTINCT FROM 'paid';

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
