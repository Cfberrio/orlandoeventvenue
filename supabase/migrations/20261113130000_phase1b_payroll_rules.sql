-- Phase 1B / payroll rules (ClickUp 86e40ach2): M-2, M-3, M-4, M-5, M-33.
--
-- Rule (D5 recommendation): pay only staff who accepted and whose event
-- happened. Existing lines are NOT touched here; the one-off clean-up of
-- current lines (M-6, the $280 on cancelled bookings, duplicates, rejected
-- but paid) waits for Luis's D5 list.

-- ---------------------------------------------------------------------------
-- M-3: complete only ACCEPTED assignments, and only once the event happened
-- (lifecycle reaches post_event / closed_review_complete), never on a
-- cancelled booking. Before: every non-cancelled assignment (pending and
-- rejected too) was completed the moment the booking went in_progress.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auto_complete_assignments_on_in_progress()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.lifecycle_status IN ('post_event', 'closed_review_complete')
     AND (OLD.lifecycle_status IS NULL
          OR OLD.lifecycle_status NOT IN ('post_event', 'closed_review_complete'))
     AND NEW.status <> 'cancelled'::booking_status THEN

    UPDATE public.booking_staff_assignments
    SET status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE booking_id = NEW.id
      AND status NOT IN ('cancelled', 'completed')
      AND response_status = 'accepted';
  END IF;

  RETURN NEW;
END;
$function$;

-- Pre-deploy review: staff who accept AFTER the event already closed would
-- never be completed (the booking trigger fired before they accepted).
CREATE OR REPLACE FUNCTION public.trg_complete_late_acceptance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.response_status = 'accepted'
     AND OLD.response_status IS DISTINCT FROM 'accepted'
     AND NEW.status NOT IN ('cancelled', 'completed')
     AND NEW.booking_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.bookings b
       WHERE b.id = NEW.booking_id
         AND b.lifecycle_status IN ('post_event', 'closed_review_complete')
         AND b.status <> 'cancelled'::booking_status
     ) THEN
    UPDATE public.booking_staff_assignments
    SET status = 'completed', completed_at = NOW(), updated_at = NOW()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_complete_late_acceptance ON public.booking_staff_assignments;
CREATE TRIGGER trg_complete_late_acceptance
  AFTER UPDATE OF response_status ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_complete_late_acceptance();

REVOKE ALL ON FUNCTION public.trg_complete_late_acceptance() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- M-4: void (delete) unpaid, system-generated pay lines when an assignment is
-- rejected or cancelled, or when its booking is cancelled. Bonus/deduction
-- lines and anything already paid are kept. Each void leaves a booking_event.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._void_unpaid_payroll(p_assignment_ids uuid[], p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  WITH voided AS (
    DELETE FROM public.staff_payroll_items p
    WHERE p.assignment_id = ANY (p_assignment_ids)
      AND COALESCE(p.paid_status, 'pending') <> 'paid'
      AND p.pay_category NOT IN ('bonus', 'deduction')
    RETURNING p.assignment_id, p.staff_id, p.pay_category, p.amount
  )
  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  SELECT a.booking_id, 'payroll_voided', 'system',
         jsonb_build_object(
           'assignment_id', v.assignment_id,
           'staff_id', v.staff_id,
           'reason', p_reason,
           'lines', count(*),
           'amount', sum(v.amount)
         )
  FROM voided v
  JOIN public.booking_staff_assignments a ON a.id = v.assignment_id
  WHERE a.booking_id IS NOT NULL
  GROUP BY a.booking_id, v.assignment_id, v.staff_id;
END;
$function$;

REVOKE ALL ON FUNCTION public._void_unpaid_payroll(uuid[], text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_void_payroll_on_assignment_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    PERFORM public._void_unpaid_payroll(ARRAY[NEW.id], 'assignment_cancelled');
  ELSIF NEW.response_status = 'rejected' AND OLD.response_status IS DISTINCT FROM 'rejected'
        AND NEW.status <> 'completed' THEN
    PERFORM public._void_unpaid_payroll(ARRAY[NEW.id], 'assignment_rejected');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_void_payroll_on_assignment_exit ON public.booking_staff_assignments;
CREATE TRIGGER trg_void_payroll_on_assignment_exit
  AFTER UPDATE OF status, response_status ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_void_payroll_on_assignment_exit();

CREATE OR REPLACE FUNCTION public.trg_void_payroll_on_booking_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  IF (NEW.status = 'cancelled'::booking_status AND OLD.status IS DISTINCT FROM NEW.status)
     OR (NEW.lifecycle_status = 'cancelled' AND OLD.lifecycle_status IS DISTINCT FROM NEW.lifecycle_status) THEN
    SELECT array_agg(id) INTO v_ids
    FROM public.booking_staff_assignments
    WHERE booking_id = NEW.id;
    IF v_ids IS NOT NULL THEN
      PERFORM public._void_unpaid_payroll(v_ids, 'booking_cancelled');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_void_payroll_on_booking_cancel ON public.bookings;
CREATE TRIGGER trg_void_payroll_on_booking_cancel
  AFTER UPDATE OF status, lifecycle_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_void_payroll_on_booking_cancel();

REVOKE ALL ON FUNCTION public.trg_void_payroll_on_assignment_exit() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_void_payroll_on_booking_cancel() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- M-5: the same person cannot hold the same role (and cleaning type) twice
-- on one booking.
-- A unique index is not possible yet (3 existing duplicates wait for D5), so
-- a BEFORE INSERT guard with a per-(booking, staff, role) advisory lock closes
-- the double-click race without touching existing rows.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_reject_duplicate_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.booking_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.booking_id::text || ':' || NEW.staff_id::text || ':' || NEW.assignment_role, 0)
  );
  IF EXISTS (
    SELECT 1 FROM public.booking_staff_assignments
    WHERE booking_id = NEW.booking_id
      AND staff_id = NEW.staff_id
      AND assignment_role = NEW.assignment_role
      AND cleaning_type IS NOT DISTINCT FROM NEW.cleaning_type
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'This staff member is already assigned to this booking as %', NEW.assignment_role
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_reject_duplicate_assignment ON public.booking_staff_assignments;
CREATE TRIGGER trg_reject_duplicate_assignment
  BEFORE INSERT ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_reject_duplicate_assignment();

REVOKE ALL ON FUNCTION public.trg_reject_duplicate_assignment() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- M-33: "Unassign Me" through the server. The browser delete was silently
-- blocked (anon has no DELETE policy). Refuses completed work or any paid /
-- manual pay line; records the event the office sees.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_unassign_self(p_assignment_id uuid, p_staff_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.booking_staff_assignments%ROWTYPE;
  v_staff_name text;
BEGIN
  SELECT * INTO v_row
  FROM public.booking_staff_assignments
  WHERE id = p_assignment_id AND staff_id = p_staff_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found for this staff member' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status = 'completed' THEN
    RAISE EXCEPTION 'This assignment is already completed; contact the office' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_payroll_items
    WHERE assignment_id = p_assignment_id
      AND (paid_status = 'paid' OR pay_category IN ('bonus', 'deduction'))
  ) THEN
    RAISE EXCEPTION 'This assignment has pay recorded; contact the office' USING ERRCODE = 'P0001';
  END IF;

  SELECT full_name INTO v_staff_name FROM public.staff_members WHERE id = p_staff_id;

  DELETE FROM public.booking_staff_assignments WHERE id = p_assignment_id;

  IF v_row.booking_id IS NOT NULL THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      v_row.booking_id,
      'staff_unassigned',
      'staff_portal',
      jsonb_build_object(
        'assignment_id', v_row.id,
        'staff_id', p_staff_id,
        'staff_name', v_staff_name,
        'staff_role', v_row.assignment_role,
        'unassigned_at', now(),
        'reason', 'Staff self-unassigned from booking'
      )
    );
  END IF;

  RETURN jsonb_build_object('assignment_id', v_row.id, 'booking_id', v_row.booking_id, 'removed', true);
END;
$function$;

REVOKE ALL ON FUNCTION public.staff_unassign_self(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_unassign_self(uuid, uuid) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- M-2: hourly pay uses the same hours the Staff tab shows. Order:
-- hours_worked (entered) → the assignment's own scheduled window (the custom
-- 12:00–14:00 on 9CMUGG) → package window. Overnight windows wrap +24h.
-- No booking-window fallback: an hourly line with no hours stays $0 and is
-- flagged at closeout (E-7, Phase 2), as before.
-- ---------------------------------------------------------------------------
DO $patch$
DECLARE
  v_def text;
  -- Built by concatenation: the live definition has a blank line holding 4
  -- spaces, which editors strip from a literal.
  v_old text := '    v_hours := COALESCE(v_assignment.hours_worked, 0);' || E'\n    \n'
    || '    IF v_hours = 0 AND v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL THEN' || E'\n'
    || '      v_hours := EXTRACT(EPOCH FROM (v_booking.package_end_time - v_booking.package_start_time)) / 3600.0;' || E'\n'
    || '    END IF;';
  v_new text := $new$    v_hours := COALESCE(v_assignment.hours_worked, 0);

    -- M-2 (86e40ach2): the assignment's own window first, as on the Staff tab.
    IF v_hours = 0 AND v_assignment.scheduled_start_time IS NOT NULL AND v_assignment.scheduled_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_assignment.scheduled_end_time - v_assignment.scheduled_start_time)) / 3600.0;
      IF v_hours < 0 THEN v_hours := v_hours + 24; END IF;
    END IF;

    IF v_hours = 0 AND v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_booking.package_end_time - v_booking.package_start_time)) / 3600.0;
      IF v_hours < 0 THEN v_hours := v_hours + 24; END IF;
    END IF;$new$;
BEGIN
  v_def := pg_get_functiondef('public.populate_staff_payroll_items(uuid,boolean)'::regprocedure);
  IF position('M-2 (86e40ach2)' IN v_def) > 0 THEN
    RAISE NOTICE 'populate_staff_payroll_items already patched for M-2';
    RETURN;
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'M-2 patch: expected hours block not found in populate_staff_payroll_items';
  END IF;
  EXECUTE replace(v_def, v_old, v_new);
END
$patch$;
