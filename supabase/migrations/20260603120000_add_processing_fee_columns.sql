-- Persist the actual Stripe-charged amounts (subtotal + 3.5% fee) across all monetary tables.
-- Previously the fee was recomputed at runtime in each edge function, causing display
-- mismatches between Stripe, dashboard, PDFs, and GHL emails.

-- bookings: store deposit and balance with their respective fees
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS processing_fee_pct  DECIMAL(5,2)  DEFAULT 3.5,
  ADD COLUMN IF NOT EXISTS deposit_fee         DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deposit_total_charged DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS balance_fee         DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS balance_total_charged DECIMAL(10,2);

-- Backfill existing rows using their stored amounts and the default 3.5% rate.
-- This approximates the fee that was charged; exact amounts are in Stripe.
UPDATE public.bookings
SET
  deposit_fee            = ROUND(deposit_amount * 0.035, 2),
  deposit_total_charged  = deposit_amount + ROUND(deposit_amount * 0.035, 2),
  balance_fee            = ROUND(balance_amount * 0.035, 2),
  balance_total_charged  = balance_amount + ROUND(balance_amount * 0.035, 2)
WHERE deposit_total_charged IS NULL;

-- invoices (standalone): store the fee and what Stripe actually charges
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS processing_fee_pct DECIMAL(5,2)  DEFAULT 3.5,
  ADD COLUMN IF NOT EXISTS processing_fee     DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_charged      DECIMAL(10,2);

-- Backfill invoices
UPDATE public.invoices
SET
  processing_fee = ROUND(amount * 0.035, 2),
  total_charged  = amount + ROUND(amount * 0.035, 2)
WHERE total_charged IS NULL;

-- booking_addon_invoices: same
ALTER TABLE public.booking_addon_invoices
  ADD COLUMN IF NOT EXISTS processing_fee_pct DECIMAL(5,2)  DEFAULT 3.5,
  ADD COLUMN IF NOT EXISTS processing_fee     DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_charged      DECIMAL(10,2);

-- Backfill addon invoices
UPDATE public.booking_addon_invoices
SET
  processing_fee = ROUND(total_amount * 0.035, 2),
  total_charged  = total_amount + ROUND(total_amount * 0.035, 2)
WHERE total_charged IS NULL;
