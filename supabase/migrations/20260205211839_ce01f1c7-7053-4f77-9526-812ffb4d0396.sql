
-- =====================================================
-- CORRECTIVE MIGRATION: Align payroll system with original specification
-- =====================================================
-- This fixes the auto-generated migration to match the original design in
-- 20260205200000_add_payroll_system.sql
-- =====================================================

-- =====================================================
-- 1) DROP existing staff_payroll_items (wrong structure)
-- =====================================================
DROP TABLE IF EXISTS public.staff_payroll_items CASCADE;

-- Drop existing triggers on booking_staff_assignments related to payroll
DROP TRIGGER IF EXISTS trg_populate_payroll_on_completion ON public.booking_staff_assignments;
DROP TRIGGER IF EXISTS auto_calculate_payroll_on_completion ON public.booking_staff_assignments;

-- Drop existing functions (will be recreated)
DROP FUNCTION IF EXISTS public.populate_staff_payroll_items(UUID);
DROP FUNCTION IF EXISTS public.populate_staff_payroll_items(UUID, BOOLEAN);
DROP FUNCTION IF EXISTS public.trigger_populate_payroll_on_completion();
DROP FUNCTION IF EXISTS public.get_payroll_by_staff(DATE, DATE);
DROP FUNCTION IF EXISTS public.get_payroll_by_staff(DATE, DATE, UUID);
DROP FUNCTION IF EXISTS public.get_payroll_by_role(DATE, DATE);
DROP FUNCTION IF EXISTS public.get_payroll_line_items_export(DATE, DATE);

-- =====================================================
-- 2) FIX staff_members.payroll_type
-- =====================================================

-- Drop existing check constraint if any
ALTER TABLE public.staff_members DROP CONSTRAINT IF EXISTS staff_members_payroll_type_check;

-- Update default to 'none' (safe - only affects new inserts)
ALTER TABLE public.staff_members ALTER COLUMN payroll_type SET DEFAULT 'none';

-- Update any existing staff with 'hourly' default back to 'none' 
-- (only if they were auto-set by the wrong migration)
UPDATE public.staff_members SET payroll_type = 'none' WHERE payroll_type = 'hourly';

-- Add proper CHECK constraint
ALTER TABLE public.staff_members ADD CONSTRAINT staff_members_payroll_type_check
  CHECK (payroll_type IN ('none', 'hourly', 'per_assignment'));

-- Add comments
COMMENT ON COLUMN public.staff_members.payroll_type IS 
  'Payroll calculation method:
   - none: No payroll tracking (DEFAULT - manual opt-in required)
   - hourly: Paid by hour (Production: typically $50/hr)
   - per_assignment: Paid per task (Custodial/Assistant: $40-$150 per cleaning)';

COMMENT ON COLUMN public.staff_members.hourly_rate IS 
  'Hourly rate for staff with payroll_type=hourly. Default $50 for Production staff.';

-- =====================================================
-- 3) FIX booking_staff_assignments
-- =====================================================

-- Remove wrong columns added by auto-migration
ALTER TABLE public.booking_staff_assignments DROP COLUMN IF EXISTS hourly_rate;
ALTER TABLE public.booking_staff_assignments DROP COLUMN IF EXISTS total_pay;
ALTER TABLE public.booking_staff_assignments DROP COLUMN IF EXISTS pay_status;

-- Add correct columns from original spec

-- Assignment type
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS assignment_type TEXT DEFAULT 'other';

ALTER TABLE public.booking_staff_assignments DROP CONSTRAINT IF EXISTS booking_staff_assignments_assignment_type_check;
ALTER TABLE public.booking_staff_assignments ADD CONSTRAINT booking_staff_assignments_assignment_type_check
  CHECK (assignment_type IN ('cleaning', 'production', 'setup', 'support', 'other'));

-- Cleaning-specific fields
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS cleaning_type TEXT;

ALTER TABLE public.booking_staff_assignments DROP CONSTRAINT IF EXISTS booking_staff_assignments_cleaning_type_check;
ALTER TABLE public.booking_staff_assignments ADD CONSTRAINT booking_staff_assignments_cleaning_type_check
  CHECK (cleaning_type IN ('touch_up', 'regular', 'deep') OR cleaning_type IS NULL);

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS celebration_surcharge DECIMAL(10,2) DEFAULT 0;

-- Scheduling fields (for standalone assignments)
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS scheduled_date DATE;

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS scheduled_start_time TIME;

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS scheduled_end_time TIME;

-- Status tracking
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'assigned';

ALTER TABLE public.booking_staff_assignments DROP CONSTRAINT IF EXISTS booking_staff_assignments_status_check;
ALTER TABLE public.booking_staff_assignments ADD CONSTRAINT booking_staff_assignments_status_check
  CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled'));

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- Constraint: Must have booking_id OR scheduled_date
ALTER TABLE public.booking_staff_assignments DROP CONSTRAINT IF EXISTS booking_or_scheduled_required;
ALTER TABLE public.booking_staff_assignments ADD CONSTRAINT booking_or_scheduled_required
  CHECK (booking_id IS NOT NULL OR scheduled_date IS NOT NULL);

-- Comments
COMMENT ON COLUMN public.booking_staff_assignments.booking_id IS 
  'Optional: Links to a booking. NULL for standalone assignments (venue prep, maintenance, etc.)';

COMMENT ON COLUMN public.booking_staff_assignments.assignment_type IS 
  'Type of work: cleaning (custodial), production (A/V), setup (prep), support, other';

COMMENT ON COLUMN public.booking_staff_assignments.cleaning_type IS 
  'For custodial assignments: touch_up ($40), regular ($80), deep ($150). Used for payroll calculation.';

COMMENT ON COLUMN public.booking_staff_assignments.celebration_surcharge IS 
  'Additional pay for celebration cleanings ($20-$70). Only for custodial/assistant assignments.';

COMMENT ON COLUMN public.booking_staff_assignments.status IS 
  'Assignment status: assigned (pending), in_progress (started), completed (finished), cancelled';

-- =====================================================
-- 4) CREATE staff_payroll_items with CORRECT structure
-- =====================================================

CREATE TABLE public.staff_payroll_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.booking_staff_assignments(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  
  -- Categorization
  pay_category TEXT NOT NULL CHECK (pay_category IN (
    'hourly_production',
    'cleaning_base',
    'cleaning_surcharge',
    'bonus',
    'deduction'
  )),
  
  pay_type TEXT,
  
  -- Financial details
  amount DECIMAL(10,2) NOT NULL,
  hours DECIMAL(5,2),
  rate DECIMAL(10,2),
  
  -- Description
  description TEXT,
  
  -- Metadata
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Audit fields
  is_historical BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_payroll_items_assignment ON public.staff_payroll_items(assignment_id);
CREATE INDEX idx_payroll_items_staff ON public.staff_payroll_items(staff_id);
CREATE INDEX idx_payroll_items_category ON public.staff_payroll_items(pay_category);
CREATE INDEX idx_payroll_items_created ON public.staff_payroll_items(created_at);

-- Enable RLS
ALTER TABLE public.staff_payroll_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admin can view payroll items"
  ON public.staff_payroll_items FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can manage payroll items"
  ON public.staff_payroll_items FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can view own payroll items"
  ON public.staff_payroll_items FOR SELECT
  USING (is_admin_or_staff(auth.uid()));

-- Trigger for updated_at
CREATE TRIGGER update_payroll_items_updated_at
  BEFORE UPDATE ON public.staff_payroll_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Comments
COMMENT ON TABLE public.staff_payroll_items IS 
  'Line-item ledger for staff payroll. Each assignment can generate multiple items (base + surcharge).';

COMMENT ON COLUMN public.staff_payroll_items.pay_category IS 
  'Payment type: hourly_production ($50/hr), cleaning_base ($40-$150), cleaning_surcharge ($20-$70), bonus, deduction';

COMMENT ON COLUMN public.staff_payroll_items.is_historical IS 
  'True if created from backfill of historical assignments';

-- =====================================================
-- 5) CREATE populate_staff_payroll_items() - ORIGINAL VERSION
-- =====================================================

CREATE OR REPLACE FUNCTION public.populate_staff_payroll_items(
  p_assignment_id UUID,
  p_is_historical BOOLEAN DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment RECORD;
  v_staff RECORD;
  v_booking RECORD;
  v_hourly_rate DECIMAL(10,2);
  v_hours DECIMAL(5,2);
  v_base_pay DECIMAL(10,2);
BEGIN
  -- Get assignment data
  SELECT * INTO v_assignment
  FROM public.booking_staff_assignments
  WHERE id = p_assignment_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found: %', p_assignment_id;
  END IF;
  
  -- Get staff data
  SELECT * INTO v_staff
  FROM public.staff_members
  WHERE id = v_assignment.staff_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found: %', v_assignment.staff_id;
  END IF;
  
  -- Skip if staff payroll_type is 'none'
  IF v_staff.payroll_type = 'none' THEN
    RAISE NOTICE 'Staff % has payroll_type=none, skipping payroll calculation', v_staff.full_name;
    RETURN;
  END IF;
  
  -- Get booking data if linked to booking
  IF v_assignment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_assignment.booking_id;
  END IF;
  
  -- Delete existing payroll items for this assignment (allow re-generation)
  DELETE FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id;
  
  -- Calculate payroll based on staff payroll_type
  IF v_staff.payroll_type = 'hourly' THEN
    -- PRODUCTION: Hourly pay
    v_hourly_rate := COALESCE(v_staff.hourly_rate, 50.00);
    v_hours := COALESCE(v_assignment.hours_worked, 0);
    
    -- If hours not set but booking has package times, calculate automatically
    IF v_hours = 0 AND v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_booking.package_end_time - v_booking.package_start_time)) / 3600.0;
    END IF;
    
    -- Create payroll item if hours > 0
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
    -- CUSTODIAL/ASSISTANT: Per-assignment pay
    IF v_assignment.cleaning_type IS NOT NULL THEN
      -- Determine base pay based on cleaning type
      v_base_pay := CASE v_assignment.cleaning_type
        WHEN 'touch_up' THEN 40.00
        WHEN 'regular' THEN 80.00
        WHEN 'deep' THEN 150.00
        ELSE 0
      END;
      
      -- Insert base cleaning pay
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
      
      -- Insert celebration surcharge if applicable
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
$$;

COMMENT ON FUNCTION public.populate_staff_payroll_items IS 
  'Calculates and creates payroll line items for a staff assignment.
   For Production (hourly): amount = hours x rate
   For Custodial/Assistant (per_assignment): base pay + optional surcharge
   Only processes staff with payroll_type != none';

-- =====================================================
-- 6) CREATE trigger function - fires on status change to completed
-- =====================================================

CREATE OR REPLACE FUNCTION public.trigger_populate_payroll_on_completion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only trigger when status changes TO 'completed' (from anything else)
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    PERFORM public.populate_staff_payroll_items(NEW.id, false);
  END IF;
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER auto_calculate_payroll_on_completion
  AFTER UPDATE OF status ON public.booking_staff_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_populate_payroll_on_completion();

COMMENT ON FUNCTION public.trigger_populate_payroll_on_completion IS 
  'Trigger function: Automatically calculates payroll when assignment status becomes completed';

-- =====================================================
-- 7) CREATE get_payroll_by_staff() - ORIGINAL VERSION
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_payroll_by_staff(
  p_start_date DATE,
  p_end_date DATE,
  p_staff_id UUID DEFAULT NULL
)
RETURNS TABLE(
  staff_id UUID,
  staff_name TEXT,
  staff_role TEXT,
  payroll_type TEXT,
  total_amount DECIMAL,
  assignment_count BIGINT,
  hours_worked DECIMAL,
  avg_per_assignment DECIMAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    sm.id AS staff_id,
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    SUM(spi.amount) AS total_amount,
    COUNT(DISTINCT spi.assignment_id) AS assignment_count,
    SUM(spi.hours) AS hours_worked,
    ROUND(SUM(spi.amount) / NULLIF(COUNT(DISTINCT spi.assignment_id), 0), 2) AS avg_per_assignment
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date) BETWEEN p_start_date AND p_end_date
  )
    AND (p_staff_id IS NULL OR sm.id = p_staff_id)
    AND bsa.status != 'cancelled'
  GROUP BY sm.id, sm.full_name, sm.role, sm.payroll_type
  ORDER BY total_amount DESC;
$$;

COMMENT ON FUNCTION public.get_payroll_by_staff IS 
  'Get payroll summary by staff member for a date range. 
   Optional: filter by specific staff_id.';

-- =====================================================
-- 8) CREATE get_payroll_by_role() - ORIGINAL VERSION
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_payroll_by_role(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  staff_role TEXT,
  payroll_type TEXT,
  staff_count BIGINT,
  total_amount DECIMAL,
  assignment_count BIGINT,
  hours_worked DECIMAL,
  avg_per_staff DECIMAL,
  avg_per_assignment DECIMAL
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    sm.role AS staff_role,
    sm.payroll_type,
    COUNT(DISTINCT sm.id) AS staff_count,
    SUM(spi.amount) AS total_amount,
    COUNT(DISTINCT spi.assignment_id) AS assignment_count,
    SUM(spi.hours) AS hours_worked,
    ROUND(SUM(spi.amount) / NULLIF(COUNT(DISTINCT sm.id), 0), 2) AS avg_per_staff,
    ROUND(SUM(spi.amount) / NULLIF(COUNT(DISTINCT spi.assignment_id), 0), 2) AS avg_per_assignment
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date) BETWEEN p_start_date AND p_end_date
  )
    AND bsa.status != 'cancelled'
  GROUP BY sm.role, sm.payroll_type
  ORDER BY total_amount DESC;
$$;

COMMENT ON FUNCTION public.get_payroll_by_role IS 
  'Get payroll summary aggregated by role (Production, Custodial, Assistant).';

-- =====================================================
-- 9) CREATE get_payroll_line_items_export() - ORIGINAL VERSION
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

COMMENT ON FUNCTION public.get_payroll_line_items_export IS 
  'Get detailed payroll line items for CSV export with full staff and assignment details.';
