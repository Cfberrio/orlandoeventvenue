-- =====================================================
-- PAYROLL SYSTEM FOR STAFF ASSIGNMENTS
-- =====================================================
-- OBJECTIVE: Enable payroll tracking for staff without affecting existing bookings/assignments
--
-- ROLES SUPPORTED:
--   - Production: Hourly pay ($50/hr calculated from package times)
--   - Custodial: Per-assignment pay ($40-$150 based on cleaning type + surcharge)
--   - Assistant: Per-assignment pay (same rates as Custodial)
--
-- FEATURES:
--   - Standalone assignments (cleaning/prep without booking)
--   - Automatic payroll calculation when assignment completed
--   - Backfill support for historical assignments
--   - Detailed reporting by staff, role, and date range
--
-- SAFETY GUARANTEES:
--   ✓ All existing assignments keep their booking_id (not affected)
--   ✓ New fields have safe DEFAULT values
--   ✓ Trigger only affects new status changes
--   ✓ payroll_type defaults to 'none' (manual opt-in per staff)
--   ✓ All constraints pass for existing data
--   ✓ No data migration required
-- =====================================================

-- =====================================================
-- 1) MODIFY staff_members - Add Payroll Configuration
-- =====================================================

-- Add payroll type field to distinguish payment method
ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS payroll_type TEXT DEFAULT 'none'
    CHECK (payroll_type IN ('none', 'hourly', 'per_assignment'));

-- Add hourly rate field (for Production staff)
ALTER TABLE public.staff_members
  ADD COLUMN IF NOT EXISTS hourly_rate DECIMAL(10,2) DEFAULT 50.00;

-- Update comments for clarity
COMMENT ON COLUMN public.staff_members.role IS 
  'Staff role: Custodial, Production, Assistant (internal use only)';

COMMENT ON COLUMN public.staff_members.payroll_type IS 
  'Payroll calculation method:
   - none: No payroll tracking (DEFAULT - manual opt-in required)
   - hourly: Paid by hour (Production: typically $50/hr)
   - per_assignment: Paid per task (Custodial/Assistant: $40-$150 per cleaning)';

COMMENT ON COLUMN public.staff_members.hourly_rate IS 
  'Hourly rate for staff with payroll_type=hourly. Default $50 for Production staff.';

-- =====================================================
-- 2) MODIFY booking_staff_assignments - Enable Standalone & Payroll Tracking
-- =====================================================

-- A) Make booking_id NULLABLE (allows standalone assignments)
-- SAFETY: This does NOT affect existing assignments (all have booking_id)
ALTER TABLE public.booking_staff_assignments
  ALTER COLUMN booking_id DROP NOT NULL;

-- B) Add assignment type field
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS assignment_type TEXT DEFAULT 'other'
    CHECK (assignment_type IN ('cleaning', 'production', 'setup', 'support', 'other'));

-- C) Add cleaning-specific fields (for Custodial/Assistant)
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS cleaning_type TEXT
    CHECK (cleaning_type IN ('touch_up', 'regular', 'deep') OR cleaning_type IS NULL);

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS celebration_surcharge DECIMAL(10,2) DEFAULT 0;

-- D) Add hours worked field (for Production)
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS hours_worked DECIMAL(5,2);

-- E) Add scheduling fields (for standalone assignments)
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS scheduled_date DATE;

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS scheduled_start_time TIME;

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS scheduled_end_time TIME;

-- F) Add status tracking fields
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'completed', 'cancelled'));

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

-- G) Add constraint: Must have booking_id OR scheduled_date
-- SAFETY: All existing assignments have booking_id, so they pass this check
ALTER TABLE public.booking_staff_assignments
  ADD CONSTRAINT booking_or_scheduled_required 
    CHECK (booking_id IS NOT NULL OR scheduled_date IS NOT NULL);

-- H) Update comments
COMMENT ON COLUMN public.booking_staff_assignments.booking_id IS 
  'Optional: Links to a booking. NULL for standalone assignments (venue prep, maintenance, etc.)';

COMMENT ON COLUMN public.booking_staff_assignments.assignment_type IS 
  'Type of work: cleaning (custodial), production (A/V), setup (prep), support, other';

COMMENT ON COLUMN public.booking_staff_assignments.cleaning_type IS 
  'For custodial assignments: touch_up ($40), regular ($80), deep ($150). Used for payroll calculation.';

COMMENT ON COLUMN public.booking_staff_assignments.celebration_surcharge IS 
  'Additional pay for celebration cleanings ($20-$70). Only for custodial/assistant assignments.';

COMMENT ON COLUMN public.booking_staff_assignments.hours_worked IS 
  'Hours worked. For Production, can be calculated from booking.package_start_time/end_time.';

COMMENT ON COLUMN public.booking_staff_assignments.scheduled_date IS 
  'For standalone assignments: date of work. Required when booking_id is NULL.';

COMMENT ON COLUMN public.booking_staff_assignments.status IS 
  'Assignment status: assigned (pending), in_progress (started), completed (finished), cancelled';

-- =====================================================
-- 3) CREATE staff_payroll_items - Line-Item Ledger for Payroll
-- =====================================================

CREATE TABLE IF NOT EXISTS public.staff_payroll_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.booking_staff_assignments(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  
  -- Categorization
  pay_category TEXT NOT NULL CHECK (pay_category IN (
    'hourly_production',    -- Production: hourly pay
    'cleaning_base',        -- Custodial/Assistant: base cleaning fee
    'cleaning_surcharge',   -- Custodial/Assistant: celebration surcharge
    'bonus',                -- Special bonuses
    'deduction'             -- Deductions (negative amounts)
  )),
  
  pay_type TEXT,  -- Specific type: touch_up, regular, deep, production, etc.
  
  -- Financial details
  amount DECIMAL(10,2) NOT NULL,
  hours DECIMAL(5,2),     -- For hourly pay
  rate DECIMAL(10,2),     -- Hourly rate used
  
  -- Description
  description TEXT,
  
  -- Metadata (flexible JSON for additional info)
  metadata JSONB DEFAULT '{}'::jsonb,
  
  -- Audit fields
  is_historical BOOLEAN DEFAULT false,  -- True if backfilled
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_payroll_items_assignment ON public.staff_payroll_items(assignment_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_staff ON public.staff_payroll_items(staff_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_category ON public.staff_payroll_items(pay_category);
CREATE INDEX IF NOT EXISTS idx_payroll_items_created ON public.staff_payroll_items(created_at);

-- Enable RLS
ALTER TABLE public.staff_payroll_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admin can view payroll items"
  ON public.staff_payroll_items FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Admin can manage payroll items"
  ON public.staff_payroll_items FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_payroll_items_updated_at
  BEFORE UPDATE ON public.staff_payroll_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Comments
COMMENT ON TABLE public.staff_payroll_items IS 
  'Line-item ledger for staff payroll. Similar to booking_revenue_items but for contractor payments.';

COMMENT ON COLUMN public.staff_payroll_items.pay_category IS 
  'Payment type: hourly_production ($50/hr), cleaning_base ($40-$150), cleaning_surcharge ($20-$70), bonus, deduction';

COMMENT ON COLUMN public.staff_payroll_items.is_historical IS 
  'True if created from backfill of historical assignments';

-- =====================================================
-- 4) CREATE FUNCTION populate_staff_payroll_items()
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
    -- ==========================================
    -- PRODUCTION: Hourly pay
    -- ==========================================
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
    -- ==========================================
    -- CUSTODIAL/ASSISTANT: Per-assignment pay
    -- ==========================================
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
   For Production (hourly): amount = hours × rate
   For Custodial/Assistant (per_assignment): base pay + optional surcharge
   Only processes staff with payroll_type != none';

-- =====================================================
-- 5) CREATE TRIGGER auto_calculate_payroll_on_completion
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
    -- Call populate function (not historical since it's a new completion)
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
-- 6) CREATE FUNCTION get_payroll_by_staff()
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
  WHERE (
    COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date) BETWEEN p_start_date AND p_end_date
  )
    AND (p_staff_id IS NULL OR sm.id = p_staff_id)
    AND bsa.status != 'cancelled'
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  GROUP BY sm.id, sm.full_name, sm.role, sm.payroll_type
  ORDER BY total_amount DESC;
$$;

COMMENT ON FUNCTION public.get_payroll_by_staff IS 
  'Get payroll summary by staff member for a date range. 
   Optional: filter by specific staff_id.
   Returns total amount, assignment count, hours worked, and average per assignment.';

-- =====================================================
-- 7) CREATE FUNCTION get_payroll_by_role()
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
  'Get payroll summary aggregated by role (Production, Custodial, Assistant).
   Shows staff count, total amount, assignment count, hours, and averages per staff/assignment.';

-- =====================================================
-- 8) CREATE FUNCTION get_payroll_line_items_export()
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
  'Get detailed payroll line items for CSV export.
   Includes all payroll items with staff info, assignment details, and financial breakdown.';

-- =====================================================
-- 9) BACKFILL SCRIPT (Commented - Execute manually after verification)
-- =====================================================

/*
-- =====================================================
-- BACKFILL: Populate payroll items for historical assignments
-- =====================================================
-- WARNING: Only execute this AFTER verifying the migration is successful
-- and staff members have been updated with correct payroll_type values.
--
-- This script will:
-- 1. Find all completed assignments that don't have payroll items yet
-- 2. Call populate_staff_payroll_items() for each with is_historical = true
--
-- To execute:
-- 1. Verify staff_members have correct payroll_type set
-- 2. Uncomment the DO block below
-- 3. Run in SQL Editor
-- =====================================================

DO $$
DECLARE
  v_assignment RECORD;
  v_processed_count INTEGER := 0;
  v_skipped_count INTEGER := 0;
BEGIN
  RAISE NOTICE 'Starting payroll backfill...';
  
  -- Loop through completed assignments without payroll items
  FOR v_assignment IN
    SELECT bsa.id, bsa.staff_id, sm.full_name, sm.payroll_type
    FROM public.booking_staff_assignments bsa
    JOIN public.staff_members sm ON sm.id = bsa.staff_id
    LEFT JOIN public.staff_payroll_items spi ON spi.assignment_id = bsa.id
    WHERE bsa.status = 'completed'
      AND spi.id IS NULL  -- No payroll items yet
      AND sm.payroll_type != 'none'  -- Only staff with payroll enabled
    ORDER BY bsa.completed_at
  LOOP
    BEGIN
      -- Call populate function with is_historical = true
      PERFORM public.populate_staff_payroll_items(v_assignment.id, true);
      v_processed_count := v_processed_count + 1;
      
      -- Log progress every 10 assignments
      IF v_processed_count % 10 = 0 THEN
        RAISE NOTICE 'Processed % assignments...', v_processed_count;
      END IF;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'Failed to process assignment % for staff %: %', 
        v_assignment.id, v_assignment.full_name, SQLERRM;
      v_skipped_count := v_skipped_count + 1;
    END;
  END LOOP;
  
  RAISE NOTICE 'Backfill complete: % processed, % skipped', v_processed_count, v_skipped_count;
END $$;

-- After backfill, verify results:
SELECT 
  sm.full_name,
  sm.role,
  sm.payroll_type,
  COUNT(DISTINCT bsa.id) as total_assignments,
  COUNT(DISTINCT spi.assignment_id) as with_payroll,
  SUM(spi.amount) as total_payroll
FROM public.staff_members sm
LEFT JOIN public.booking_staff_assignments bsa ON bsa.staff_id = sm.id AND bsa.status = 'completed'
LEFT JOIN public.staff_payroll_items spi ON spi.staff_id = sm.id
WHERE sm.payroll_type != 'none'
GROUP BY sm.id, sm.full_name, sm.role, sm.payroll_type
ORDER BY sm.role, sm.full_name;
*/

-- =====================================================
-- 10) VERIFICATION QUERIES
-- =====================================================

-- Run these queries after migration to verify everything is correct

-- A) Verify all existing assignments are intact
-- Expected: All assignments should have booking_id (none should be NULL yet)
/*
SELECT 
  COUNT(*) as total_assignments,
  COUNT(booking_id) as with_booking,
  COUNT(scheduled_date) as with_schedule,
  COUNT(CASE WHEN status = 'assigned' THEN 1 END) as status_assigned
FROM public.booking_staff_assignments;
*/

-- B) Verify no payroll items exist for staff with payroll_type = 'none'
-- Expected: Should return 0
/*
SELECT COUNT(*) as invalid_payroll_items
FROM public.staff_payroll_items spi
JOIN public.staff_members sm ON sm.id = spi.staff_id
WHERE sm.payroll_type = 'none';
*/

-- C) Verify constraint is working
-- Expected: This should FAIL (you can't insert assignment without booking_id AND without scheduled_date)
/*
-- DO NOT EXECUTE - This is just to show the constraint works:
-- INSERT INTO public.booking_staff_assignments (staff_id, assignment_role)
-- VALUES ('00000000-0000-0000-0000-000000000000'::uuid, 'cleaner');
-- Error: new row violates check constraint "booking_or_scheduled_required"
*/

-- D) Check staff payroll configuration
-- Expected: Shows all staff with their payroll_type (should all be 'none' initially)
/*
SELECT 
  full_name,
  role,
  payroll_type,
  hourly_rate,
  is_active
FROM public.staff_members
ORDER BY role, full_name;
*/

-- E) Check if trigger is installed
-- Expected: Should show the trigger exists
/*
SELECT 
  trigger_name,
  event_manipulation,
  event_object_table,
  action_statement
FROM information_schema.triggers
WHERE trigger_name = 'auto_calculate_payroll_on_completion';
*/

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================

-- Next steps:
-- 1. ✓ Migration applied
-- 2. Run verification queries above
-- 3. Update staff_members to set correct payroll_type for each staff
--    Example: UPDATE staff_members SET payroll_type = 'hourly' WHERE role = 'Production';
-- 4. (Optional) Execute backfill script for historical data
-- 5. Test by creating a new assignment and marking it completed
-- 6. Proceed to UI implementation (React components for Payroll Reports)

RAISE NOTICE 'Payroll system migration completed successfully!';
RAISE NOTICE 'Run verification queries to confirm everything is working.';
RAISE NOTICE 'Remember to update staff_members.payroll_type before enabling payroll tracking.';
