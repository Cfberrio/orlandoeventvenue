
-- When a booking transitions to 'in_progress', auto-complete all its staff assignments
-- This triggers the existing payroll generation trigger (trg_populate_payroll_on_completion)

CREATE OR REPLACE FUNCTION public.auto_complete_assignments_on_in_progress()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  -- Only fire when lifecycle_status changes TO 'in_progress'
  IF NEW.lifecycle_status = 'in_progress' 
     AND (OLD.lifecycle_status IS NULL OR OLD.lifecycle_status != 'in_progress') THEN
    
    -- Mark all non-cancelled assignments as completed
    UPDATE public.booking_staff_assignments
    SET 
      status = 'completed',
      completed_at = NOW(),
      updated_at = NOW()
    WHERE booking_id = NEW.id
      AND status != 'cancelled'
      AND status != 'completed';
    
    RAISE NOTICE '[AUTO-COMPLETE] Marked assignments completed for booking % on in_progress transition', NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create the trigger on bookings table
CREATE TRIGGER trg_auto_complete_assignments_on_in_progress
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_complete_assignments_on_in_progress();
