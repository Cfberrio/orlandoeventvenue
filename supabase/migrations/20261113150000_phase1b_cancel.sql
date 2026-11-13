-- Phase 1B / M-9 (ClickUp 86e40ach2): one cancel, whatever wrote it.
--
-- Before: only the cancel-booking edge function did the cancel work, and
-- only partly. A cancel from the admin status dropdown (lifecycle only), from
-- GHL (status only) or from the GHL appointment webhook skipped it: staff
-- stayed assigned, add-on payment links stayed live, status and lifecycle
-- disagreed (4 bookings today), and nobody was told money had been collected.
--
-- Now the database does the cancel side effects for every writer:
--   * BEFORE trigger: a cancel on either field cancels both and stamps
--     cancelled_at, so status and lifecycle can no longer diverge on cancel;
--   * AFTER trigger: cancels open staff assignments (their unpaid payroll is
--     voided by the existing assignment trigger), cancels pending scheduled
--     jobs, frees the calendar blocks, expires unpaid add-on invoices, and
--     flags a refund review when money was collected.
-- Stripe sessions (balance + add-on links) can only be expired by an edge
-- function: cancel-booking does it, and every other writer now calls it.
--
-- admin_record_refund_decision(): the office records what happened to the
-- money on a cancelled booking (refunded in full, partly, or kept, with a
-- reason). It records only; the refund itself is issued in Stripe.

-- ---------------------------------------------------------------------------
-- Reviews the office must close (refund after cancel; price and staff hours
-- after a reschedule, M-1). A table, not booking_events: anon can insert
-- booking_events, so an event could be forged to hide a review. Only
-- SECURITY DEFINER functions write here; admins read.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.booking_money_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('refund', 'reschedule_price', 'staff_hours')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'superseded')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text,
  decision_details jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS booking_money_reviews_one_open_uidx
  ON public.booking_money_reviews (booking_id, kind) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS booking_money_reviews_booking_idx ON public.booking_money_reviews (booking_id, created_at DESC);

ALTER TABLE public.booking_money_reviews ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins read money reviews" ON public.booking_money_reviews;
CREATE POLICY "Admins read money reviews" ON public.booking_money_reviews
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.booking_money_reviews FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.booking_money_reviews FROM authenticated;
GRANT SELECT ON public.booking_money_reviews TO authenticated;

-- ---------------------------------------------------------------------------
-- Money actually collected on a booking (Stripe deposit/balance, offline
-- payments recorded with admin_record_payment, paid add-on invoices).
-- Bookings whose policy takes no payment through us (external platforms)
-- count only their add-on invoices.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._booking_collected(p_booking_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT bk.*,
           COALESCE(p.requires_payment, true) AS takes_payment
    FROM public.bookings bk
    LEFT JOIN public.booking_policies p ON p.id = bk.policy_id
    WHERE bk.id = p_booking_id
  ), parts AS (
    SELECT
      CASE WHEN b.takes_payment AND b.deposit_paid_at IS NOT NULL
           THEN round(COALESCE(b.deposit_total_charged, b.deposit_amount, 0), 2) ELSE 0 END AS deposit,
      CASE WHEN b.takes_payment AND b.balance_paid_at IS NOT NULL
           THEN round(COALESCE(b.balance_total_charged, b.balance_amount, 0), 2) ELSE 0 END AS balance,
      COALESCE((
        SELECT round(sum(COALESCE(i.total_charged, i.total_amount, 0)), 2)
        FROM public.booking_addon_invoices i
        WHERE i.booking_id = p_booking_id AND i.paid_at IS NOT NULL
      ), 0) AS addons
    FROM b
  )
  SELECT jsonb_build_object(
    'deposit', deposit,
    'balance', balance,
    'addons', addons,
    'total', deposit + balance + addons
  )
  FROM parts;
$function$;

REVOKE ALL ON FUNCTION public._booking_collected(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._booking_collected(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- BEFORE: a cancel on either column cancels both.
-- Only on the transition into cancelled; un-cancelling stays an explicit
-- admin action (Phase 2, transition_booking).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_booking_cancel_normalize()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Cancelled is terminal (Codex review): staff, blocks and links are gone
  -- after the cascade, so a stale GHL callback or a dropdown click must not
  -- quietly bring the booking back half-alive. Reopening becomes an explicit
  -- transition in Phase 2 (it will set oev.reopen_cancelled for its write).
  IF COALESCE(current_setting('oev.reopen_cancelled', true), '') <> 'on' AND (
       (OLD.status = 'cancelled'::booking_status AND NEW.status IS DISTINCT FROM 'cancelled'::booking_status)
       OR (OLD.lifecycle_status = 'cancelled' AND NEW.lifecycle_status IS DISTINCT FROM 'cancelled')
     ) THEN
    RAISE EXCEPTION 'Booking % is cancelled and cannot be reopened here; create a new booking instead', OLD.reservation_number
      USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.status = 'cancelled'::booking_status AND OLD.status IS DISTINCT FROM 'cancelled'::booking_status)
     OR (NEW.lifecycle_status = 'cancelled' AND OLD.lifecycle_status IS DISTINCT FROM 'cancelled') THEN
    NEW.status := 'cancelled'::booking_status;
    NEW.lifecycle_status := 'cancelled';
    NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
  END IF;
  RETURN NEW;
END;
$function$;

-- Earned pay survives a cancel (Codex review): completed assignments are work
-- that happened (accepted + event ended, batch 2 rule), so a late cancel from
-- GHL or the office no longer wipes their unpaid lines. Only open
-- assignments lose their pay. Voiding earned pay is an explicit office action.
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
    WHERE booking_id = NEW.id
      AND status <> 'completed';
    IF v_ids IS NOT NULL THEN
      PERFORM public._void_unpaid_payroll(v_ids, 'booking_cancelled');
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

-- Name sorts before trg_enforce_pre_event_ready_gate / update_bookings_updated_at.
DROP TRIGGER IF EXISTS trg_booking_cancel_normalize ON public.bookings;
CREATE TRIGGER trg_booking_cancel_normalize
  BEFORE UPDATE OF status, lifecycle_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_booking_cancel_normalize();

-- ---------------------------------------------------------------------------
-- AFTER: the cancel side effects, once, for every writer.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_booking_cancel_cascade()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assignments int := 0;
  v_jobs int := 0;
  v_blocks int := 0;
  v_addons int := 0;
  v_collected jsonb;
BEGIN
  IF NOT (NEW.status = 'cancelled'::booking_status AND NEW.lifecycle_status = 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'cancelled'::booking_status AND OLD.lifecycle_status = 'cancelled' THEN
    RETURN NEW;
  END IF;

  -- Staff: open assignments are cancelled (completed work is left alone; its
  -- unpaid payroll was already voided by trg_void_payroll_on_booking_cancel).
  UPDATE public.booking_staff_assignments
  SET status = 'cancelled', updated_at = now()
  WHERE booking_id = NEW.id
    AND status IN ('assigned', 'in_progress');
  GET DIAGNOSTICS v_assignments = ROW_COUNT;

  -- Reminders, balance links, status jobs: nothing should run any more.
  UPDATE public.scheduled_jobs
  SET status = 'cancelled', last_error = 'booking_cancelled', updated_at = now()
  WHERE booking_id = NEW.id
    AND status = 'pending';
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  -- Free the date.
  DELETE FROM public.availability_blocks WHERE booking_id = NEW.id;
  GET DIAGNOSTICS v_blocks = ROW_COUNT;

  -- Unpaid add-on invoices stop being payable in our records. The Stripe
  -- session itself is expired by cancel-booking; a payment that still lands
  -- is recorded by the webhook (paid_at IS NULL claim) and shows up in the
  -- refund review below.
  -- SKIP LOCKED: an invoice the webhook is marking paid right now is left
  -- alone (waiting on it while the webhook waits on this booking row would
  -- deadlock); that payment then reopens the refund review below.
  UPDATE public.booking_addon_invoices
  SET payment_status = 'expired'
  WHERE id IN (
    SELECT id FROM public.booking_addon_invoices
    WHERE booking_id = NEW.id
      AND payment_status = 'pending'
      AND paid_at IS NULL
    FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS v_addons = ROW_COUNT;

  v_collected := public._booking_collected(NEW.id);

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (
    NEW.id,
    'booking_cancel_cascade',
    'system',
    jsonb_build_object(
      'previous_status', OLD.status,
      'previous_lifecycle', OLD.lifecycle_status,
      'assignments_cancelled', v_assignments,
      'jobs_cancelled', v_jobs,
      'blocks_deleted', v_blocks,
      'addon_invoices_expired', v_addons,
      'collected', v_collected
    )
  );

  IF (v_collected->>'total')::numeric > 0 AND NEW.payment_status IS DISTINCT FROM 'refunded'::payment_status THEN
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (NEW.id, 'refund_review_needed', 'system', jsonb_build_object('collected', v_collected));
    IF NOT EXISTS (
      SELECT 1 FROM public.booking_money_reviews
      WHERE booking_id = NEW.id AND kind = 'refund' AND status IN ('open', 'resolved')
    ) THEN
      INSERT INTO public.booking_money_reviews (booking_id, kind, details)
      VALUES (NEW.id, 'refund', jsonb_build_object('collected_at_cancel', v_collected));
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_booking_cancel_cascade ON public.bookings;
CREATE TRIGGER trg_booking_cancel_cascade
  AFTER UPDATE OF status, lifecycle_status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_booking_cancel_cascade();

REVOKE ALL ON FUNCTION public.trg_booking_cancel_normalize() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_booking_cancel_cascade() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Money that lands AFTER the cancel (Codex review): a Stripe session that
-- could not be expired in time, or a webhook waiting on the invoice lock
-- while the cancel committed. The webhook still records it; these triggers
-- reopen the refund review so it cannot go unnoticed, even when a refund
-- decision was already recorded.
-- ---------------------------------------------------------------------------
-- Payment status of a cancelled booking from its cumulative money: refunded
-- only when everything collected was given back and nothing is undecided.
-- Otherwise the status follows what was paid (Codex review: it used to stay
-- "refunded" after a later kept or partial decision).
CREATE OR REPLACE FUNCTION public._sync_cancelled_payment_status(p_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_total numeric;
  v_refunded numeric;
  v_kept numeric;
  v_target payment_status;
BEGIN
  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RETURN; END IF;
  v_total := (public._booking_collected(p_booking_id)->>'total')::numeric;
  SELECT COALESCE(sum((decision_details->>'refund_amount')::numeric), 0),
         COALESCE(sum((decision_details->>'kept_amount')::numeric), 0)
  INTO v_refunded, v_kept
  FROM public.booking_money_reviews
  WHERE booking_id = p_booking_id AND kind = 'refund' AND status = 'resolved';

  IF v_total > 0 AND v_kept <= 0.009 AND abs(v_total - v_refunded) <= 0.01 THEN
    v_target := 'refunded'::payment_status;
  ELSIF v_b.payment_status = 'refunded'::payment_status THEN
    v_target := CASE
      WHEN v_b.balance_paid_at IS NOT NULL THEN 'fully_paid'::payment_status
      WHEN v_b.deposit_paid_at IS NOT NULL THEN 'deposit_paid'::payment_status
      ELSE 'pending'::payment_status
    END;
  ELSE
    RETURN;
  END IF;

  IF v_b.payment_status IS DISTINCT FROM v_target THEN
    UPDATE public.bookings SET payment_status = v_target, updated_at = now() WHERE id = p_booking_id;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public._open_refund_review_after_payment(p_booking_id uuid, p_source text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_collected jsonb;
BEGIN
  -- Same lock as admin_record_refund_decision and the cancel: a decision
  -- either sees this payment or runs after it and finds the reopened review.
  PERFORM 1 FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM public.bookings
    WHERE id = p_booking_id
      AND (status = 'cancelled'::booking_status OR lifecycle_status = 'cancelled')
  ) THEN
    RETURN;
  END IF;
  v_collected := public._booking_collected(p_booking_id);
  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (p_booking_id, 'payment_on_cancelled_booking', 'system',
          jsonb_build_object('source', p_source, 'collected', v_collected));
  INSERT INTO public.booking_money_reviews (booking_id, kind, details)
  VALUES (p_booking_id, 'refund', jsonb_build_object('payment_after_cancel', p_source, 'collected', v_collected))
  ON CONFLICT (booking_id, kind) WHERE status = 'open' DO NOTHING;
  PERFORM public._sync_cancelled_payment_status(p_booking_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_booking_payment_after_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF (NEW.status = 'cancelled'::booking_status OR NEW.lifecycle_status = 'cancelled')
     AND ((OLD.deposit_paid_at IS NULL AND NEW.deposit_paid_at IS NOT NULL)
          OR (OLD.balance_paid_at IS NULL AND NEW.balance_paid_at IS NOT NULL)) THEN
    PERFORM public._open_refund_review_after_payment(NEW.id,
      CASE WHEN OLD.deposit_paid_at IS NULL AND NEW.deposit_paid_at IS NOT NULL THEN 'deposit' ELSE 'balance' END);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_booking_payment_after_cancel ON public.bookings;
CREATE TRIGGER trg_booking_payment_after_cancel
  AFTER UPDATE OF deposit_paid_at, balance_paid_at ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.trg_booking_payment_after_cancel();

CREATE OR REPLACE FUNCTION public.trg_addon_payment_after_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- The cancellation check happens inside the helper, under the booking lock,
  -- so a cancel committing at the same moment is not missed.
  IF OLD.paid_at IS NULL AND NEW.paid_at IS NOT NULL AND NEW.booking_id IS NOT NULL THEN
    PERFORM public._open_refund_review_after_payment(NEW.booking_id, 'addon_invoice:' || NEW.id::text);
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_addon_payment_after_cancel ON public.booking_addon_invoices;
CREATE TRIGGER trg_addon_payment_after_cancel
  AFTER UPDATE OF paid_at ON public.booking_addon_invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_addon_payment_after_cancel();

REVOKE ALL ON FUNCTION public._open_refund_review_after_payment(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._sync_cancelled_payment_status(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_booking_payment_after_cancel() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_addon_payment_after_cancel() FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Refund decision on a cancelled booking.
--   p_amount = what was given back (0 = kept).
--   Refunding less than was collected needs a reason (p_note).
--   Refunding everything sets payment_status = 'refunded'.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_record_refund_decision(
  p_booking_id uuid,
  p_amount numeric,
  p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_refunded_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_collected jsonb;
  v_total numeric;
  v_reference text := NULLIF(btrim(COALESCE(p_reference, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_when timestamptz := COALESCE(p_refunded_at, now());
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_decision text;
  v_details jsonb;
  v_decided_before numeric;
BEGIN
  PERFORM public._assert_admin_or_service();

  IF p_amount IS NULL OR p_amount < 0 THEN
    RAISE EXCEPTION 'refund amount must be 0 or more' USING ERRCODE = '22023';
  END IF;
  IF v_when > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'refund date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (v_b.status = 'cancelled'::booking_status OR v_b.lifecycle_status = 'cancelled') THEN
    RAISE EXCEPTION 'only a cancelled booking takes a refund decision' USING ERRCODE = 'P0001';
  END IF;
  -- One decision per review: a second decision is only possible when money
  -- landed after the first one and reopened the review.
  IF EXISTS (
    SELECT 1 FROM public.booking_money_reviews
    WHERE booking_id = p_booking_id AND kind = 'refund' AND status = 'resolved'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.booking_money_reviews
    WHERE booking_id = p_booking_id AND kind = 'refund' AND status = 'open'
  ) THEN
    RAISE EXCEPTION 'a refund decision is already recorded for this booking' USING ERRCODE = 'P0001';
  END IF;

  v_collected := public._booking_collected(p_booking_id);
  -- Money already decided on (refunded or kept) in an earlier decision is
  -- not decided again; only what landed since is.
  SELECT COALESCE(sum((decision_details->>'refund_amount')::numeric + (decision_details->>'kept_amount')::numeric), 0)
  INTO v_decided_before
  FROM public.booking_money_reviews
  WHERE booking_id = p_booking_id AND kind = 'refund' AND status = 'resolved';
  v_total := round((v_collected->>'total')::numeric - v_decided_before, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'nothing was collected on this booking that is not already decided' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount > v_total + 0.01 THEN
    RAISE EXCEPTION 'refund cannot exceed the % collected', to_char(v_total, 'FM999999990.00')
      USING ERRCODE = '22023';
  END IF;

  IF p_amount > 0 THEN
    IF p_method IS NULL OR p_method NOT IN ('stripe', 'cash', 'zelle', 'check', 'other') THEN
      RAISE EXCEPTION 'method must be stripe, cash, zelle, check or other' USING ERRCODE = '22023';
    END IF;
    IF p_method <> 'cash' AND v_reference IS NULL THEN
      RAISE EXCEPTION 'a reference (Stripe refund id, Zelle confirmation, check number) is required for %', p_method
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_amount >= v_total - 0.01 THEN
    v_decision := 'refunded_in_full';
  ELSIF p_amount > 0 THEN
    v_decision := 'refunded_in_part';
  ELSE
    v_decision := 'kept';
  END IF;
  IF v_decision <> 'refunded_in_full' AND v_note IS NULL THEN
    RAISE EXCEPTION 'say why part of the money is kept (cancellation policy, late cancel, etc.)'
      USING ERRCODE = '22023';
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;
  END IF;

  v_details := jsonb_build_object(
    'refund_amount', round(p_amount, 2),
    'kept_amount', round(v_total - p_amount, 2),
    'collected', v_collected,
    'method', CASE WHEN p_amount > 0 THEN p_method END,
    'reference', v_reference,
    'refunded_at', CASE WHEN p_amount > 0 THEN v_when END,
    'note', v_note,
    'recorded_by_email', v_actor_email
  );

  UPDATE public.booking_money_reviews
  SET status = 'resolved', decision = v_decision, decision_details = v_details,
      resolved_at = now(), resolved_by = v_actor
  WHERE booking_id = p_booking_id AND kind = 'refund' AND status = 'open';
  IF NOT FOUND THEN
    INSERT INTO public.booking_money_reviews
      (booking_id, kind, status, details, decision, decision_details, resolved_at, resolved_by)
    VALUES
      (p_booking_id, 'refund', 'resolved', jsonb_build_object('collected_at_decision', v_collected),
       v_decision, v_details, now(), v_actor);
  END IF;

  PERFORM public._sync_cancelled_payment_status(p_booking_id);

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (
    p_booking_id,
    'refund_decision_recorded',
    'admin',
    jsonb_build_object(
      'decision', v_decision,
      'refund_amount', round(p_amount, 2),
      'kept_amount', round(v_total - p_amount, 2),
      'collected', v_collected,
      'method', CASE WHEN p_amount > 0 THEN p_method END,
      'reference', v_reference,
      'refunded_at', CASE WHEN p_amount > 0 THEN v_when END,
      'note', v_note,
      'previous_payment_status', v_b.payment_status,
      'recorded_by', v_actor,
      'recorded_by_email', v_actor_email,
      'recorded_at', now()
    )
  );

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'decision', v_decision,
    'refund_amount', round(p_amount, 2),
    'kept_amount', round(v_total - p_amount, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_record_refund_decision(uuid, numeric, text, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_refund_decision(uuid, numeric, text, text, timestamptz, text) TO authenticated, service_role;

-- Admin screen reads the collected breakdown through this wrapper.
CREATE OR REPLACE FUNCTION public.admin_booking_collected(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_collected jsonb;
  v_decided numeric;
BEGIN
  PERFORM public._assert_admin_or_service();
  v_collected := public._booking_collected(p_booking_id);
  SELECT COALESCE(sum((decision_details->>'refund_amount')::numeric + (decision_details->>'kept_amount')::numeric), 0)
  INTO v_decided
  FROM public.booking_money_reviews
  WHERE booking_id = p_booking_id AND kind = 'refund' AND status = 'resolved';
  RETURN v_collected || jsonb_build_object(
    'decided', round(v_decided, 2),
    'undecided', round((v_collected->>'total')::numeric - v_decided, 2)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_booking_collected(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_booking_collected(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: unpaid add-on invoices on already-cancelled bookings (3 today)
-- stop showing as payable. Staff/payroll on old cancelled bookings is NOT
-- touched here: that is Luis's D5 list.
-- ---------------------------------------------------------------------------
WITH expired AS (
  UPDATE public.booking_addon_invoices i
  SET payment_status = 'expired'
  FROM public.bookings b
  WHERE b.id = i.booking_id
    AND (b.status = 'cancelled'::booking_status OR b.lifecycle_status = 'cancelled')
    AND i.payment_status = 'pending'
    AND i.paid_at IS NULL
  RETURNING i.id, i.booking_id
)
INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
SELECT booking_id, 'addon_invoice_voided_on_cancel', 'system',
       jsonb_build_object('invoice_id', id, 'reason', 'backfill_booking_already_cancelled')
FROM expired;
