-- Phase 1B / M-10, M-11, M-12 (ClickUp 86e40ach2): revenue lines that add up.
--
-- Before (populate_booking_revenue_items):
--   * M-10: setup & breakdown was written as a fixed $75 + $75 on top of
--     optional_services, which already contains it: +$150 on 8 bookings
--     (+$1,200.03 in reports).
--   * M-11: the deposit was dated at booking creation (UTC), not when it was
--     paid; balances were dated in UTC. 15 deposits and 6 balances landed on
--     the wrong day.
--   * every line was split 50/50, so after a price change (M-1 apply, or a
--     deposit % other than 50) deposit revenue no longer matched the deposit
--     actually collected.
--   * M-12: 57 of 109 stored charged amounts / fees did not match what Stripe
--     charged (a flat 3.5% backfill); the confirmation page, GHL and Meta
--     read them.
--
-- Now:
--   * lines come from the stored price parts and add up to the booking total;
--     add-ons are split into tablecloths / setup / other WITHIN
--     optional_services (no extra $150);
--   * deposit lines add up exactly to deposit_amount and balance lines to the
--     rest (each line allocated in proportion, rounding remainder on the
--     largest line);
--   * dated on the day each payment was made, in Orlando;
--   * charged amounts and fees are reset from the amounts Stripe reported.
-- Reports are still a synthetic allocation of the price, not a payments
-- ledger: that is Phase 4 (R-1).

-- M-32: the exact lines an add-on Checkout charged (written by
-- create-addon-invoice, read by stripe-webhook for revenue). The 4 paid
-- add-ons so far are production packages only: their revenue is correct.
ALTER TABLE public.booking_addon_invoices ADD COLUMN IF NOT EXISTS line_items jsonb;

CREATE OR REPLACE FUNCTION public.populate_booking_revenue_items(p_booking_id uuid, p_is_historical boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_b public.bookings%ROWTYPE;
  v_dep_date date;
  v_bal_date date;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_total numeric := 0;
  v_ratio numeric;
  v_dep_parts numeric[] := ARRAY[]::numeric[];
  v_dep_sum numeric := 0;
  v_max_idx int := 0;
  v_max_amt numeric := NULL;
  v_amt numeric;
  v_part numeric;
  v_n int;
  i int;
  v_cleaning_type text;
  v_cleaning_tier numeric;
  v_cleaning_base numeric;
  v_surcharge numeric;
  v_opt numeric;
  v_tablecloth numeric := 0;
  v_rest numeric;
  v_bar_label text;
BEGIN
  IF pg_trigger_depth() = 0 THEN
    PERFORM public._assert_admin_or_service();
  END IF;

  SELECT * INTO v_b FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;
  IF v_b.booking_origin::text <> 'website' THEN
    RETURN;
  END IF;

  DELETE FROM public.booking_revenue_items
  WHERE booking_id = p_booking_id AND payment_split IN ('deposit', 'balance');

  -- Nothing collected, nothing to report.
  IF v_b.deposit_paid_at IS NULL AND v_b.balance_paid_at IS NULL THEN
    RETURN;
  END IF;

  -- M-11: the Orlando day each payment was made.
  v_dep_date := (COALESCE(v_b.deposit_paid_at, v_b.balance_paid_at) AT TIME ZONE 'America/New_York')::date;
  v_bal_date := (v_b.balance_paid_at AT TIME ZONE 'America/New_York')::date;

  -- Lines (gross, from the stored price parts).
  IF COALESCE(v_b.base_rental, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_object('cat', 'baseline', 'type', v_b.booking_type::text, 'amount', v_b.base_rental,
      'label', CASE WHEN v_b.booking_type::text = 'daily' THEN 'Full Day Venue Rental' ELSE 'Hourly Venue Rental' END);
  END IF;

  IF COALESCE(v_b.cleaning_fee, 0) > 0 THEN
    IF v_b.cleaning_fee <= 40 THEN v_cleaning_type := 'touch_up'; v_cleaning_tier := 40;
    ELSIF v_b.cleaning_fee <= 80 THEN v_cleaning_type := 'regular'; v_cleaning_tier := 80;
    ELSIF v_b.cleaning_fee < 150 THEN v_cleaning_type := 'regular'; v_cleaning_tier := 80;
    ELSE v_cleaning_type := 'deep'; v_cleaning_tier := 150;
    END IF;
    v_cleaning_base := least(v_b.cleaning_fee, v_cleaning_tier);
    v_surcharge := v_b.cleaning_fee - v_cleaning_base;
    v_lines := v_lines || jsonb_build_object('cat', 'cleaning_base', 'type', v_cleaning_type, 'amount', v_cleaning_base,
      'label', CASE v_cleaning_type WHEN 'touch_up' THEN 'Touch-Up Cleaning' WHEN 'regular' THEN 'Regular Cleaning' ELSE 'Deep Cleaning' END);
    IF v_surcharge > 0 THEN
      v_lines := v_lines || jsonb_build_object('cat', 'cleaning_surcharge', 'type', 'celebration', 'amount', v_surcharge,
        'label', 'Celebration Surcharge', 'meta', jsonb_build_object('guest_count', v_b.number_of_guests));
    END IF;
  END IF;

  IF COALESCE(v_b.package_cost, 0) > 0 AND COALESCE(v_b.package, 'none') <> 'none' THEN
    v_lines := v_lines || jsonb_build_object('cat', 'production', 'type', v_b.package::text, 'amount', v_b.package_cost,
      'label', CASE v_b.package WHEN 'basic' THEN 'Basic Production Package' WHEN 'led' THEN 'LED Production Package'
                                WHEN 'workshop' THEN 'Workshop Production Package' ELSE 'Production Package' END);
  END IF;

  -- M-10: add-ons are split inside optional_services (setup is part of it).
  v_opt := COALESCE(v_b.optional_services, 0);
  IF v_opt > 0 THEN
    IF COALESCE(v_b.tablecloths, false) AND COALESCE(v_b.tablecloth_quantity, 0) > 0 THEN
      v_tablecloth := least(v_opt, v_b.tablecloth_quantity * 5.00 + 25.00);
      v_lines := v_lines || jsonb_build_object('cat', 'addon', 'type', 'tablecloth', 'amount', v_tablecloth,
        'label', 'Tablecloth Rental', 'qty', v_b.tablecloth_quantity, 'unit', 5.00);
    END IF;
    v_rest := v_opt - v_tablecloth;
    IF v_rest > 0 THEN
      v_lines := v_lines || CASE WHEN COALESCE(v_b.setup_breakdown, false)
        THEN jsonb_build_object('cat', 'addon', 'type', 'setup_breakdown', 'amount', v_rest, 'label', 'Setup & Breakdown Service')
        ELSE jsonb_build_object('cat', 'addon', 'type', 'misc', 'amount', v_rest, 'label', 'Optional Services') END;
    END IF;
  END IF;

  -- A bar bought later through an add-on invoice is copied onto the booking
  -- by the webhook but is NOT part of its total: its revenue is the add-on
  -- line (Codex review: it was counted twice).
  IF COALESCE(v_b.bar_package, 'none') <> 'none' AND COALESCE(v_b.bar_subtotal, 0) > 0
     AND NOT EXISTS (
       SELECT 1 FROM public.booking_addon_invoices ai
       WHERE ai.booking_id = p_booking_id AND ai.paid_at IS NOT NULL AND COALESCE(ai.bar_subtotal, 0) > 0
     ) THEN
    v_bar_label := COALESCE(v_b.bar_package_label, public.get_bar_package_label(v_b.bar_package), v_b.bar_package);
    v_lines := v_lines || jsonb_build_object('cat', 'bar_service', 'type', v_b.bar_package, 'amount', v_b.bar_subtotal,
      'label', 'Bar Service — ' || v_bar_label, 'qty', v_b.bar_guest_count, 'unit', v_b.bar_rate_per_guest,
      'meta', jsonb_build_object('bar_package', v_b.bar_package, 'bar_package_label', v_bar_label,
                                 'guest_count', v_b.bar_guest_count, 'rate_per_guest', v_b.bar_rate_per_guest));
  END IF;

  IF COALESCE(v_b.discount_amount, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_object('cat', 'discount', 'type', COALESCE(v_b.discount_code, 'manual'),
      'amount', -v_b.discount_amount,
      'label', CASE WHEN v_b.discount_code IS NOT NULL THEN 'Discount: ' || v_b.discount_code ELSE 'Discount Applied' END,
      'meta', jsonb_build_object('code', v_b.discount_code));
  END IF;

  IF COALESCE(v_b.taxes_fees, 0) > 0 THEN
    v_lines := v_lines || jsonb_build_object('cat', 'tax', 'type', 'taxes_fees', 'amount', v_b.taxes_fees, 'label', 'Taxes & Fees');
  END IF;

  v_n := jsonb_array_length(v_lines);
  IF v_n = 0 THEN
    RETURN;
  END IF;
  SELECT COALESCE(sum((x->>'amount')::numeric), 0) INTO v_total FROM jsonb_array_elements(v_lines) x;
  IF v_total <= 0 THEN
    RETURN;
  END IF;

  -- Deposit share of each line; the deposit lines add up to deposit_amount.
  -- A booking recorded paid in full (no separate deposit) puts everything on
  -- the deposit date.
  v_ratio := CASE WHEN v_b.deposit_paid_at IS NULL
                       OR (v_b.balance_paid_at IS NOT NULL AND v_b.deposit_paid_at = v_b.balance_paid_at)
                  THEN 1
                  ELSE least(1, greatest(0, COALESCE(v_b.deposit_amount, 0) / v_total)) END;
  FOR i IN 0 .. v_n - 1 LOOP
    v_amt := (v_lines->i->>'amount')::numeric;
    v_part := round(v_amt * v_ratio, 2);
    v_dep_parts := v_dep_parts || v_part;
    v_dep_sum := v_dep_sum + v_part;
    IF v_amt > 0 AND (v_max_amt IS NULL OR v_amt > v_max_amt) THEN
      v_max_amt := v_amt;
      v_max_idx := i + 1;
    END IF;
  END LOOP;
  IF v_max_idx > 0 THEN
    v_dep_parts[v_max_idx] := v_dep_parts[v_max_idx] + (round(v_total * v_ratio, 2) - v_dep_sum);
  END IF;

  FOR i IN 0 .. v_n - 1 LOOP
    v_line := v_lines->i;
    v_amt := (v_line->>'amount')::numeric;
    v_part := v_dep_parts[i + 1];
    IF v_part <> 0 THEN
      INSERT INTO public.booking_revenue_items
        (booking_id, item_category, item_type, amount, quantity, unit_price, payment_date, payment_split, description, is_historical, metadata)
      VALUES
        (p_booking_id, v_line->>'cat', v_line->>'type', v_part, (v_line->>'qty')::numeric, (v_line->>'unit')::numeric,
         v_dep_date, 'deposit', (v_line->>'label') || CASE WHEN v_ratio = 1 THEN '' ELSE ' (Deposit)' END,
         p_is_historical, COALESCE(v_line->'meta', '{}'::jsonb));
    END IF;
    IF v_bal_date IS NOT NULL AND v_ratio < 1 AND v_amt - v_part <> 0 THEN
      INSERT INTO public.booking_revenue_items
        (booking_id, item_category, item_type, amount, quantity, unit_price, payment_date, payment_split, description, is_historical, metadata)
      VALUES
        (p_booking_id, v_line->>'cat', v_line->>'type', v_amt - v_part, (v_line->>'qty')::numeric, (v_line->>'unit')::numeric,
         v_bal_date, 'balance', (v_line->>'label') || ' (Balance)',
         p_is_historical, COALESCE(v_line->'meta', '{}'::jsonb));
    END IF;
  END LOOP;
END;
$function$;

-- ---------------------------------------------------------------------------
-- M-12: charged amounts and fees from what Stripe actually charged.
-- ---------------------------------------------------------------------------
WITH ev AS (
  SELECT booking_id, metadata->>'payment_type' AS kind,
         (array_agg((metadata->>'amount_cents')::numeric ORDER BY processed_at))[1] / 100.0 AS charged
  FROM public.stripe_event_log
  WHERE metadata->>'payment_type' IN ('deposit', 'balance')
    AND COALESCE(metadata->>'claim_state', 'completed') = 'completed'
    AND metadata ? 'amount_cents'
  GROUP BY 1, 2
), fixed AS (
  UPDATE public.bookings b
  SET deposit_total_charged = ev.charged,
      deposit_fee = round(ev.charged - b.deposit_amount, 2)
  FROM ev
  WHERE ev.booking_id = b.id AND ev.kind = 'deposit'
    AND b.deposit_paid_at IS NOT NULL
    AND ev.charged >= b.deposit_amount - 0.01
    AND abs(COALESCE(b.deposit_total_charged, -1) - ev.charged) > 0.01
  RETURNING b.id, 'deposit'::text AS kind
), fixed_bal AS (
  UPDATE public.bookings b
  SET balance_total_charged = ev.charged,
      balance_fee = round(ev.charged - b.balance_amount, 2)
  FROM ev
  WHERE ev.booking_id = b.id AND ev.kind = 'balance'
    AND b.balance_paid_at IS NOT NULL
    AND ev.charged >= b.balance_amount - 0.01
    AND abs(COALESCE(b.balance_total_charged, -1) - ev.charged) > 0.01
  RETURNING b.id, 'balance'::text AS kind
)
INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
SELECT id, 'charged_amount_backfilled_from_stripe', 'system', jsonb_build_object('kind', kind, 'ticket', '86e40ach2 M-12')
FROM (SELECT * FROM fixed UNION ALL SELECT * FROM fixed_bal) x;

-- ---------------------------------------------------------------------------
-- Rebuild every website booking's deposit/balance lines with the new rules
-- (keeps each booking's historical flag).
-- ---------------------------------------------------------------------------
DO $rebuild$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT b.id,
           COALESCE((SELECT bool_or(is_historical) FROM public.booking_revenue_items x
                     WHERE x.booking_id = b.id AND x.payment_split IN ('deposit', 'balance')), false) AS hist
    FROM public.bookings b
    WHERE b.booking_origin::text = 'website'
      AND (b.deposit_paid_at IS NOT NULL OR b.balance_paid_at IS NOT NULL)
  LOOP
    PERFORM public.populate_booking_revenue_items(r.id, r.hist);
  END LOOP;
END
$rebuild$;

-- ---------------------------------------------------------------------------
-- M-22: ad / channel attribution counted cancelled bookings (14, $11,756 of
-- contract value). Same view, plus the cancelled filter.
-- ---------------------------------------------------------------------------
DO $view$
DECLARE
  v_def text := pg_get_viewdef('public.v_paid_booking_attribution'::regclass, false);
  v_old text := 'WHERE ((b.deposit_paid_at IS NOT NULL) AND has_role(';
  v_new text := 'WHERE ((b.deposit_paid_at IS NOT NULL) AND (b.status <> ALL (ARRAY[''cancelled''::booking_status, ''declined''::booking_status])) AND (COALESCE(b.lifecycle_status, ''''::text) <> ''cancelled''::text) AND has_role(';
BEGIN
  IF position('''cancelled''::booking_status' IN v_def) > 0 THEN
    RETURN; -- already filtered
  END IF;
  IF position(v_old IN v_def) = 0 THEN
    RAISE EXCEPTION 'v_paid_booking_attribution definition changed; update the M-22 filter by hand';
  END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.v_paid_booking_attribution WITH (security_invoker = on) AS ' || replace(v_def, v_old, v_new);
END
$view$;
