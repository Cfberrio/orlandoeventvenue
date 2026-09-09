-- Discount support for standalone invoices (percentage or fixed dollar amount).
--
-- `amount` stays the source of truth for Stripe, the processing fee, the 20%
-- connected-account transfer, the webhook receipt and revenue reports, so it
-- holds the NET owed after the discount. The pre-discount figure lives in
-- `subtotal` and exists only so the breakdown can be displayed.
--
--   subtotal        = sum(line_items)
--   discount_amount = dollars taken off
--   amount          = subtotal - discount_amount   (the existing amount > 0 check still applies)

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS subtotal        numeric,
  ADD COLUMN IF NOT EXISTS discount_type   text CHECK (discount_type IN ('percent', 'fixed')),
  ADD COLUMN IF NOT EXISTS discount_value  numeric CHECK (discount_value >= 0),
  ADD COLUMN IF NOT EXISTS discount_amount numeric NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);

-- Existing invoices carry no discount, so their subtotal equals their amount.
-- Without this backfill the dashboard and receipts would render an empty subtotal.
UPDATE public.invoices
SET subtotal = amount
WHERE subtotal IS NULL;
