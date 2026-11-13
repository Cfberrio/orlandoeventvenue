-- Phase 1B / M-7 + M-8 (ClickUp 86e40ach2): record a payment made outside
-- Stripe (cash, Zelle, check, card on another terminal).
--
-- Before: no way to mark a balance paid outside Stripe ($822 on M8AVNA,
-- VDGPSR, 8XFSPX sit unpaid in the system), and "Mark Deposit Paid" wrote
-- the status from the browser with no amount, method, audit row or revenue.
--
-- admin_record_payment():
--   * admin (or service role) only;
--   * the amount must equal what is owed for that step (no partial payments:
--     the booking has no partial-payment model);
--   * writes the paid-at, fee (0, no processor), charged amount and status
--     under a row lock, so it cannot race the Stripe webhook;
--   * cancels pending balance-link jobs once the balance is settled;
--   * leaves a manual_payment_recorded event with method, reference, date and
--     who recorded it;
--   * regenerates the deposit/balance revenue lines.

-- Never leave an older overload callable (Codex review). The 7-argument
-- version existed only in a rolled-back dry run, but drop it defensively.
DROP FUNCTION IF EXISTS public.admin_record_payment(uuid, text, numeric, text, text, timestamptz, text);

CREATE OR REPLACE FUNCTION public.admin_record_payment(
  p_booking_id uuid,
  p_kind text,
  p_amount numeric,
  p_method text,
  p_reference text DEFAULT NULL,
  p_paid_at timestamptz DEFAULT NULL,
  p_note text DEFAULT NULL,
  p_confirm_open_link boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_expected numeric;
  v_paid_at timestamptz := COALESCE(p_paid_at, now());
  v_reference text := NULLIF(btrim(COALESCE(p_reference, '')), '');
  v_note text := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_new_status payment_status;
  v_cancelled_jobs int := 0;
BEGIN
  PERFORM public._assert_admin_or_service();

  IF p_kind IS NULL OR p_kind NOT IN ('deposit', 'balance', 'full') THEN
    RAISE EXCEPTION 'kind must be deposit, balance or full' USING ERRCODE = '22023';
  END IF;
  IF p_method IS NULL OR p_method NOT IN ('cash', 'zelle', 'check', 'card_external', 'other') THEN
    RAISE EXCEPTION 'method must be cash, zelle, check, card_external or other' USING ERRCODE = '22023';
  END IF;
  IF p_method <> 'cash' AND v_reference IS NULL THEN
    RAISE EXCEPTION 'a reference (Zelle confirmation, check number, receipt) is required for %', p_method
      USING ERRCODE = '22023';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be greater than 0' USING ERRCODE = '22023';
  END IF;
  IF v_paid_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'payment date cannot be in the future' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_b.status = 'cancelled'::booking_status OR v_b.lifecycle_status = 'cancelled' THEN
    RAISE EXCEPTION 'booking is cancelled; record a refund or reopen it first' USING ERRCODE = 'P0001';
  END IF;

  IF p_kind = 'deposit' THEN
    IF v_b.deposit_paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'deposit is already recorded as paid' USING ERRCODE = 'P0001';
    END IF;
    v_expected := COALESCE(v_b.deposit_amount, 0);
    v_new_status := 'deposit_paid';
  ELSIF p_kind = 'balance' THEN
    IF v_b.deposit_paid_at IS NULL THEN
      RAISE EXCEPTION 'record the deposit first (or use full)' USING ERRCODE = 'P0001';
    END IF;
    IF v_b.balance_paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'balance is already recorded as paid' USING ERRCODE = 'P0001';
    END IF;
    v_expected := COALESCE(v_b.balance_amount, 0);
    v_new_status := 'fully_paid';
  ELSE
    IF v_b.deposit_paid_at IS NOT NULL OR v_b.balance_paid_at IS NOT NULL THEN
      RAISE EXCEPTION 'part of this booking is already paid; record the remaining step instead' USING ERRCODE = 'P0001';
    END IF;
    v_expected := COALESCE(v_b.deposit_amount, 0) + COALESCE(v_b.balance_amount, 0);
    v_new_status := 'fully_paid';
  END IF;

  -- Codex review: a Stripe Checkout link for this step may still be live.
  -- Recording the money offline while it is open lets the guest pay twice.
  -- Refuse unless the office explicitly confirms (audited in the event).
  IF NOT p_confirm_open_link THEN
    IF p_kind IN ('balance', 'full') AND v_b.balance_link_expires_at IS NOT NULL
       AND v_b.balance_link_expires_at > now() THEN
      RAISE EXCEPTION 'OPEN_STRIPE_LINK: a balance payment link is live until %; confirm the guest will not use it',
        to_char(v_b.balance_link_expires_at AT TIME ZONE 'America/New_York', 'Mon DD HH12:MI AM')
        USING ERRCODE = 'P0001';
    END IF;
    -- The deposit Checkout session is not stored on the booking until it is
    -- paid, and create-checkout can open a fresh one for any pending website
    -- booking. We cannot prove none is live, so always ask.
    IF p_kind IN ('deposit', 'full') AND v_b.booking_origin::text = 'website' THEN
      RAISE EXCEPTION 'OPEN_STRIPE_LINK: the guest may still have a Stripe deposit checkout open for this booking; confirm the guest will not use it'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_expected <= 0 THEN
    RAISE EXCEPTION 'nothing is owed for this step' USING ERRCODE = 'P0001';
  END IF;
  IF abs(p_amount - v_expected) > 0.01 THEN
    RAISE EXCEPTION 'amount must be % for the %', to_char(v_expected, 'FM999999990.00'), p_kind
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.bookings
  SET deposit_paid_at = CASE WHEN p_kind IN ('deposit', 'full') THEN v_paid_at ELSE deposit_paid_at END,
      deposit_fee = CASE WHEN p_kind IN ('deposit', 'full') THEN 0 ELSE deposit_fee END,
      deposit_total_charged = CASE WHEN p_kind IN ('deposit', 'full') THEN v_b.deposit_amount ELSE deposit_total_charged END,
      balance_paid_at = CASE WHEN p_kind IN ('balance', 'full') THEN v_paid_at ELSE balance_paid_at END,
      balance_fee = CASE WHEN p_kind IN ('balance', 'full') THEN 0 ELSE balance_fee END,
      balance_total_charged = CASE WHEN p_kind IN ('balance', 'full') THEN v_b.balance_amount ELSE balance_total_charged END,
      payment_status = v_new_status,
      updated_at = now()
  WHERE id = p_booking_id;

  IF p_kind IN ('balance', 'full') THEN
    UPDATE public.scheduled_jobs
    SET status = 'cancelled',
        last_error = 'payment_recorded_manually',
        updated_at = now()
    WHERE booking_id = p_booking_id
      AND job_type IN ('balance_retry_1', 'balance_retry_2', 'balance_retry_3', 'create_balance_payment_link')
      AND status = 'pending';
    GET DIAGNOSTICS v_cancelled_jobs = ROW_COUNT;
  END IF;

  IF v_actor IS NOT NULL THEN
    SELECT email INTO v_actor_email FROM auth.users WHERE id = v_actor;
  END IF;

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (
    p_booking_id,
    'manual_payment_recorded',
    'admin',
    jsonb_build_object(
      'kind', p_kind,
      'amount', p_amount,
      'method', p_method,
      'reference', v_reference,
      'paid_at', v_paid_at,
      'note', v_note,
      'previous_payment_status', v_b.payment_status,
      'new_payment_status', v_new_status,
      'cancelled_balance_jobs', v_cancelled_jobs,
      'confirmed_open_stripe_link', p_confirm_open_link,
      'balance_link_expires_at', v_b.balance_link_expires_at,
      'recorded_by', v_actor,
      'recorded_by_email', v_actor_email,
      'recorded_at', now()
    )
  );

  PERFORM public.populate_booking_revenue_items(p_booking_id, false);

  RETURN jsonb_build_object(
    'booking_id', p_booking_id,
    'payment_status', v_new_status,
    'amount', p_amount,
    'cancelled_balance_jobs', v_cancelled_jobs
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_record_payment(uuid, text, numeric, text, text, timestamptz, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_record_payment(uuid, text, numeric, text, text, timestamptz, text, boolean) TO authenticated, service_role;
