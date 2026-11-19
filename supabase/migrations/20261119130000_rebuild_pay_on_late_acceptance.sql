-- =============================================================================
-- ClickUp 1dfqjx6vh17 — follow-up to 20261119120000
--
-- Since 20261119120000 a completed assignment whose staff never accepted has no
-- base pay line (trg_payroll_requires_acceptance skips it). When that staff
-- member later accepts — from the staff portal (staff_respond_to_assignment),
-- the office button (admin_record_staff_response) or any other path — the pay
-- line must come back. trg_complete_late_acceptance only handles assignments
-- that are NOT completed yet, so this trigger covers the completed ones.
--
-- Never blocks the acceptance: if the rebuild fails it is logged, not raised.
-- Never touches a paid line (populate refuses, and we skip it up front).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_rebuild_pay_on_late_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.response_status = 'accepted'
     AND OLD.response_status IS DISTINCT FROM 'accepted'
     AND NEW.status = 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_payroll_items
        WHERE assignment_id = NEW.id AND paid_status = 'paid'
          AND pay_category NOT IN ('bonus', 'deduction')
     ) THEN
    BEGIN
      PERFORM public.populate_staff_payroll_items(NEW.id, false);
    EXCEPTION WHEN OTHERS THEN
      IF NEW.booking_id IS NOT NULL THEN
        INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
        VALUES (NEW.booking_id, 'payroll_rebuild_failed', 'system',
                jsonb_build_object('assignment_id', NEW.id, 'error', SQLERRM));
      END IF;
      RAISE WARNING 'pay rebuild failed for assignment %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_rebuild_pay_on_late_acceptance ON public.booking_staff_assignments;
CREATE TRIGGER trg_rebuild_pay_on_late_acceptance
  AFTER UPDATE OF response_status ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_pay_on_late_acceptance();

REVOKE ALL ON FUNCTION public.trg_rebuild_pay_on_late_acceptance() FROM PUBLIC, anon, authenticated;

-- The office path no longer needs its own rebuild (the trigger above runs for
-- it too); drop the duplicate call so the work happens once.
DO $mig$
DECLARE
  v_def text := pg_get_functiondef('public.admin_record_staff_response(uuid,text,text)'::regprocedure);
  v_old text := $old$  IF p_response = 'accepted' AND v_row.status = 'completed'
     AND NOT EXISTS (
       SELECT 1 FROM public.staff_payroll_items
        WHERE assignment_id = v_row.id AND paid_status = 'paid'
          AND pay_category NOT IN ('bonus', 'deduction')
     ) THEN
    PERFORM public.populate_staff_payroll_items(v_row.id, false);
  END IF;
$old$;
BEGIN
  IF position(v_old IN v_def) = 0 THEN
    IF position('populate_staff_payroll_items' IN v_def) = 0 THEN
      RETURN; -- already applied
    END IF;
    RAISE EXCEPTION 'admin_record_staff_response changed; rebuild block not found';
  END IF;
  EXECUTE replace(v_def, v_old, '');
END
$mig$;

-- Known, accepted: Mark paid (locks the line, then FOR SHARE on the
-- assignment) racing a recalculation of the SAME assignment (locks the
-- assignment, then its lines) can deadlock; Postgres aborts one with an error
-- and rolls it back cleanly. No money moves wrongly; the user retries.
