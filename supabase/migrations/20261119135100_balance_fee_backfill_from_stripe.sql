-- V2-8 / M-12 (second pass, ClickUp 86e40ach2), applied 2026-11-19.
-- The M-12 backfill fixed deposits only. 15 balance payments still stored a flat-3.5% fee
-- (or a fee where none was charged: LR5V8D, N9P8AE). Ground truth = Stripe amount_cents in
-- stripe_event_log (one completed balance checkout per booking). Store what Stripe charged.
-- Fee columns are not in the GHL sync trigger's column list, so no GHL update fires.
WITH s AS (
  SELECT booking_id, count(*) AS n, sum((metadata->>'amount_cents')::int) / 100.0 AS paid
  FROM public.stripe_event_log
  WHERE event_type = 'checkout.session.completed'
    AND metadata->>'payment_type' = 'balance'
    AND COALESCE(metadata->>'claim_state', 'completed') = 'completed'
  GROUP BY booking_id
)
UPDATE public.bookings b
SET balance_total_charged = round(s.paid, 2),
    balance_fee = round(s.paid - b.balance_amount, 2),
    updated_at = now()
FROM s
WHERE s.booking_id = b.id
  AND s.n = 1
  AND s.paid >= b.balance_amount
  AND abs(COALESCE(b.balance_total_charged, 0) - s.paid) > 0.009;
