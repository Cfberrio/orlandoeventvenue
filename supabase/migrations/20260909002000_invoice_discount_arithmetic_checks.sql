-- Tie the three discount columns together at the database level.
--
-- Nothing stopped discount_amount from exceeding subtotal, or amount from
-- drifting away from `subtotal - discount_amount`. The only enforcement was
-- TypeScript inside one admin dialog, so a future edit screen that changed
-- line_items without recomputing amount would bill the old total against a new
-- breakdown.
--
-- Legacy rows were backfilled with subtotal = amount and discount_amount = 0,
-- so they already satisfy both checks. A NULL subtotal makes both expressions
-- NULL, which a CHECK treats as satisfied — that stays legal on purpose.

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_discount_not_over_subtotal
  CHECK (subtotal IS NULL OR discount_amount <= subtotal);

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_amount_matches_breakdown
  CHECK (subtotal IS NULL OR amount = subtotal - discount_amount);
