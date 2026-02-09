-- =====================================================
-- AUTO-TRIGGER PAYROLL WHEN BOOKING GOES IN_PROGRESS
-- =====================================================
-- OBJECTIVE: Automatically complete staff assignments (and thus generate payroll)
-- when a booking transitions to lifecycle_status = 'in_progress'.
-- Also handle standalone assignments via cleaning report completion.
--
-- FLOW FOR BOOKING ASSIGNMENTS:
--   booking.lifecycle_status -> 'in_progress'
--     -> trigger_complete_assignments_on_in_progress()
--       -> UPDATE booking_staff_assignments.status = 'completed'
--         -> EXISTING trigger auto_calculate_payroll_on_completion
--           -> populate_staff_payroll_items() generates payroll
--
-- FLOW FOR STANDALONE ASSIGNMENTS:
--   standalone_cleaning_reports.status -> 'completed'
--     -> trigger_complete_assignment_on_cleaning_report()
--       -> UPDATE booking_staff_assignments.status = 'completed'
--         -> EXISTING trigger auto_calculate_payroll_on_completion
--           -> populate_staff_payroll_items() generates payroll
-- =====================================================

-- =====================================================
-- 1) TRIGGER: Auto-complete assignments when booking goes in_progress
-- =====================================================

CREATE OR REPLACE FUNCTION public.trigger_complete_assignments_on_in_progress()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- When booking transitions to in_progress, auto-complete all linked assignments
  IF NEW.lifecycle_status = 'in_progress' 
     AND (OLD.lifecycle_status IS NULL OR OLD.lifecycle_status != 'in_progress') THEN
    
    UPDATE public.booking_staff_assignments
    SET 
      status = 'completed',
      completed_at = NOW()
    WHERE booking_id = NEW.id
      AND status IN ('assigned', 'in_progress');
    -- Each row update fires the existing auto_calculate_payroll_on_completion trigger
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    
    IF v_updated_count > 0 THEN
      RAISE NOTICE 'Auto-completed % assignment(s) for booking % (lifecycle -> in_progress)',
        v_updated_count, NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_complete_assignments_on_in_progress IS
  'When a booking transitions to in_progress, auto-complete all linked staff assignments.
   This fires the existing payroll trigger to generate payroll items automatically.';

CREATE TRIGGER auto_complete_assignments_on_booking_in_progress
  AFTER UPDATE OF lifecycle_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_complete_assignments_on_in_progress();

-- =====================================================
-- 2) TRIGGER: Auto-complete standalone assignment when cleaning report is completed
-- =====================================================

CREATE OR REPLACE FUNCTION public.trigger_complete_assignment_on_cleaning_report()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated_count INTEGER;
BEGIN
  -- When standalone cleaning report is completed, auto-complete the linked assignment
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE public.booking_staff_assignments
    SET 
      status = 'completed',
      completed_at = NOW()
    WHERE id = NEW.assignment_id
      AND status IN ('assigned', 'in_progress');
    -- This fires the existing auto_calculate_payroll_on_completion trigger
    
    GET DIAGNOSTICS v_updated_count = ROW_COUNT;
    
    IF v_updated_count > 0 THEN
      RAISE NOTICE 'Auto-completed standalone assignment % via cleaning report %',
        NEW.assignment_id, NEW.id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.trigger_complete_assignment_on_cleaning_report IS
  'When a standalone cleaning report is completed, auto-complete the linked assignment.
   This fires the existing payroll trigger to generate payroll items automatically.';

CREATE TRIGGER auto_complete_assignment_on_standalone_report
  AFTER UPDATE OF status ON public.standalone_cleaning_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_complete_assignment_on_cleaning_report();

-- =====================================================
-- 3) BACKFILL: Complete assignments for bookings already past in_progress
-- =====================================================
-- This handles Marielysa's Feb 7 booking and any other assignments
-- that should have been completed but weren't (because the trigger didn't exist yet).

DO $$
DECLARE
  v_assignment RECORD;
  v_count INTEGER := 0;
  v_errors INTEGER := 0;
BEGIN
  RAISE NOTICE '=== Starting payroll backfill for past bookings ===';
  
  FOR v_assignment IN
    SELECT bsa.id, bsa.staff_id, b.id as booking_id, b.reservation_number, b.lifecycle_status
    FROM booking_staff_assignments bsa
    JOIN bookings b ON b.id = bsa.booking_id
    WHERE b.lifecycle_status IN ('in_progress', 'post_event', 'closed_review_complete')
      AND bsa.status = 'assigned'
    ORDER BY b.event_date
  LOOP
    BEGIN
      UPDATE booking_staff_assignments
      SET status = 'completed', completed_at = NOW()
      WHERE id = v_assignment.id;
      -- This fires the existing payroll trigger for each assignment
      
      v_count := v_count + 1;
      RAISE NOTICE 'Completed assignment % for booking % (%)',
        v_assignment.id, v_assignment.booking_id, v_assignment.lifecycle_status;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        RAISE WARNING 'Error completing assignment %: %', v_assignment.id, SQLERRM;
    END;
  END LOOP;
  
  RAISE NOTICE '=== Backfill Complete ===';
  RAISE NOTICE 'Assignments completed: %', v_count;
  RAISE NOTICE 'Errors: %', v_errors;
END $$;

-- =====================================================
-- VERIFICATION (commented out - run manually if needed)
-- =====================================================

-- Check that assignments for past bookings are now completed:
-- SELECT bsa.id, sm.full_name, bsa.status, bsa.completed_at, b.lifecycle_status, b.event_date
-- FROM booking_staff_assignments bsa
-- JOIN staff_members sm ON sm.id = bsa.staff_id
-- JOIN bookings b ON b.id = bsa.booking_id
-- WHERE b.lifecycle_status IN ('in_progress', 'post_event', 'closed_review_complete')
-- ORDER BY b.event_date DESC;

-- Check that payroll items were generated:
-- SELECT sm.full_name, spi.pay_category, spi.amount, spi.description, spi.created_at
-- FROM staff_payroll_items spi
-- JOIN staff_members sm ON sm.id = spi.staff_id
-- ORDER BY spi.created_at DESC;
