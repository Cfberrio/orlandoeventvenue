-- =============================================================================
-- ClickUp 86e40ach2, Phase 3 C-7 / C-23, second-pass audit R2-1..R2-20.
--
-- Read side only for revenue: booking_revenue_items, bookings, invoices,
-- booking_addon_invoices and booking_money_reviews are read, never written.
-- populate_booking_revenue_items is NOT changed.
--
-- One ledger (_revenue_ledger_unchecked) feeds every Reports number, dated by
-- the Orlando day the money moved:
--   booking               revenue lines of non-cancelled bookings: website
--                         deposit/balance lines + add-on lines of EVERY origin
--   invoice               paid standalone/recurring invoices, net (amount)
--   card_fee              deposit_fee / balance_fee / add-on processing_fee /
--                         invoice processing_fee (0 when paid offline)
--   cancelled_kept        collected on a cancelled booking WITH a recorded
--                         refund decision, minus the recorded refunds
--   cancelled_unrecorded  collected on a cancelled booking with NO decision
--                         (shown apart, never in Collected)
--   external              money an external platform collected (Peerspace...)
--                         (shown apart, never in Collected)
-- Collected (net) = booking + invoice + cancelled_kept. Gross = net + card fees.
-- Cancelled = status cancelled/declined OR lifecycle_status cancelled.
--
-- Payroll: totals separate "not payable" lines (staff never accepted, booking
-- cancelled); marking paid a line of a cancelled booking is refused; voiding an
-- assignment also voids its unpaid bonus/deduction lines.
-- Idempotent: DROP ... IF EXISTS before every changed return type.
-- =============================================================================

CREATE OR REPLACE FUNCTION public._revenue_ledger_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(
  entry_date date, source text, booking_id uuid, invoice_id uuid,
  reservation_number text, invoice_number text, event_date date, event_type text,
  booking_type text, booking_origin text, guest_name text,
  item_category text, item_type text, payment_split text,
  amount numeric, quantity integer, description text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  WITH bk AS (
    SELECT b.id, b.reservation_number, b.event_date, b.event_type,
           b.booking_type::text AS booking_type, b.booking_origin::text AS booking_origin,
           b.full_name, b.deposit_paid_at, b.balance_paid_at, b.deposit_amount, b.balance_amount,
           b.deposit_fee, b.balance_fee, b.deposit_total_charged, b.balance_total_charged,
           (b.status::text IN ('cancelled', 'declined') OR COALESCE(b.lifecycle_status, '') = 'cancelled') AS is_cancelled,
           COALESCE(p.requires_payment, true) AS takes_payment
    FROM public.bookings b
    LEFT JOIN public.booking_policies p ON p.id = b.policy_id
  ),
  refunds AS (
    SELECT r.booking_id,
           (COALESCE((r.decision_details->>'refunded_at')::timestamptz, r.resolved_at, r.created_at)
              AT TIME ZONE 'America/New_York')::date AS d,
           round(COALESCE((r.decision_details->>'refund_amount')::numeric, 0), 2) AS refund_amount,
           r.decision,
           COALESCE(r.resolved_at, r.created_at) AS ts
    FROM public.booking_money_reviews r
    WHERE r.kind = 'refund' AND r.status = 'resolved'
  ),
  cancelled_money AS (
    SELECT bk.id AS booking_id, (bk.deposit_paid_at AT TIME ZONE 'America/New_York')::date AS d,
           'deposit'::text AS split, round(COALESCE(bk.deposit_total_charged, bk.deposit_amount, 0), 2) AS amt,
           'Deposit collected (cancelled booking)'::text AS descr, bk.deposit_paid_at AS ts
    FROM bk
    WHERE bk.is_cancelled AND bk.booking_origin <> 'external' AND bk.takes_payment AND bk.deposit_paid_at IS NOT NULL
    UNION ALL
    SELECT bk.id, (bk.balance_paid_at AT TIME ZONE 'America/New_York')::date,
           'balance', round(COALESCE(bk.balance_total_charged, bk.balance_amount, 0), 2),
           'Balance collected (cancelled booking)', bk.balance_paid_at
    FROM bk
    WHERE bk.is_cancelled AND bk.booking_origin <> 'external' AND bk.takes_payment AND bk.balance_paid_at IS NOT NULL
    UNION ALL
    SELECT bk.id, (i.paid_at AT TIME ZONE 'America/New_York')::date,
           'addon', round(COALESCE(i.total_charged, i.total_amount, 0), 2),
           'Add-on invoice collected (cancelled booking)', i.paid_at
    FROM bk
    JOIN public.booking_addon_invoices i ON i.booking_id = bk.id
    WHERE bk.is_cancelled AND i.paid_at IS NOT NULL
  ),
  ledger AS (
    SELECT bri.payment_date AS entry_date, 'booking'::text AS source, bri.booking_id, NULL::uuid AS invoice_id,
           bri.item_category, bri.item_type, bri.payment_split, bri.amount, bri.quantity,
           bri.description, bri.created_at
    FROM public.booking_revenue_items bri
    JOIN bk ON bk.id = bri.booking_id
    WHERE bri.payment_date IS NOT NULL
      AND NOT bk.is_cancelled
      AND (bk.booking_origin = 'website' OR bri.payment_split = 'addon')
    UNION ALL
    SELECT (bk.deposit_paid_at AT TIME ZONE 'America/New_York')::date, 'card_fee', bk.id, NULL::uuid,
           'card_fee', 'deposit', 'deposit', round(bk.deposit_fee, 2), NULL::integer,
           'Card fee on deposit', bk.deposit_paid_at
    FROM bk
    WHERE NOT bk.is_cancelled AND bk.booking_origin <> 'external'
      AND bk.deposit_paid_at IS NOT NULL AND COALESCE(bk.deposit_fee, 0) <> 0
    UNION ALL
    SELECT (bk.balance_paid_at AT TIME ZONE 'America/New_York')::date, 'card_fee', bk.id, NULL::uuid,
           'card_fee', 'balance', 'balance', round(bk.balance_fee, 2), NULL::integer,
           'Card fee on balance', bk.balance_paid_at
    FROM bk
    WHERE NOT bk.is_cancelled AND bk.booking_origin <> 'external'
      AND bk.balance_paid_at IS NOT NULL AND COALESCE(bk.balance_fee, 0) <> 0
    UNION ALL
    SELECT (i.paid_at AT TIME ZONE 'America/New_York')::date, 'card_fee', bk.id, NULL::uuid,
           'card_fee', 'addon', 'addon', round(i.processing_fee, 2), NULL::integer,
           'Card fee on add-on invoice', i.paid_at
    FROM bk
    JOIN public.booking_addon_invoices i ON i.booking_id = bk.id
    WHERE NOT bk.is_cancelled AND i.paid_at IS NOT NULL AND COALESCE(i.processing_fee, 0) <> 0
    UNION ALL
    SELECT (inv.paid_at AT TIME ZONE 'America/New_York')::date, 'invoice', NULL::uuid, inv.id,
           'invoice',
           CASE WHEN COALESCE(inv.is_recurring, false) OR inv.recurring_parent_id IS NOT NULL
                THEN 'recurring' ELSE 'standalone' END,
           'invoice', round(inv.amount, 2), NULL::integer, inv.title, inv.paid_at
    FROM public.invoices inv
    WHERE inv.payment_status = 'paid' AND inv.paid_at IS NOT NULL AND inv.voided_at IS NULL
    UNION ALL
    SELECT (inv.paid_at AT TIME ZONE 'America/New_York')::date, 'card_fee', NULL::uuid, inv.id,
           'card_fee', 'invoice', 'invoice', round(inv.processing_fee, 2), NULL::integer,
           'Card fee on invoice', inv.paid_at
    FROM public.invoices inv
    WHERE inv.payment_status = 'paid' AND inv.paid_at IS NOT NULL AND inv.voided_at IS NULL
      AND inv.paid_offline_method IS NULL AND COALESCE(inv.processing_fee, 0) <> 0
    UNION ALL
    SELECT cm.d,
           CASE WHEN EXISTS (SELECT 1 FROM refunds r WHERE r.booking_id = cm.booking_id)
                THEN 'cancelled_kept' ELSE 'cancelled_unrecorded' END,
           cm.booking_id, NULL::uuid,
           CASE WHEN EXISTS (SELECT 1 FROM refunds r WHERE r.booking_id = cm.booking_id)
                THEN 'cancelled_kept' ELSE 'cancelled_unrecorded' END,
           cm.split, cm.split, cm.amt, NULL::integer, cm.descr, cm.ts
    FROM cancelled_money cm
    WHERE cm.amt <> 0
    UNION ALL
    SELECT r.d, 'cancelled_kept', r.booking_id, NULL::uuid,
           'cancelled_kept', 'refund', 'refund', -r.refund_amount, NULL::integer,
           'Refund recorded (' || COALESCE(r.decision, 'refund') || ')', r.ts
    FROM refunds r
    JOIN bk ON bk.id = r.booking_id
    WHERE bk.is_cancelled AND r.refund_amount <> 0
    UNION ALL
    SELECT (bk.deposit_paid_at AT TIME ZONE 'America/New_York')::date, 'external', bk.id, NULL::uuid,
           'external', 'deposit', 'deposit', round(bk.deposit_amount, 2), NULL::integer,
           'Paid on external platform', bk.deposit_paid_at
    FROM bk
    WHERE NOT bk.is_cancelled AND bk.booking_origin = 'external'
      AND bk.deposit_paid_at IS NOT NULL AND COALESCE(bk.deposit_amount, 0) <> 0
    UNION ALL
    SELECT (bk.balance_paid_at AT TIME ZONE 'America/New_York')::date, 'external', bk.id, NULL::uuid,
           'external', 'balance', 'balance', round(bk.balance_amount, 2), NULL::integer,
           'Paid on external platform', bk.balance_paid_at
    FROM bk
    WHERE NOT bk.is_cancelled AND bk.booking_origin = 'external'
      AND bk.balance_paid_at IS NOT NULL AND COALESCE(bk.balance_amount, 0) <> 0
  )
  SELECT l.entry_date, l.source, l.booking_id, l.invoice_id,
         bk.reservation_number, inv.invoice_number, bk.event_date, bk.event_type,
         bk.booking_type, COALESCE(bk.booking_origin, CASE WHEN l.invoice_id IS NOT NULL THEN 'invoice' END),
         COALESCE(bk.full_name, inv.customer_name, inv.customer_email),
         l.item_category, l.item_type, l.payment_split, l.amount, l.quantity, l.description, l.created_at
  FROM ledger l
  LEFT JOIN bk ON bk.id = l.booking_id
  LEFT JOIN public.invoices inv ON inv.id = l.invoice_id
  WHERE l.entry_date BETWEEN p_start_date AND p_end_date;
$function$;

CREATE OR REPLACE FUNCTION public._revenue_rollup_unchecked(p_start_date date, p_end_date date, p_grain text)
RETURNS TABLE(
  period_start date, booking_count bigint, payment_days bigint,
  baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric,
  addon_revenue numeric, bar_revenue numeric, other_revenue numeric, tax_amount numeric,
  discount_amount numeric, booking_revenue numeric,
  invoice_revenue numeric, invoice_count bigint,
  cancelled_kept_revenue numeric, cancelled_kept_count bigint,
  collected_net numeric, card_fees numeric, collected_gross numeric,
  cancelled_unrecorded_amount numeric, cancelled_unrecorded_count bigint,
  external_amount numeric, external_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    CASE p_grain
      WHEN 'day' THEN l.entry_date
      WHEN 'month' THEN date_trunc('month', l.entry_date)::date
      ELSE p_start_date
    END,
    COUNT(DISTINCT l.booking_id) FILTER (WHERE l.source IN ('booking', 'card_fee', 'cancelled_kept')),
    COUNT(DISTINCT l.entry_date) FILTER (WHERE l.source IN ('booking', 'invoice', 'card_fee', 'cancelled_kept')),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category = 'baseline'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category IN ('cleaning_base', 'cleaning_surcharge')), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category = 'production'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category = 'addon'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category = 'bar_service'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category NOT IN
      ('baseline', 'cleaning_base', 'cleaning_surcharge', 'production', 'addon', 'bar_service', 'discount')), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category = 'tax'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking' AND l.item_category = 'discount'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'booking'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'invoice'), 0),
    COUNT(DISTINCT l.invoice_id) FILTER (WHERE l.source = 'invoice'),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'cancelled_kept'), 0),
    COUNT(DISTINCT l.booking_id) FILTER (WHERE l.source = 'cancelled_kept'),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('booking', 'invoice', 'cancelled_kept')), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'card_fee'), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source IN ('booking', 'invoice', 'cancelled_kept', 'card_fee')), 0),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'cancelled_unrecorded'), 0),
    COUNT(DISTINCT l.booking_id) FILTER (WHERE l.source = 'cancelled_unrecorded'),
    COALESCE(SUM(l.amount) FILTER (WHERE l.source = 'external'), 0),
    COUNT(DISTINCT l.booking_id) FILTER (WHERE l.source = 'external')
  FROM public._revenue_ledger_unchecked(p_start_date, p_end_date) l
  GROUP BY 1
  ORDER BY 1;
$function$;

DROP FUNCTION IF EXISTS public.get_revenue_summary(date, date);
DROP FUNCTION IF EXISTS public.get_revenue_summary_unchecked(date, date);

CREATE FUNCTION public.get_revenue_summary_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(
  booking_count bigint, payment_days bigint, booking_revenue numeric, discount_amount numeric,
  invoice_revenue numeric, invoice_count bigint,
  cancelled_kept_revenue numeric, cancelled_kept_count bigint,
  collected_net numeric, card_fees numeric, collected_gross numeric,
  cancelled_unrecorded_amount numeric, cancelled_unrecorded_count bigint,
  external_amount numeric, external_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(r.booking_count, 0), COALESCE(r.payment_days, 0),
         COALESCE(r.booking_revenue, 0), COALESCE(r.discount_amount, 0),
         COALESCE(r.invoice_revenue, 0), COALESCE(r.invoice_count, 0),
         COALESCE(r.cancelled_kept_revenue, 0), COALESCE(r.cancelled_kept_count, 0),
         COALESCE(r.collected_net, 0), COALESCE(r.card_fees, 0), COALESCE(r.collected_gross, 0),
         COALESCE(r.cancelled_unrecorded_amount, 0), COALESCE(r.cancelled_unrecorded_count, 0),
         COALESCE(r.external_amount, 0), COALESCE(r.external_count, 0)
  FROM (SELECT 1) one
  LEFT JOIN public._revenue_rollup_unchecked(p_start_date, p_end_date, 'all') r ON true;
$function$;

CREATE FUNCTION public.get_revenue_summary(p_start_date date, p_end_date date)
RETURNS TABLE(
  booking_count bigint, payment_days bigint, booking_revenue numeric, discount_amount numeric,
  invoice_revenue numeric, invoice_count bigint,
  cancelled_kept_revenue numeric, cancelled_kept_count bigint,
  collected_net numeric, card_fees numeric, collected_gross numeric,
  cancelled_unrecorded_amount numeric, cancelled_unrecorded_count bigint,
  external_amount numeric, external_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_revenue_summary_unchecked(p_start_date, p_end_date);
END;
$function$;

DROP FUNCTION IF EXISTS public.get_daily_revenue(date, date);
DROP FUNCTION IF EXISTS public.get_daily_revenue_unchecked(date, date);

CREATE FUNCTION public.get_daily_revenue_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(
  revenue_date date, total_revenue numeric, booking_count bigint,
  baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric,
  addon_revenue numeric, bar_revenue numeric, fee_revenue numeric, discount_amount numeric,
  tax_amount numeric, other_revenue numeric, invoice_revenue numeric, cancelled_kept_revenue numeric,
  collected_net numeric, card_fees numeric, collected_gross numeric,
  cancelled_unrecorded_amount numeric, external_amount numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT r.period_start, r.booking_revenue, r.booking_count,
         r.baseline_revenue, r.cleaning_revenue, r.production_revenue,
         r.addon_revenue, r.bar_revenue, r.card_fees, r.discount_amount,
         r.tax_amount, r.other_revenue, r.invoice_revenue, r.cancelled_kept_revenue,
         r.collected_net, r.card_fees, r.collected_gross,
         r.cancelled_unrecorded_amount, r.external_amount
  FROM public._revenue_rollup_unchecked(p_start_date, p_end_date, 'day') r
  ORDER BY r.period_start;
$function$;

CREATE FUNCTION public.get_daily_revenue(p_start_date date, p_end_date date)
RETURNS TABLE(
  revenue_date date, total_revenue numeric, booking_count bigint,
  baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric,
  addon_revenue numeric, bar_revenue numeric, fee_revenue numeric, discount_amount numeric,
  tax_amount numeric, other_revenue numeric, invoice_revenue numeric, cancelled_kept_revenue numeric,
  collected_net numeric, card_fees numeric, collected_gross numeric,
  cancelled_unrecorded_amount numeric, external_amount numeric
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_daily_revenue_unchecked(p_start_date, p_end_date);
END;
$function$;

DROP FUNCTION IF EXISTS public.get_monthly_revenue(date, date);
DROP FUNCTION IF EXISTS public.get_monthly_revenue_unchecked(date, date);

CREATE FUNCTION public.get_monthly_revenue_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(
  revenue_month text, year_month date, total_revenue numeric, booking_count bigint,
  baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric,
  addon_revenue numeric, bar_revenue numeric, other_revenue numeric, discount_amount numeric,
  invoice_revenue numeric, cancelled_kept_revenue numeric,
  collected_net numeric, card_fees numeric, collected_gross numeric,
  cancelled_unrecorded_amount numeric, cancelled_unrecorded_count bigint,
  external_amount numeric, external_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT to_char(r.period_start, 'YYYY-MM'), r.period_start, r.booking_revenue, r.booking_count,
         r.baseline_revenue, r.cleaning_revenue, r.production_revenue,
         r.addon_revenue, r.bar_revenue, r.other_revenue, r.discount_amount,
         r.invoice_revenue, r.cancelled_kept_revenue,
         r.collected_net, r.card_fees, r.collected_gross,
         r.cancelled_unrecorded_amount, r.cancelled_unrecorded_count,
         r.external_amount, r.external_count
  FROM public._revenue_rollup_unchecked(p_start_date, p_end_date, 'month') r
  ORDER BY r.period_start;
$function$;

CREATE FUNCTION public.get_monthly_revenue(p_start_date date, p_end_date date)
RETURNS TABLE(
  revenue_month text, year_month date, total_revenue numeric, booking_count bigint,
  baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric,
  addon_revenue numeric, bar_revenue numeric, other_revenue numeric, discount_amount numeric,
  invoice_revenue numeric, cancelled_kept_revenue numeric,
  collected_net numeric, card_fees numeric, collected_gross numeric,
  cancelled_unrecorded_amount numeric, cancelled_unrecorded_count bigint,
  external_amount numeric, external_count bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_monthly_revenue_unchecked(p_start_date, p_end_date);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_revenue_by_category_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(category text, item_type text, total_amount numeric, item_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE WHEN l.source = 'booking' THEN l.item_category ELSE l.source END AS category,
         l.item_type, SUM(l.amount) AS total_amount, COUNT(*) AS item_count
  FROM public._revenue_ledger_unchecked(p_start_date, p_end_date) l
  WHERE l.source IN ('booking', 'invoice', 'cancelled_kept', 'card_fee')
  GROUP BY 1, 2
  ORDER BY 1, 3 DESC;
$function$;

DROP FUNCTION IF EXISTS public.get_revenue_by_segment(date, date, text);
DROP FUNCTION IF EXISTS public.get_revenue_by_segment_unchecked(date, date, text);

CREATE FUNCTION public.get_revenue_by_segment_unchecked(p_start_date date, p_end_date date, p_segment_by text DEFAULT 'booking_origin'::text)
RETURNS TABLE(segment text, total_revenue numeric, booking_count bigint, avg_revenue numeric, external_amount numeric, external_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF p_segment_by IS NULL OR p_segment_by NOT IN ('booking_origin', 'event_type', 'booking_type') THEN
    RAISE EXCEPTION 'segment must be booking_origin, event_type or booking_type' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT s.seg,
         COALESCE(SUM(s.amount) FILTER (WHERE s.source IN ('booking', 'cancelled_kept')), 0),
         COUNT(DISTINCT s.booking_id) FILTER (WHERE s.source IN ('booking', 'cancelled_kept')),
         ROUND(COALESCE(SUM(s.amount) FILTER (WHERE s.source IN ('booking', 'cancelled_kept')), 0)
               / NULLIF(COUNT(DISTINCT s.booking_id) FILTER (WHERE s.source IN ('booking', 'cancelled_kept')), 0), 2),
         COALESCE(SUM(s.amount) FILTER (WHERE s.source = 'external'), 0),
         COUNT(DISTINCT s.booking_id) FILTER (WHERE s.source = 'external')
  FROM (
    SELECT CASE p_segment_by
             WHEN 'booking_origin' THEN l.booking_origin
             WHEN 'event_type' THEN l.event_type
             ELSE l.booking_type
           END AS seg,
           l.source, l.booking_id, l.amount
    FROM public._revenue_ledger_unchecked(p_start_date, p_end_date) l
    WHERE l.booking_id IS NOT NULL AND l.source IN ('booking', 'cancelled_kept', 'external')
  ) s
  GROUP BY s.seg
  ORDER BY 2 DESC, 5 DESC;
END;
$function$;

CREATE FUNCTION public.get_revenue_by_segment(p_start_date date, p_end_date date, p_segment_by text DEFAULT 'booking_origin'::text)
RETURNS TABLE(segment text, total_revenue numeric, booking_count bigint, avg_revenue numeric, external_amount numeric, external_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_revenue_by_segment_unchecked(p_start_date, p_end_date, p_segment_by);
END;
$function$;

DROP FUNCTION IF EXISTS public.get_revenue_line_items_export(date, date);
DROP FUNCTION IF EXISTS public.get_revenue_line_items_export_unchecked(date, date);

CREATE FUNCTION public.get_revenue_line_items_export_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(
  source text, counted_as text, reservation_number text, invoice_number text,
  event_date date, payment_date date, payment_split text, event_type text, booking_type text,
  booking_origin text, guest_name text, item_category text, item_type text,
  amount numeric, quantity integer, description text, created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT l.source,
         CASE l.source
           WHEN 'card_fee' THEN 'card_fee'
           WHEN 'external' THEN 'not_collected_by_oev'
           WHEN 'cancelled_unrecorded' THEN 'excluded_refund_not_recorded'
           ELSE 'collected_net'
         END,
         l.reservation_number, l.invoice_number, l.event_date, l.entry_date, l.payment_split,
         l.event_type, l.booking_type, l.booking_origin, l.guest_name,
         l.item_category, l.item_type, l.amount, l.quantity, l.description, l.created_at
  FROM public._revenue_ledger_unchecked(p_start_date, p_end_date) l
  ORDER BY l.entry_date, l.source, l.reservation_number, l.invoice_number, l.item_category;
$function$;

CREATE FUNCTION public.get_revenue_line_items_export(p_start_date date, p_end_date date)
RETURNS TABLE(
  source text, counted_as text, reservation_number text, invoice_number text,
  event_date date, payment_date date, payment_split text, event_type text, booking_type text,
  booking_origin text, guest_name text, item_category text, item_type text,
  amount numeric, quantity integer, description text, created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_revenue_line_items_export_unchecked(p_start_date, p_end_date);
END;
$function$;

-- R2-15: "Generated" = booked value of bookings that paid a deposit and are not
-- cancelled under either status. Same return type, body only.
CREATE OR REPLACE FUNCTION public.get_daily_generated_revenue_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(generated_date date, booking_count bigint, total_generated numeric, baseline_generated numeric, cleaning_generated numeric, production_generated numeric, addon_generated numeric, bar_generated numeric, tax_generated numeric, discount_generated numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT (b.created_at AT TIME ZONE 'America/New_York')::date AS generated_date, COUNT(*) AS booking_count,
    SUM(b.total_amount) AS total_generated, SUM(b.base_rental) AS baseline_generated,
    SUM(b.cleaning_fee) AS cleaning_generated, SUM(b.package_cost) AS production_generated,
    SUM(b.optional_services) AS addon_generated,
    SUM(COALESCE(b.bar_subtotal, 0)) AS bar_generated,
    SUM(b.taxes_fees) AS tax_generated,
    SUM(-1 * COALESCE(b.discount_amount, 0)) AS discount_generated
  FROM public.bookings b
  WHERE (b.created_at AT TIME ZONE 'America/New_York')::date BETWEEN p_start_date AND p_end_date
    AND b.booking_origin = 'website'
    AND b.deposit_paid_at IS NOT NULL
    AND b.status::text NOT IN ('cancelled', 'declined')
    AND COALESCE(b.lifecycle_status, '') <> 'cancelled'
  GROUP BY (b.created_at AT TIME ZONE 'America/New_York')::date
  ORDER BY (b.created_at AT TIME ZONE 'America/New_York')::date;
$function$;

-- =============================================================================
-- Payroll (R2-17, R2-18, R2-19)
-- =============================================================================

CREATE OR REPLACE FUNCTION public._payroll_not_payable_reason(p_paid_status text, p_assignment_id uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN COALESCE(p_paid_status, 'pending') = 'paid' THEN NULL
    WHEN b.id IS NOT NULL
         AND (b.status::text IN ('cancelled', 'declined') OR COALESCE(b.lifecycle_status, '') = 'cancelled')
      THEN 'booking_cancelled'
    WHEN a.booking_id IS NOT NULL
         AND COALESCE(a.assignment_type, '') <> 'bar_service'
         AND COALESCE(a.response_status, 'pending') <> 'accepted'
      THEN 'not_accepted'
    ELSE NULL
  END
  FROM public.booking_staff_assignments a
  LEFT JOIN public.bookings b ON b.id = a.booking_id
  WHERE a.id = p_assignment_id;
$function$;

DROP FUNCTION IF EXISTS public.get_payroll_line_items_export(date, date);
DROP FUNCTION IF EXISTS public.get_payroll_line_items_export_unchecked(date, date);

CREATE FUNCTION public.get_payroll_line_items_export_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(staff_name text, staff_role text, payroll_type text, assignment_date date, booking_id uuid, assignment_id uuid, reservation_number text, assignment_type text, pay_category text, pay_type text, amount numeric, hours numeric, rate numeric, description text, assignment_status text, paid_status text, paid_at timestamp with time zone, payroll_item_id uuid, created_at timestamp with time zone, staff_id uuid, not_payable_reason text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
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
    sm.id AS staff_id,
    public._payroll_not_payable_reason(spi.paid_status, bsa.id) AS not_payable_reason
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
  )
    AND bsa.status != 'cancelled'
  ORDER BY assignment_date DESC, sm.full_name, spi.created_at;
$function$;

CREATE FUNCTION public.get_payroll_line_items_export(p_start_date date, p_end_date date)
RETURNS TABLE(staff_name text, staff_role text, payroll_type text, assignment_date date, booking_id uuid, assignment_id uuid, reservation_number text, assignment_type text, pay_category text, pay_type text, amount numeric, hours numeric, rate numeric, description text, assignment_status text, paid_status text, paid_at timestamp with time zone, payroll_item_id uuid, created_at timestamp with time zone, staff_id uuid, not_payable_reason text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_payroll_line_items_export_unchecked(p_start_date, p_end_date);
END;
$function$;

-- Same signature (the staff portal calls get_payroll_by_staff as anon with its
-- own id): totals now count payable lines only.
CREATE OR REPLACE FUNCTION public.get_payroll_by_staff_unchecked(p_start_date date, p_end_date date, p_staff_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(staff_id uuid, staff_name text, staff_role text, payroll_type text, total_amount numeric, assignment_count bigint, hours_worked numeric, avg_per_assignment numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    sm.id AS staff_id,
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    COALESCE(SUM(spi.amount) FILTER (WHERE public._payroll_not_payable_reason(spi.paid_status, bsa.id) IS NULL), 0) AS total_amount,
    COUNT(DISTINCT spi.assignment_id) AS assignment_count,
    SUM(spi.hours) AS hours_worked,
    ROUND(COALESCE(SUM(spi.amount) FILTER (WHERE public._payroll_not_payable_reason(spi.paid_status, bsa.id) IS NULL), 0)
          / NULLIF(COUNT(DISTINCT spi.assignment_id), 0), 2) AS avg_per_assignment
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
  )
    AND (p_staff_id IS NULL OR sm.id = p_staff_id)
    AND bsa.status != 'cancelled'
  GROUP BY sm.id, sm.full_name, sm.role, sm.payroll_type
  ORDER BY total_amount DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_payroll_by_role_unchecked(p_start_date date, p_end_date date)
RETURNS TABLE(staff_role text, payroll_type text, staff_count bigint, total_amount numeric, assignment_count bigint, hours_worked numeric, avg_per_staff numeric, avg_per_assignment numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT
    sm.role AS staff_role,
    sm.payroll_type,
    COUNT(DISTINCT sm.id) AS staff_count,
    COALESCE(SUM(spi.amount) FILTER (WHERE public._payroll_not_payable_reason(spi.paid_status, bsa.id) IS NULL), 0) AS total_amount,
    COUNT(DISTINCT spi.assignment_id) AS assignment_count,
    SUM(spi.hours) AS hours_worked,
    ROUND(COALESCE(SUM(spi.amount) FILTER (WHERE public._payroll_not_payable_reason(spi.paid_status, bsa.id) IS NULL), 0)
          / NULLIF(COUNT(DISTINCT sm.id), 0), 2) AS avg_per_staff,
    ROUND(COALESCE(SUM(spi.amount) FILTER (WHERE public._payroll_not_payable_reason(spi.paid_status, bsa.id) IS NULL), 0)
          / NULLIF(COUNT(DISTINCT spi.assignment_id), 0), 2) AS avg_per_assignment
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
  )
    AND bsa.status != 'cancelled'
  GROUP BY sm.role, sm.payroll_type
  ORDER BY total_amount DESC;
$function$;

-- R2-17: no line of a cancelled booking can be marked paid (any assignment
-- type), on top of the acceptance rule from 20261119120000.
CREATE OR REPLACE FUNCTION public.trg_payroll_requires_acceptance()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_resp text;
  v_name text;
  v_res text;
  v_type text;
  v_booking uuid;
  v_cancelled boolean;
BEGIN
  IF NEW.assignment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT a.response_status, a.assignment_type, a.booking_id, s.full_name, b.reservation_number,
         (b.status::text IN ('cancelled', 'declined') OR COALESCE(b.lifecycle_status, '') = 'cancelled')
    INTO v_resp, v_type, v_booking, v_name, v_res, v_cancelled
    FROM public.booking_staff_assignments a
    LEFT JOIN public.staff_members s ON s.id = a.staff_id
    LEFT JOIN public.bookings b ON b.id = a.booking_id
   WHERE a.id = NEW.assignment_id
     FOR SHARE OF a;
  IF NOT FOUND OR v_booking IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.paid_status = 'paid'
     AND (TG_OP = 'INSERT' OR OLD.paid_status IS DISTINCT FROM 'paid')
     AND COALESCE(v_cancelled, false) THEN
    RAISE EXCEPTION 'Cannot mark paid: booking%is cancelled. This pay line is not payable.',
      COALESCE(' ' || v_res || ' ', ' ')
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_type, '') = 'bar_service' OR v_resp = 'accepted' THEN
    RETURN NEW;
  END IF;

  IF NEW.paid_status = 'paid'
     AND (TG_OP = 'INSERT' OR OLD.paid_status IS DISTINCT FROM 'paid') THEN
    RAISE EXCEPTION 'Cannot mark paid: % has not accepted this assignment%. Record their acceptance on the booking first.',
      COALESCE(v_name, 'this staff member'), COALESCE(' (' || v_res || ')', '')
      USING ERRCODE = 'P0001';
  END IF;

  IF TG_OP = 'INSERT' AND NEW.pay_category NOT IN ('bonus', 'deduction') THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$function$;

-- R2-18: a voided assignment takes its unpaid bonus/deduction lines with it.
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
    RETURNING p.assignment_id, p.staff_id, p.pay_category, p.amount
  )
  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  SELECT a.booking_id, 'payroll_voided', 'system',
         jsonb_build_object(
           'assignment_id', v.assignment_id,
           'staff_id', v.staff_id,
           'reason', p_reason,
           'lines', count(*),
           'amount', sum(v.amount),
           'adjustment_lines', count(*) FILTER (WHERE v.pay_category IN ('bonus', 'deduction'))
         )
  FROM voided v
  JOIN public.booking_staff_assignments a ON a.id = v.assignment_id
  WHERE a.booking_id IS NOT NULL
  GROUP BY a.booking_id, v.assignment_id, v.staff_id;
END;
$function$;

-- =============================================================================
-- Grants. Internal helpers and *_unchecked: service_role only. Wrappers:
-- authenticated (admin check inside) + service_role. anon never.
-- =============================================================================
REVOKE ALL ON FUNCTION public._revenue_ledger_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._revenue_rollup_unchecked(date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_revenue_summary_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_daily_revenue_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_monthly_revenue_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_revenue_by_category_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_revenue_by_segment_unchecked(date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_revenue_line_items_export_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_daily_generated_revenue_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._payroll_not_payable_reason(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payroll_line_items_export_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payroll_by_staff_unchecked(date, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payroll_by_role_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._void_unpaid_payroll(uuid[], text) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public._revenue_ledger_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._revenue_rollup_unchecked(date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_summary_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_revenue_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_revenue_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_category_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_segment_unchecked(date, date, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_line_items_export_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_generated_revenue_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public._payroll_not_payable_reason(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_line_items_export_unchecked(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_by_staff_unchecked(date, date, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_by_role_unchecked(date, date) TO service_role;

REVOKE ALL ON FUNCTION public.get_revenue_summary(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_daily_revenue(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_monthly_revenue(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_revenue_by_segment(date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_revenue_line_items_export(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payroll_line_items_export(date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_revenue_summary(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_revenue(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_revenue(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_segment(date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_line_items_export(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_line_items_export(date, date) TO authenticated, service_role;
