-- ClickUp 86e40ach2, second pass, staff batch (ST2). Idempotent.
-- Every CREATE OR REPLACE below is based on the production definition read
-- with pg_get_functiondef on 2026-11-19.

-- ---------------------------------------------------------------------------
-- 1. Staff notice outbox (ST2-10, ST2-16, ST2-17, ST2-25)
-- The DB queues a row; the send-staff-notices edge function claims and sends
-- it. Only rows the DB wrote are ever sent, so the endpoint needs no input.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('staff_response', 'office_recorded_response', 'booking_cancelled',
                                     'assignment_removed', 'staff_unassigned', 'pending_digest', 'pending_escalation')),
  recipient text NOT NULL CHECK (recipient IN ('staff', 'office')),
  staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  assignment_id uuid,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS staff_notifications_status_created_idx ON public.staff_notifications (status, created_at);
ALTER TABLE public.staff_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_notifications FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.staff_notifications TO service_role;

CREATE OR REPLACE FUNCTION public._kick_staff_notices()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  BEGIN
    PERFORM net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-staff-notices',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('source', 'db')
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'staff notice kick failed: %', SQLERRM;
  END;
END;
$function$;
REVOKE ALL ON FUNCTION public._kick_staff_notices() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._queue_staff_notice(
  p_kind text, p_recipient text, p_staff_id uuid, p_booking_id uuid, p_assignment_id uuid,
  p_payload jsonb, p_dedupe_key text, p_kick boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF COALESCE(current_setting('oev.staff_notice_silent', true), '') = 'on' THEN
    RETURN false;
  END IF;
  BEGIN
    INSERT INTO public.staff_notifications (kind, recipient, staff_id, booking_id, assignment_id, payload, dedupe_key)
    VALUES (p_kind, p_recipient, p_staff_id, p_booking_id, p_assignment_id, COALESCE(p_payload, '{}'::jsonb), p_dedupe_key)
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING id INTO v_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'staff notice not queued (%): %', p_kind, SQLERRM;
    RETURN false;
  END;
  IF v_id IS NOT NULL AND p_kick THEN
    PERFORM public._kick_staff_notices();
  END IF;
  RETURN v_id IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public._queue_staff_notice(text, text, uuid, uuid, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._staff_notice_payload(p_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
  SELECT jsonb_build_object(
    'staff_name', s.full_name,
    'role', a.assignment_role,
    'reservation_number', b.reservation_number,
    'event_date', COALESCE(b.event_date, a.scheduled_date),
    'start_time', COALESCE(a.scheduled_start_time, b.start_time),
    'end_time', COALESCE(a.scheduled_end_time, b.end_time)
  )
  FROM public.booking_staff_assignments a
  LEFT JOIN public.staff_members s ON s.id = a.staff_id
  LEFT JOIN public.bookings b ON b.id = a.booking_id
  WHERE a.id = p_assignment_id;
$function$;
REVOKE ALL ON FUNCTION public._staff_notice_payload(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_staff_notifications(p_limit integer DEFAULT 25)
 RETURNS SETOF public.staff_notifications
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY
  UPDATE public.staff_notifications n
     SET status = 'sending', claimed_at = now(), attempts = n.attempts + 1
   WHERE n.id IN (
     SELECT q.id FROM public.staff_notifications q
      WHERE q.status = 'pending'
         OR (q.status = 'sending' AND q.claimed_at < now() - interval '10 minutes' AND q.attempts < 5)
         OR (q.status = 'failed' AND q.attempts < 3 AND q.claimed_at < now() - interval '30 minutes')
      ORDER BY q.created_at
      LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 25), 100))
      FOR UPDATE SKIP LOCKED)
  RETURNING n.*;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_staff_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_staff_notifications(integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. ST2-03: populate_staff_payroll_items no longer reads v_booking for a
--    standalone job (booking_id IS NULL). An hourly standalone job with no
--    hours and no times gets no line (listed by admin_assignments_missing_hours)
--    instead of aborting "Mark complete". Pay rules are otherwise unchanged.
-- ---------------------------------------------------------------------------
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
  v_flat_rate DECIMAL(10,2);
BEGIN
  IF pg_trigger_depth() = 0 THEN
    PERFORM public._assert_admin_or_service();
  END IF;
  SELECT * INTO v_assignment
  FROM public.booking_staff_assignments
  WHERE id = p_assignment_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found: %', p_assignment_id;
  END IF;
  SELECT * INTO v_staff
  FROM public.staff_members
  WHERE id = v_assignment.staff_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found: %', v_assignment.staff_id;
  END IF;
  IF v_staff.payroll_type = 'none' AND v_assignment.pay_override_mode IS NULL THEN
    RAISE NOTICE 'Staff % has payroll_type=none, skipping payroll calculation', v_staff.full_name;
    RETURN;
  END IF;
  IF v_assignment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_assignment.booking_id;
  END IF;
  PERFORM 1 FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM public.staff_payroll_items
    WHERE assignment_id = p_assignment_id
      AND paid_status = 'paid'
      AND pay_category NOT IN ('bonus', 'deduction')
  ) THEN
    IF pg_trigger_depth() = 0 THEN
      RAISE EXCEPTION 'Payroll for assignment % is already paid; add a bonus or deduction instead of recalculating', p_assignment_id
        USING ERRCODE = 'P0001';
    END IF;
    RAISE NOTICE 'Payroll for assignment % already paid; not recalculated', p_assignment_id;
    RETURN;
  END IF;
  DELETE FROM public.staff_payroll_items
  WHERE assignment_id = p_assignment_id
    AND pay_category NOT IN ('bonus', 'deduction')
    AND paid_status IS DISTINCT FROM 'paid';
  IF v_assignment.pay_override_mode = 'excluded' THEN
    RETURN;
  END IF;
  IF v_assignment.pay_override_mode = 'override' THEN
    IF v_assignment.pay_override_amount > 0 THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type, amount, description, metadata, is_historical
      ) VALUES (
        p_assignment_id, v_assignment.staff_id, 'base_pay', 'fixed', v_assignment.pay_override_amount,
        'Agreed amount: ' || v_assignment.pay_override_reason,
        jsonb_build_object('override', true, 'override_by', v_assignment.pay_override_by, 'override_at', v_assignment.pay_override_at),
        p_is_historical
      );
    END IF;
    RETURN;
  END IF;
  IF v_staff.payroll_type = 'hourly' THEN
    v_hourly_rate := COALESCE(v_staff.hourly_rate, 50.00);
    v_hours := COALESCE(v_assignment.hours_worked, 0);
    IF v_hours = 0 AND v_assignment.scheduled_start_time IS NOT NULL AND v_assignment.scheduled_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_assignment.scheduled_end_time - v_assignment.scheduled_start_time)) / 3600.0;
      IF v_hours < 0 THEN v_hours := v_hours + 24; END IF;
    END IF;
    -- ST2-03: a standalone job has no booking row; never read v_booking then.
    IF v_hours = 0 AND v_assignment.booking_id IS NOT NULL THEN
      IF v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL THEN
        v_hours := EXTRACT(EPOCH FROM (v_booking.package_end_time - v_booking.package_start_time)) / 3600.0;
        IF v_hours < 0 THEN v_hours := v_hours + 24; END IF;
      END IF;
    END IF;
    IF v_hours > 0 THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type,
        amount, hours, rate, description, is_historical
      )
      VALUES (
        p_assignment_id,
        v_assignment.staff_id,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'hourly_bar_vendor' ELSE 'hourly_production' END,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'bar_vendor' ELSE 'production' END,
        v_hours * v_hourly_rate,
        v_hours,
        v_hourly_rate,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'Bar Vendor Services' ELSE 'Production Services' END,
        p_is_historical
      );
    END IF;
  ELSIF v_staff.payroll_type = 'per_assignment' THEN
    IF v_assignment.assignment_role = 'Bar Vendor' THEN
      v_flat_rate := COALESCE(v_staff.hourly_rate, 0);
      IF v_flat_rate > 0 THEN
        INSERT INTO public.staff_payroll_items (
          assignment_id, staff_id, pay_category, pay_type,
          amount, description, is_historical
        )
        VALUES (
          p_assignment_id,
          v_assignment.staff_id,
          'bar_vendor_flat',
          'fixed',
          v_flat_rate,
          'Bar Vendor Assignment – Flat Rate ($' || v_flat_rate::text || ')',
          p_is_historical
        );
      END IF;
    ELSIF v_assignment.assignment_role = 'Assistant' THEN
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

-- ---------------------------------------------------------------------------
-- 3. ST2-04: a job created directly as "completed" gets its pay line.
--    The UPDATE trigger only fires on a status change, so the two never both
--    fire for the same write; populate is delete-and-rebuild either way.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trigger_populate_payroll_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NEW.status = 'completed' THEN
    PERFORM public.populate_staff_payroll_items(NEW.id, false);
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.trigger_populate_payroll_on_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS auto_calculate_payroll_on_insert ON public.booking_staff_assignments;
CREATE TRIGGER auto_calculate_payroll_on_insert
  AFTER INSERT ON public.booking_staff_assignments
  FOR EACH ROW WHEN (NEW.status = 'completed')
  EXECUTE FUNCTION public.trigger_populate_payroll_on_insert();

-- ---------------------------------------------------------------------------
-- 4. ST2-08: one live assignment per person per booking, any role or
--    cleaning type, checked on INSERT and on UPDATE. Existing duplicates
--    (VDGPSR, 3D7T9C, 2BSTJF) are left for Luis: editing other columns of
--    those rows is not re-checked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_reject_duplicate_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
BEGIN
  IF NEW.booking_id IS NULL OR NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.booking_id IS NOT DISTINCT FROM OLD.booking_id
     AND NEW.staff_id IS NOT DISTINCT FROM OLD.staff_id
     AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.booking_id::text || ':' || NEW.staff_id::text, 0)
  );
  SELECT assignment_role INTO v_role
    FROM public.booking_staff_assignments
   WHERE booking_id = NEW.booking_id
     AND staff_id = NEW.staff_id
     AND status <> 'cancelled'
     AND id <> NEW.id
   LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'This staff member is already assigned to this booking (as %). One person can have only one assignment per booking; change or remove the existing one first.', v_role
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS trg_reject_duplicate_assignment ON public.booking_staff_assignments;
CREATE TRIGGER trg_reject_duplicate_assignment
  BEFORE INSERT OR UPDATE OF booking_id, staff_id, status ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_reject_duplicate_assignment();

-- ---------------------------------------------------------------------------
-- 5. ST2-09: when the office changes a completed assignment's hours or times,
--    rebuild its unpaid calculated lines through populate_staff_payroll_items.
--    Paid lines are never touched; that case is logged for the office.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_rebuild_pay_on_hours_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed' THEN
    RETURN NULL;
  END IF;
  IF NEW.scheduled_start_time IS NOT DISTINCT FROM OLD.scheduled_start_time
     AND NEW.scheduled_end_time IS NOT DISTINCT FROM OLD.scheduled_end_time
     AND NEW.hours_worked IS NOT DISTINCT FROM OLD.hours_worked THEN
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.staff_payroll_items
     WHERE assignment_id = NEW.id AND paid_status = 'paid'
       AND pay_category NOT IN ('bonus', 'deduction')
  ) THEN
    IF NEW.booking_id IS NOT NULL THEN
      INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
      VALUES (NEW.booking_id, 'payroll_not_rebuilt_paid', 'system',
              jsonb_build_object('assignment_id', NEW.id, 'staff_id', NEW.staff_id,
                                 'reason', 'hours changed after the pay line was paid'));
    END IF;
    RETURN NULL;
  END IF;
  BEGIN
    PERFORM public.populate_staff_payroll_items(NEW.id, false);
  EXCEPTION WHEN OTHERS THEN
    IF NEW.booking_id IS NOT NULL THEN
      INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
      VALUES (NEW.booking_id, 'payroll_rebuild_failed', 'system',
              jsonb_build_object('assignment_id', NEW.id, 'error', SQLERRM, 'source', 'hours_change'));
    END IF;
    RAISE WARNING 'pay rebuild after hours change failed for assignment %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_rebuild_pay_on_hours_change() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rebuild_pay_on_hours_change ON public.booking_staff_assignments;
CREATE TRIGGER trg_rebuild_pay_on_hours_change
  AFTER UPDATE OF scheduled_start_time, scheduled_end_time, hours_worked ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_rebuild_pay_on_hours_change();

-- ---------------------------------------------------------------------------
-- 6. ST2-20: bar vendors are exempt from the acceptance gate (readiness and
--    trg_payroll_requires_acceptance skip bar_service), so their work also
--    completes without an Accept tap, unless they declined.
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
     AND NEW.status <> 'cancelled'::booking_status
     -- Codex review: lifecycle can be set by hand, so the label alone is not
     -- proof the work happened. A booking closed early is completed by the
     -- hourly sweep once the event really ends.
     AND public._booking_event_end_at(NEW.id) <= now() THEN

    UPDATE public.booking_staff_assignments
    SET status = 'completed',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE booking_id = NEW.id
      AND status NOT IN ('cancelled', 'completed')
      AND (response_status = 'accepted'
           OR (assignment_type = 'bar_service' AND COALESCE(response_status, 'pending') <> 'rejected'));
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_past_event_assignments()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer := 0;
  v_booking_id uuid;
  v_n integer;
BEGIN
  FOR v_booking_id IN
    SELECT b.id
    FROM public.bookings b
    WHERE b.lifecycle_status IN ('post_event', 'closed_review_complete')
      AND b.status <> 'cancelled'::booking_status
      AND EXISTS (
        SELECT 1 FROM public.booking_staff_assignments a
        WHERE a.booking_id = b.id
          AND a.status NOT IN ('cancelled', 'completed')
          AND (a.response_status = 'accepted'
               OR (a.assignment_type = 'bar_service' AND COALESCE(a.response_status, 'pending') <> 'rejected'))
      )
    FOR UPDATE OF b SKIP LOCKED
  LOOP
  UPDATE public.booking_staff_assignments a
  SET status = 'completed', completed_at = NOW(), updated_at = NOW()
  FROM public.bookings b
  WHERE b.id = a.booking_id
    AND b.id = v_booking_id
    AND b.lifecycle_status IN ('post_event', 'closed_review_complete')
    AND b.status <> 'cancelled'::booking_status
    AND public._booking_event_end_at(b.id) <= now()
    AND public._booking_event_end_at(b.id) >= timestamptz '2026-11-12 00:00:00 America/New_York'
    AND a.status NOT IN ('cancelled', 'completed')
    AND (a.response_status = 'accepted'
         OR (a.assignment_type = 'bar_service' AND COALESCE(a.response_status, 'pending') <> 'rejected'));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  v_count := v_count + v_n;
  END LOOP;
  RETURN v_count;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 7. ST2-11: no invented 24h deadline on new assignments.
-- ---------------------------------------------------------------------------
ALTER TABLE public.booking_staff_assignments ALTER COLUMN response_due_at DROP DEFAULT;

-- ---------------------------------------------------------------------------
-- 8. Staff RPCs: is_active (ST2-24), idempotent answer + office notice from
--    the DB (ST2-16), unassign window + office notice (ST2-25).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_respond_to_assignment(p_assignment_id uuid, p_staff_id uuid, p_response text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.booking_staff_assignments%ROWTYPE;
  v_staff public.staff_members%ROWTYPE;
  v_old text;
BEGIN
  IF p_response IS NULL OR p_response NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid response: %', p_response USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_staff FROM public.staff_members WHERE id = p_staff_id;
  IF NOT FOUND OR NOT v_staff.is_active THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;

  SELECT response_status INTO v_old
    FROM public.booking_staff_assignments
   WHERE id = p_assignment_id
     AND staff_id = p_staff_id
     AND status <> 'cancelled'
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found for this staff member' USING ERRCODE = 'P0002';
  END IF;

  IF v_old IS NOT DISTINCT FROM p_response THEN
    SELECT * INTO v_row FROM public.booking_staff_assignments WHERE id = p_assignment_id;
    RETURN jsonb_build_object(
      'assignment_id', v_row.id,
      'booking_id', v_row.booking_id,
      'response_status', v_row.response_status,
      'response_at', v_row.response_at,
      'changed', false
    );
  END IF;

  UPDATE public.booking_staff_assignments
  SET response_status = p_response,
      response_at = now(),
      updated_at = now()
  WHERE id = p_assignment_id
  RETURNING * INTO v_row;

  IF v_row.booking_id IS NOT NULL THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      v_row.booking_id,
      CASE WHEN p_response = 'accepted' THEN 'staff_assignment_accepted' ELSE 'staff_assignment_rejected' END,
      'staff_portal',
      jsonb_build_object(
        'assignment_id', v_row.id,
        'staff_id', p_staff_id,
        'staff_name', v_staff.full_name,
        'assignment_role', v_row.assignment_role,
        'responded_at', v_row.response_at
      )
    );
    PERFORM public._queue_staff_notice(
      'staff_response', 'office', p_staff_id, v_row.booking_id, v_row.id,
      public._staff_notice_payload(v_row.id) || jsonb_build_object('response', p_response),
      'response:' || v_row.id || ':' || p_response || ':' || floor(extract(epoch FROM v_row.response_at))::bigint
    );
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', v_row.id,
    'booking_id', v_row.booking_id,
    'response_status', v_row.response_status,
    'response_at', v_row.response_at,
    'changed', true
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_unassign_self(p_assignment_id uuid, p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.booking_staff_assignments%ROWTYPE;
  v_staff public.staff_members%ROWTYPE;
  v_start timestamptz;
  v_payload jsonb;
BEGIN
  SELECT * INTO v_staff FROM public.staff_members WHERE id = p_staff_id;
  IF NOT FOUND OR NOT v_staff.is_active THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;

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

  IF v_row.booking_id IS NOT NULL THEN
    SELECT (b.event_date + COALESCE(b.start_time, time '00:00')) AT TIME ZONE 'America/New_York'
      INTO v_start FROM public.bookings b WHERE b.id = v_row.booking_id;
  ELSIF v_row.scheduled_date IS NOT NULL THEN
    v_start := (v_row.scheduled_date + COALESCE(v_row.scheduled_start_time, time '00:00')) AT TIME ZONE 'America/New_York';
  END IF;
  IF v_start IS NOT NULL AND v_start < now() + interval '48 hours' THEN
    RAISE EXCEPTION 'You can no longer unassign yourself: the work starts in less than 48 hours or has already started. Please call the office at (407) 974-5979.'
      USING ERRCODE = 'P0001';
  END IF;

  v_payload := public._staff_notice_payload(p_assignment_id);

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
        'staff_name', v_staff.full_name,
        'staff_role', v_row.assignment_role,
        'unassigned_at', now(),
        'reason', 'Staff self-unassigned from booking'
      )
    );
    PERFORM public._queue_staff_notice(
      'staff_unassigned', 'office', p_staff_id, v_row.booking_id, v_row.id,
      v_payload, 'unassign:' || v_row.id
    );
  END IF;

  RETURN jsonb_build_object('assignment_id', v_row.id, 'booking_id', v_row.booking_id, 'removed', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.staff_mark_bar_contacted(p_assignment_id uuid, p_staff_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.booking_staff_assignments%ROWTYPE;
  v_staff_name text;
  v_now timestamptz := now();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members WHERE id = p_staff_id AND is_active) THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;

  UPDATE public.booking_staff_assignments
  SET customer_contacted = true,
      customer_contacted_at = v_now,
      customer_contacted_by = p_staff_id,
      updated_at = v_now
  WHERE id = p_assignment_id
    AND staff_id = p_staff_id
    AND assignment_type = 'bar_service'
    AND status <> 'cancelled'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bar assignment not found for this staff member' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET bar_customer_contacted = true,
        bar_customer_contacted_at = v_now,
        bar_customer_contacted_by = p_staff_id
    WHERE id = v_row.booking_id;

    SELECT full_name INTO v_staff_name FROM public.staff_members WHERE id = p_staff_id;
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      v_row.booking_id,
      'bar_customer_contacted',
      'staff_portal',
      jsonb_build_object('staff_id', p_staff_id, 'staff_name', v_staff_name, 'contacted_at', v_now)
    );
  END IF;

  RETURN jsonb_build_object('assignment_id', v_row.id, 'booking_id', v_row.booking_id, 'contacted_at', v_now);
END;
$function$;

-- ST2-17: an answer the office records is sent to the staff member.
CREATE OR REPLACE FUNCTION public.admin_record_staff_response(p_assignment_id uuid, p_response text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_old public.booking_staff_assignments%ROWTYPE;
  v_row public.booking_staff_assignments%ROWTYPE;
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_name text;
BEGIN
  PERFORM public._assert_admin_or_service();
  IF p_response IS NULL OR p_response NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'response must be accepted or rejected' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.booking_staff_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_old.status = 'cancelled' THEN
    RAISE EXCEPTION 'this assignment was cancelled' USING ERRCODE = 'P0001';
  END IF;
  IF v_old.response_status IS NOT DISTINCT FROM p_response THEN
    RETURN jsonb_build_object('changed', false, 'assignment_id', v_old.id,
                              'booking_id', v_old.booking_id, 'response_status', v_old.response_status);
  END IF;

  UPDATE public.booking_staff_assignments
     SET response_status = p_response,
         response_at = now(),
         updated_at = now()
   WHERE id = p_assignment_id
  RETURNING * INTO v_row;


  IF v_row.booking_id IS NOT NULL THEN
    SELECT full_name INTO v_name FROM public.staff_members WHERE id = v_row.staff_id;
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      v_row.booking_id,
      CASE WHEN p_response = 'accepted' THEN 'staff_assignment_accepted' ELSE 'staff_assignment_rejected' END,
      'admin',
      jsonb_build_object(
        'assignment_id', v_row.id,
        'staff_id', v_row.staff_id,
        'staff_name', v_name,
        'assignment_role', v_row.assignment_role,
        'responded_at', v_row.response_at,
        'previous_response', v_old.response_status,
        'recorded_by_office', true,
        'recorded_by', auth.uid(),
        'note', v_note
      )
    );
    IF public._booking_event_end_at(v_row.booking_id) > now() THEN
      PERFORM public._queue_staff_notice(
        'office_recorded_response', 'staff', v_row.staff_id, v_row.booking_id, v_row.id,
        public._staff_notice_payload(v_row.id) || jsonb_build_object('response', p_response),
        'office_response:' || v_row.id || ':' || p_response || ':' || floor(extract(epoch FROM v_row.response_at))::bigint
      );
    END IF;
  END IF;

  RETURN jsonb_build_object('changed', true, 'assignment_id', v_row.id,
                            'booking_id', v_row.booking_id, 'response_status', v_row.response_status);
END;
$function$;

-- ---------------------------------------------------------------------------
-- 9. ST2-17: staff are told when their booking is cancelled or the office
--    cancels their assignment (future events only, not after they declined).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_staff_notice_on_assignment_cancel()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_booking_cancelled boolean;
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled'
     AND NEW.booking_id IS NOT NULL
     AND COALESCE(OLD.response_status, 'pending') <> 'rejected'
     AND public._booking_event_end_at(NEW.booking_id) > now() THEN
    SELECT (b.status = 'cancelled'::booking_status OR b.lifecycle_status = 'cancelled')
      INTO v_booking_cancelled
      FROM public.bookings b WHERE b.id = NEW.booking_id;
    PERFORM public._queue_staff_notice(
      CASE WHEN COALESCE(v_booking_cancelled, false) THEN 'booking_cancelled' ELSE 'assignment_removed' END,
      'staff', NEW.staff_id, NEW.booking_id, NEW.id,
      public._staff_notice_payload(NEW.id), 'cancel:' || NEW.id
    );
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_staff_notice_on_assignment_cancel() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_staff_notice_on_assignment_cancel ON public.booking_staff_assignments;
CREATE TRIGGER trg_staff_notice_on_assignment_cancel
  AFTER UPDATE OF status ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_staff_notice_on_assignment_cancel();

-- ---------------------------------------------------------------------------
-- 10. ST2-19: deletes go through an RPC that refuses paid work and records
--     what was removed. A delete guard covers every other path too.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.staff_assignment_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  booking_id uuid,
  staff_id uuid,
  assignment jsonb NOT NULL,
  removed_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  reason text,
  deleted_by uuid,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.staff_assignment_deletions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.staff_assignment_deletions FROM PUBLIC, anon;
GRANT SELECT ON public.staff_assignment_deletions TO authenticated;
GRANT ALL ON public.staff_assignment_deletions TO service_role;
DROP POLICY IF EXISTS "Admin can view assignment deletions" ON public.staff_assignment_deletions;
CREATE POLICY "Admin can view assignment deletions" ON public.staff_assignment_deletions
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.trg_block_delete_paid_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM public.staff_payroll_items WHERE assignment_id = OLD.id AND paid_status = 'paid') THEN
    RAISE EXCEPTION 'This assignment has paid pay lines, so it cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION public.trg_block_delete_paid_assignment() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_block_delete_paid_assignment ON public.booking_staff_assignments;
CREATE TRIGGER trg_block_delete_paid_assignment
  BEFORE DELETE ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.trg_block_delete_paid_assignment();

CREATE OR REPLACE FUNCTION public.admin_delete_staff_assignment(p_assignment_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_a public.booking_staff_assignments%ROWTYPE;
  v_lines jsonb;
  v_amount numeric;
  v_payload jsonb;
  v_notify boolean;
  v_reason text := NULLIF(btrim(COALESCE(p_reason, '')), '');
BEGIN
  PERFORM public._assert_admin_or_service();
  SELECT * INTO v_a FROM public.booking_staff_assignments WHERE id = p_assignment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id AND paid_status = 'paid') THEN
    RAISE EXCEPTION 'This assignment has paid pay lines, so it cannot be deleted. Keep it, or use Undo paid on those lines first.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', p.id, 'pay_category', p.pay_category, 'amount', p.amount,
                                               'paid_status', p.paid_status, 'description', p.description)), '[]'::jsonb),
         COALESCE(sum(p.amount), 0)
    INTO v_lines, v_amount
    FROM public.staff_payroll_items p WHERE p.assignment_id = p_assignment_id;
  v_payload := public._staff_notice_payload(p_assignment_id);
  v_notify := v_a.booking_id IS NOT NULL
              AND v_a.status NOT IN ('cancelled', 'completed')
              AND COALESCE(v_a.response_status, 'pending') <> 'rejected'
              AND public._booking_event_end_at(v_a.booking_id) > now();

  INSERT INTO public.staff_assignment_deletions (assignment_id, booking_id, staff_id, assignment, removed_lines, reason, deleted_by)
  VALUES (v_a.id, v_a.booking_id, v_a.staff_id, to_jsonb(v_a), v_lines, v_reason, auth.uid());

  DELETE FROM public.booking_staff_assignments WHERE id = p_assignment_id;

  IF v_a.booking_id IS NOT NULL THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (v_a.booking_id, 'staff_assignment_deleted', 'admin', jsonb_build_object(
      'assignment_id', v_a.id, 'staff_id', v_a.staff_id, 'staff_name', v_payload->>'staff_name',
      'assignment_role', v_a.assignment_role, 'removed_lines', jsonb_array_length(v_lines),
      'removed_amount', v_amount, 'reason', v_reason, 'deleted_by', auth.uid()));
  END IF;
  IF v_notify THEN
    PERFORM public._queue_staff_notice('assignment_removed', 'staff', v_a.staff_id, v_a.booking_id, v_a.id,
                                       v_payload, 'removed:' || v_a.id);
  END IF;

  RETURN jsonb_build_object('deleted', true, 'assignment_id', v_a.id,
                            'removed_lines', jsonb_array_length(v_lines), 'removed_amount', v_amount);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_delete_staff_assignment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_staff_assignment(uuid, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 11. ST2-18: My Payments excludes cancelled bookings and returns the answer
--     so the portal can label lines that are waiting for acceptance.
--     (Return type changes, so drop and recreate with the same grants.)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_staff_payroll_line_items(uuid, date, date);
CREATE FUNCTION public.get_staff_payroll_line_items(p_staff_id uuid, p_start_date date, p_end_date date)
 RETURNS TABLE(staff_name text, staff_role text, payroll_type text, assignment_date date, booking_id uuid, assignment_id uuid, reservation_number text, assignment_type text, pay_category text, pay_type text, amount numeric, hours numeric, rate numeric, description text, assignment_status text, paid_status text, paid_at timestamp with time zone, payroll_item_id uuid, created_at timestamp with time zone, response_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) AS assignment_date,
    bsa.booking_id,
    bsa.id AS assignment_id,
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
    spi.id AS payroll_item_id,
    spi.created_at,
    bsa.response_status
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE sm.id = p_staff_id
    AND COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
    AND bsa.status != 'cancelled'
    AND (b.id IS NULL OR (b.status <> 'cancelled'::booking_status AND b.lifecycle_status IS DISTINCT FROM 'cancelled'))
  ORDER BY assignment_date DESC, spi.created_at;
$function$;
GRANT EXECUTE ON FUNCTION public.get_staff_payroll_line_items(uuid, date, date) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. ST2-27: staff read their standalone report through an RPC (they are
--     anonymous, so the auth.uid() table policy never matched).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_get_standalone_cleaning_report(p_staff_id uuid, p_assignment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members WHERE id = p_staff_id AND is_active) THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.booking_staff_assignments
                  WHERE id = p_assignment_id AND staff_id = p_staff_id AND booking_id IS NULL) THEN
    RAISE EXCEPTION 'This assignment is not yours' USING ERRCODE = '42501';
  END IF;
  SELECT to_jsonb(r) INTO v FROM public.standalone_cleaning_reports r WHERE r.assignment_id = p_assignment_id;
  RETURN v;
END;
$function$;
REVOKE ALL ON FUNCTION public.staff_get_standalone_cleaning_report(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_get_standalone_cleaning_report(uuid, uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. ST2-21: completed work by someone on pay type "none" (last 45 days).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_completed_work_without_pay()
 RETURNS TABLE(assignment_id uuid, booking_id uuid, reservation_number text, work_date date, staff_id uuid, staff_name text, assignment_role text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path = public
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY
  SELECT a.id, b.id, b.reservation_number, COALESCE(b.event_date, a.scheduled_date, a.completed_at::date),
         s.id, s.full_name, a.assignment_role
  FROM public.booking_staff_assignments a
  JOIN public.staff_members s ON s.id = a.staff_id
  LEFT JOIN public.bookings b ON b.id = a.booking_id
  WHERE a.status = 'completed'
    AND s.payroll_type = 'none'
    AND a.pay_override_mode IS NULL
    AND COALESCE(b.event_date, a.scheduled_date, a.completed_at::date) >= (now() AT TIME ZONE 'America/New_York')::date - 45
    AND NOT EXISTS (
      SELECT 1 FROM public.staff_payroll_items p
      WHERE p.assignment_id = a.id AND p.pay_category NOT IN ('bonus', 'deduction')
    )
  ORDER BY 4 DESC;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_completed_work_without_pay() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_completed_work_without_pay() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. ST2-10: daily pending digest to staff (8 AM Orlando) and one office
--     escalation per assignment still pending 72h before the event. Hourly
--     pg_cron (config.toml crons never run here). Idempotent by dedupe_key.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_queue_pending_notices(p_force_digest boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public
AS $function$
DECLARE
  v_local timestamp := now() AT TIME ZONE 'America/New_York';
  v_today date := (now() AT TIME ZONE 'America/New_York')::date;
  v_digests integer := 0;
  v_escalations integer := 0;
  r record;
BEGIN
  PERFORM public._assert_admin_or_service();

  IF p_force_digest OR extract(hour FROM v_local) = 8 THEN
    FOR r IN
      SELECT a.staff_id, s.full_name,
             jsonb_agg(jsonb_build_object(
               'assignment_id', a.id, 'booking_id', b.id, 'reservation_number', b.reservation_number,
               'event_date', b.event_date,
               'start_time', COALESCE(a.scheduled_start_time, b.start_time),
               'end_time', COALESCE(a.scheduled_end_time, b.end_time),
               'role', a.assignment_role)
               ORDER BY b.event_date, b.start_time) AS items
      FROM public.booking_staff_assignments a
      JOIN public.staff_members s ON s.id = a.staff_id AND s.is_active
      JOIN public.bookings b ON b.id = a.booking_id
      WHERE a.status NOT IN ('cancelled', 'completed')
        AND COALESCE(a.response_status, 'pending') = 'pending'
        AND COALESCE(a.assignment_type, '') <> 'bar_service'
        AND b.status <> 'cancelled'::booking_status
        AND b.lifecycle_status IS DISTINCT FROM 'cancelled'
        AND (b.event_date + COALESCE(b.start_time, time '00:00')) AT TIME ZONE 'America/New_York' > now()
      GROUP BY a.staff_id, s.full_name
    LOOP
      IF public._queue_staff_notice('pending_digest', 'staff', r.staff_id, NULL, NULL,
           jsonb_build_object('staff_name', r.full_name, 'items', r.items),
           'digest:' || r.staff_id || ':' || v_today, false) THEN
        v_digests := v_digests + 1;
      END IF;
    END LOOP;
  END IF;

  FOR r IN
    SELECT a.id, a.staff_id, b.id AS booking_id
    FROM public.booking_staff_assignments a
    JOIN public.staff_members s ON s.id = a.staff_id AND s.is_active
    JOIN public.bookings b ON b.id = a.booking_id
    WHERE a.status NOT IN ('cancelled', 'completed')
      AND COALESCE(a.response_status, 'pending') = 'pending'
      AND COALESCE(a.assignment_type, '') <> 'bar_service'
      AND b.status <> 'cancelled'::booking_status
      AND b.lifecycle_status IS DISTINCT FROM 'cancelled'
      AND (b.event_date + COALESCE(b.start_time, time '00:00')) AT TIME ZONE 'America/New_York' > now()
      AND (b.event_date + COALESCE(b.start_time, time '00:00')) AT TIME ZONE 'America/New_York' <= now() + interval '72 hours'
  LOOP
    IF public._queue_staff_notice('pending_escalation', 'office', r.staff_id, r.booking_id, r.id,
         public._staff_notice_payload(r.id), 'escalation:' || r.id, false) THEN
      v_escalations := v_escalations + 1;
    END IF;
  END LOOP;

  IF v_digests + v_escalations > 0 OR EXISTS (
    SELECT 1 FROM public.staff_notifications
     WHERE (status = 'pending' AND created_at < now() - interval '5 minutes')
        OR (status = 'failed' AND attempts < 3)
  ) THEN
    PERFORM public._kick_staff_notices();
  END IF;

  RETURN jsonb_build_object('digests', v_digests, 'escalations', v_escalations);
END;
$function$;
REVOKE ALL ON FUNCTION public.staff_queue_pending_notices(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_queue_pending_notices(boolean) TO service_role;

DO $cron$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'staff-pending-notices-hourly';
  PERFORM cron.schedule('staff-pending-notices-hourly', '5 * * * *', 'SELECT public.staff_queue_pending_notices();');
END
$cron$;

-- ---------------------------------------------------------------------------
-- 15. ST2-02: standalone photos use the existing public cleaning-media bucket
--     (the code bucket booking-cleaning-reports never existed). Its orphan
--     policies are dropped so creating that bucket later cannot open it.
-- 16. ST2-23 (S-10 interim). Every anon call site was checked first:
--     * staff_members: the portal reads only id, full_name, email, role,
--       is_active (StaffLogin, useStaffSession). Pay columns are not needed.
--     * booking_events: every insert in src is an admin page (signed in);
--       staff writes go through SECURITY DEFINER RPCs.
--     * cleaning-media: nothing deletes objects (photo remove only edits the
--       list), so anon DELETE is closed; admins keep it.
--     * inventory_products: products are soft-deleted (UPDATE is_active), so
--       DELETE is admin-only. inventory_stock and inventory_locations keep
--       anon DELETE: the staff Inventory page deletes stock and locations.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Allow booking cleaning report deletions" ON storage.objects;
DROP POLICY IF EXISTS "Allow booking cleaning report uploads" ON storage.objects;

DROP POLICY IF EXISTS "Allow cleaning media deletions" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete cleaning media" ON storage.objects;
CREATE POLICY "Admins can delete cleaning media" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'cleaning-media' AND public.has_role(auth.uid(), 'admin'::app_role));

REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.staff_members FROM anon;
GRANT SELECT (id, full_name, email, role, is_active) ON public.staff_members TO anon;

DROP POLICY IF EXISTS "Allow anon to insert booking events" ON public.booking_events;

DROP POLICY IF EXISTS "Anyone can manage inventory_products" ON public.inventory_products;
DROP POLICY IF EXISTS "Anyone can read inventory_products" ON public.inventory_products;
DROP POLICY IF EXISTS "Anyone can add inventory_products" ON public.inventory_products;
DROP POLICY IF EXISTS "Anyone can edit inventory_products" ON public.inventory_products;
DROP POLICY IF EXISTS "Admin can delete inventory_products" ON public.inventory_products;
CREATE POLICY "Anyone can read inventory_products" ON public.inventory_products FOR SELECT USING (true);
CREATE POLICY "Anyone can add inventory_products" ON public.inventory_products FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can edit inventory_products" ON public.inventory_products FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Admin can delete inventory_products" ON public.inventory_products
  FOR DELETE USING (public.has_role(auth.uid(), 'admin'::app_role));
