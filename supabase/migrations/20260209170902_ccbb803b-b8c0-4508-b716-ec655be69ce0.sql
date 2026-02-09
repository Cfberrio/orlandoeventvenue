
-- Drop existing triggers if they exist, then recreate
DROP TRIGGER IF EXISTS trg_auto_complete_assignments_on_in_progress ON public.bookings;
DROP TRIGGER IF EXISTS trg_populate_payroll_on_completion ON public.booking_staff_assignments;
DROP TRIGGER IF EXISTS trg_auto_complete_on_standalone_report ON public.standalone_cleaning_reports;

-- 1. Trigger: auto-complete assignments when booking goes to in_progress
CREATE TRIGGER trg_auto_complete_assignments_on_in_progress
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_complete_assignments_on_in_progress();

-- 2. Trigger: populate payroll when assignment status changes to completed
CREATE TRIGGER trg_populate_payroll_on_completion
  AFTER UPDATE ON public.booking_staff_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_populate_payroll_on_completion();

-- 3. Function + Trigger for standalone cleaning reports
CREATE OR REPLACE FUNCTION public.auto_complete_assignment_on_standalone_report()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status != 'completed') THEN
    UPDATE public.booking_staff_assignments
    SET status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = NEW.assignment_id
      AND status != 'completed'
      AND status != 'cancelled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_complete_on_standalone_report
  AFTER UPDATE ON public.standalone_cleaning_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_complete_assignment_on_standalone_report();

-- 4. Backfill: complete assignments for bookings already past in_progress
DO $$
DECLARE
  v_assignment RECORD;
  v_count INTEGER := 0;
BEGIN
  FOR v_assignment IN
    SELECT bsa.id
    FROM public.booking_staff_assignments bsa
    JOIN public.bookings b ON b.id = bsa.booking_id
    WHERE b.lifecycle_status IN ('in_progress', 'post_event', 'closed_review_complete')
      AND bsa.status NOT IN ('completed', 'cancelled')
  LOOP
    UPDATE public.booking_staff_assignments
    SET status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = v_assignment.id;
    v_count := v_count + 1;
  END LOOP;
  RAISE NOTICE 'Backfill: completed % assignments', v_count;
END;
$$;
