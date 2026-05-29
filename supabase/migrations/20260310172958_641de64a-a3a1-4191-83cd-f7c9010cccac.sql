
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
BEGIN
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
  
  IF v_staff.payroll_type = 'none' THEN
    RAISE NOTICE 'Staff % has payroll_type=none, skipping payroll calculation', v_staff.full_name;
    RETURN;
  END IF;
  
  IF v_assignment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_assignment.booking_id;
  END IF;
  
  DELETE FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id;
  
  IF v_staff.payroll_type = 'hourly' THEN
    v_hourly_rate := COALESCE(v_staff.hourly_rate, 50.00);
    v_hours := COALESCE(v_assignment.hours_worked, 0);
    
    IF v_hours = 0 AND v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_booking.package_end_time - v_booking.package_start_time)) / 3600.0;
    END IF;
    
    IF v_hours > 0 THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type, 
        amount, hours, rate, description, is_historical
      )
      VALUES (
        p_assignment_id,
        v_assignment.staff_id,
        'hourly_production',
        'production',
        v_hours * v_hourly_rate,
        v_hours,
        v_hourly_rate,
        'Production Services',
        p_is_historical
      );
    END IF;
    
  ELSIF v_staff.payroll_type = 'per_assignment' THEN
    -- ASSISTANT: Fixed $80 flat rate (check BEFORE cleaning_type)
    IF v_assignment.assignment_role = 'Assistant' THEN
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
    -- CUSTODIAL: Cleaning type-based pay
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
