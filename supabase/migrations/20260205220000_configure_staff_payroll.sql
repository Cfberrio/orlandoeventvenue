-- =====================================================
-- CONFIGURE STAFF PAYROLL SYSTEM
-- =====================================================
-- PURPOSE: Configure existing staff with correct payroll_type and add payment tracking
-- =====================================================

-- =====================================================
-- 1) UPDATE staff_members with correct payroll_type
-- =====================================================

-- Update Production staff to hourly
UPDATE public.staff_members 
SET payroll_type = 'hourly', hourly_rate = 50.00
WHERE role = 'Production' AND payroll_type = 'none';

-- Update Custodial staff to per_assignment
UPDATE public.staff_members 
SET payroll_type = 'per_assignment'
WHERE role = 'Custodial' AND payroll_type = 'none';

-- Update Assistant staff to per_assignment
UPDATE public.staff_members 
SET payroll_type = 'per_assignment'
WHERE role = 'Assistant' AND payroll_type = 'none';

-- Log the configuration
DO $$
DECLARE
  v_production_count INTEGER;
  v_custodial_count INTEGER;
  v_assistant_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_production_count FROM staff_members WHERE role = 'Production' AND payroll_type = 'hourly';
  SELECT COUNT(*) INTO v_custodial_count FROM staff_members WHERE role = 'Custodial' AND payroll_type = 'per_assignment';
  SELECT COUNT(*) INTO v_assistant_count FROM staff_members WHERE role = 'Assistant' AND payroll_type = 'per_assignment';
  
  RAISE NOTICE '[PAYROLL-CONFIG] Staff configured:';
  RAISE NOTICE '  - Production (hourly): % staff', v_production_count;
  RAISE NOTICE '  - Custodial (per_assignment): % staff', v_custodial_count;
  RAISE NOTICE '  - Assistant (per_assignment): % staff', v_assistant_count;
END $$;

-- =====================================================
-- 2) ADD payment tracking to staff_payroll_items
-- =====================================================

-- Add paid_status field
ALTER TABLE public.staff_payroll_items
  ADD COLUMN IF NOT EXISTS paid_status TEXT DEFAULT 'pending';

-- Add constraint for paid_status
ALTER TABLE public.staff_payroll_items DROP CONSTRAINT IF EXISTS staff_payroll_items_paid_status_check;
ALTER TABLE public.staff_payroll_items ADD CONSTRAINT staff_payroll_items_paid_status_check
  CHECK (paid_status IN ('pending', 'paid'));

-- Add paid_at timestamp
ALTER TABLE public.staff_payroll_items
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ;

-- Add paid_by reference (who marked it as paid)
ALTER TABLE public.staff_payroll_items
  ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES public.staff_members(id);

-- Add comments
COMMENT ON COLUMN public.staff_payroll_items.paid_status IS 
  'Payment status: pending (owed), paid (settled)';

COMMENT ON COLUMN public.staff_payroll_items.paid_at IS 
  'Timestamp when payment was marked as completed';

COMMENT ON COLUMN public.staff_payroll_items.paid_by IS 
  'Admin staff member who marked this item as paid';

-- =====================================================
-- 3) CREATE FUNCTION mark_payroll_as_paid()
-- =====================================================

CREATE OR REPLACE FUNCTION public.mark_payroll_as_paid(
  p_payroll_item_ids UUID[],
  p_paid_by UUID
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- Update payroll items to paid
  UPDATE public.staff_payroll_items
  SET 
    paid_status = 'paid',
    paid_at = now(),
    paid_by = p_paid_by
  WHERE id = ANY(p_payroll_item_ids)
    AND paid_status = 'pending';
  
  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  
  RAISE NOTICE '[PAYROLL-PAID] Marked % payroll items as paid', v_updated_count;
  
  RETURN v_updated_count;
END;
$$;

COMMENT ON FUNCTION public.mark_payroll_as_paid IS 
  'Marks multiple payroll items as paid. Returns count of items updated.';

-- =====================================================
-- 4) UPDATE get_payroll_line_items_export to include paid_status
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_payroll_line_items_export(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  staff_name TEXT,
  staff_role TEXT,
  payroll_type TEXT,
  assignment_date DATE,
  booking_id UUID,
  reservation_number TEXT,
  assignment_type TEXT,
  pay_category TEXT,
  pay_type TEXT,
  amount DECIMAL,
  hours DECIMAL,
  rate DECIMAL,
  description TEXT,
  assignment_status TEXT,
  paid_status TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date) AS assignment_date,
    bsa.booking_id,
    b.reservation_number,
    bsa.assignment_type,
    spi.pay_category,
    spi.pay_type,
    spi.amount,
    spi.hours,
    spi.rate,
    spi.description,
    bsa.status AS assignment_status,
    spi.paid_status,
    spi.paid_at,
    spi.created_at
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date) BETWEEN p_start_date AND p_end_date
  )
    AND bsa.status != 'cancelled'
  ORDER BY assignment_date DESC, sm.full_name, spi.created_at;
$$;

-- =====================================================
-- 5) VERIFICATION QUERIES
-- =====================================================

-- Verify staff configuration
DO $$
DECLARE
  v_staff RECORD;
BEGIN
  RAISE NOTICE '=== STAFF PAYROLL CONFIGURATION ===';
  FOR v_staff IN
    SELECT role, payroll_type, COUNT(*) as count
    FROM staff_members
    WHERE is_active = true
    GROUP BY role, payroll_type
    ORDER BY role
  LOOP
    RAISE NOTICE 'Role: %, Payroll Type: %, Count: %', v_staff.role, v_staff.payroll_type, v_staff.count;
  END LOOP;
END $$;

-- Test queries (commented - run manually to verify)
/*
-- A) Check staff configuration
SELECT 
  full_name,
  role,
  payroll_type,
  hourly_rate,
  is_active
FROM staff_members
ORDER BY role, full_name;

-- B) Check paid_status field exists
SELECT 
  column_name,
  data_type,
  column_default
FROM information_schema.columns
WHERE table_name = 'staff_payroll_items'
  AND column_name IN ('paid_status', 'paid_at', 'paid_by')
ORDER BY column_name;

-- C) Test mark_payroll_as_paid function exists
SELECT 
  routine_name,
  routine_type
FROM information_schema.routines
WHERE routine_name = 'mark_payroll_as_paid';
*/

-- Migration complete
RAISE NOTICE '[PAYROLL-CONFIG] Migration completed successfully!';
RAISE NOTICE '[PAYROLL-CONFIG] Staff members configured with correct payroll types';
RAISE NOTICE '[PAYROLL-CONFIG] Payment tracking fields added to staff_payroll_items';
