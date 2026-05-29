
-- ============================================================
-- Migration: Add Payroll System
-- Description: Complete payroll tracking for staff assignments
-- Safety: Non-breaking, all existing data preserved
-- ============================================================

-- 1. Modify staff_members: Add payroll fields
ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS payroll_type text NOT NULL DEFAULT 'hourly',
  ADD COLUMN IF NOT EXISTS hourly_rate numeric NOT NULL DEFAULT 0;

-- 2. Modify booking_staff_assignments: Make booking_id nullable + add payroll fields
ALTER TABLE public.booking_staff_assignments
  ALTER COLUMN booking_id DROP NOT NULL;

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS hours_worked numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS hourly_rate numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_pay numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS pay_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS completed_at timestamptz DEFAULT NULL;

-- 3. Create staff_payroll_items table
CREATE TABLE IF NOT EXISTS public.staff_payroll_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  staff_id uuid NOT NULL REFERENCES public.staff_members(id),
  assignment_id uuid REFERENCES public.booking_staff_assignments(id),
  booking_id uuid REFERENCES public.bookings(id),
  event_date date,
  hours_worked numeric NOT NULL DEFAULT 0,
  hourly_rate numeric NOT NULL DEFAULT 0,
  total_pay numeric NOT NULL DEFAULT 0,
  item_type text NOT NULL DEFAULT 'event_work',
  description text,
  pay_status text NOT NULL DEFAULT 'pending',
  pay_period_start date,
  pay_period_end date,
  paid_at timestamptz,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on staff_payroll_items
ALTER TABLE public.staff_payroll_items ENABLE ROW LEVEL SECURITY;

-- RLS policies for staff_payroll_items
CREATE POLICY "Admin can manage payroll items"
  ON public.staff_payroll_items FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admin and staff can view payroll items"
  ON public.staff_payroll_items FOR SELECT
  USING (is_admin_or_staff(auth.uid()));

-- Trigger for updated_at on staff_payroll_items
CREATE TRIGGER update_staff_payroll_items_updated_at
  BEFORE UPDATE ON public.staff_payroll_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- 4. Function: populate_staff_payroll_items
CREATE OR REPLACE FUNCTION public.populate_staff_payroll_items(p_assignment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment record;
  v_staff record;
  v_booking record;
BEGIN
  -- Get assignment details
  SELECT * INTO v_assignment FROM booking_staff_assignments WHERE id = p_assignment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found: %', p_assignment_id;
  END IF;

  -- Get staff details
  SELECT * INTO v_staff FROM staff_members WHERE id = v_assignment.staff_id;

  -- Get booking details (may be null for non-booking assignments)
  IF v_assignment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking FROM bookings WHERE id = v_assignment.booking_id;
  END IF;

  -- Delete existing payroll items for this assignment to avoid duplicates
  DELETE FROM staff_payroll_items WHERE assignment_id = p_assignment_id;

  -- Insert payroll item
  INSERT INTO staff_payroll_items (
    staff_id,
    assignment_id,
    booking_id,
    event_date,
    hours_worked,
    hourly_rate,
    total_pay,
    item_type,
    description,
    pay_status
  ) VALUES (
    v_assignment.staff_id,
    p_assignment_id,
    v_assignment.booking_id,
    COALESCE(v_booking.event_date, CURRENT_DATE),
    COALESCE(v_assignment.hours_worked, 0),
    COALESCE(v_assignment.hourly_rate, v_staff.hourly_rate, 0),
    COALESCE(v_assignment.total_pay, 
      COALESCE(v_assignment.hours_worked, 0) * COALESCE(v_assignment.hourly_rate, v_staff.hourly_rate, 0)
    ),
    'event_work',
    v_assignment.assignment_role || ' - ' || COALESCE(v_booking.full_name, 'Non-booking assignment'),
    v_assignment.pay_status
  );
END;
$$;

-- 5. Function: get_payroll_by_staff
CREATE OR REPLACE FUNCTION public.get_payroll_by_staff(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  staff_id uuid,
  staff_name text,
  staff_role text,
  payroll_type text,
  base_hourly_rate numeric,
  total_hours numeric,
  total_pay numeric,
  assignment_count bigint,
  avg_hours_per_assignment numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sm.id AS staff_id,
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    sm.hourly_rate AS base_hourly_rate,
    COALESCE(SUM(spi.hours_worked), 0) AS total_hours,
    COALESCE(SUM(spi.total_pay), 0) AS total_pay,
    COUNT(spi.id) AS assignment_count,
    CASE WHEN COUNT(spi.id) > 0 
      THEN ROUND(COALESCE(SUM(spi.hours_worked), 0) / COUNT(spi.id), 2)
      ELSE 0
    END AS avg_hours_per_assignment
  FROM staff_members sm
  LEFT JOIN staff_payroll_items spi ON spi.staff_id = sm.id
    AND spi.event_date >= p_start_date
    AND spi.event_date <= p_end_date
  WHERE sm.is_active = true
  GROUP BY sm.id, sm.full_name, sm.role, sm.payroll_type, sm.hourly_rate
  ORDER BY total_pay DESC;
END;
$$;

-- 6. Function: get_payroll_by_role
CREATE OR REPLACE FUNCTION public.get_payroll_by_role(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  role text,
  staff_count bigint,
  total_hours numeric,
  total_pay numeric,
  avg_pay_per_staff numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sm.role,
    COUNT(DISTINCT sm.id) AS staff_count,
    COALESCE(SUM(spi.hours_worked), 0) AS total_hours,
    COALESCE(SUM(spi.total_pay), 0) AS total_pay,
    CASE WHEN COUNT(DISTINCT sm.id) > 0
      THEN ROUND(COALESCE(SUM(spi.total_pay), 0) / COUNT(DISTINCT sm.id), 2)
      ELSE 0
    END AS avg_pay_per_staff
  FROM staff_members sm
  LEFT JOIN staff_payroll_items spi ON spi.staff_id = sm.id
    AND spi.event_date >= p_start_date
    AND spi.event_date <= p_end_date
  WHERE sm.is_active = true
  GROUP BY sm.role
  ORDER BY total_pay DESC;
END;
$$;

-- 7. Function: get_payroll_line_items_export
CREATE OR REPLACE FUNCTION public.get_payroll_line_items_export(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  staff_name text,
  staff_role text,
  event_date date,
  assignment_role text,
  guest_name text,
  reservation_number text,
  hours_worked numeric,
  hourly_rate numeric,
  total_pay numeric,
  pay_status text,
  item_type text,
  description text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    spi.event_date,
    bsa.assignment_role,
    b.full_name AS guest_name,
    b.reservation_number,
    spi.hours_worked,
    spi.hourly_rate,
    spi.total_pay,
    spi.pay_status,
    spi.item_type,
    spi.description
  FROM staff_payroll_items spi
  JOIN staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  LEFT JOIN bookings b ON b.id = spi.booking_id
  WHERE spi.event_date >= p_start_date
    AND spi.event_date <= p_end_date
  ORDER BY spi.event_date DESC, sm.full_name;
END;
$$;

-- 8. Trigger: Auto-populate payroll when assignment is completed
CREATE OR REPLACE FUNCTION public.trigger_populate_payroll_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only trigger when pay_status changes to 'completed' or hours_worked/total_pay are set
  IF (NEW.pay_status = 'completed' AND (OLD.pay_status IS NULL OR OLD.pay_status != 'completed'))
     OR (NEW.hours_worked IS NOT NULL AND OLD.hours_worked IS NULL)
     OR (NEW.total_pay IS NOT NULL AND OLD.total_pay IS NULL)
  THEN
    PERFORM populate_staff_payroll_items(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_populate_payroll_on_completion
  AFTER UPDATE ON public.booking_staff_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_populate_payroll_on_completion();
