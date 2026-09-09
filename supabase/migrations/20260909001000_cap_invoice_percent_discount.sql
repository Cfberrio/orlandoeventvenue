-- Defense in depth for percentage discounts on invoices.
--
-- computeDiscountAmount() already clamps the discount to [0, subtotal] in the
-- admin UI, but nothing stopped a direct insert (a script, a future admin tool,
-- a manual correction) from storing discount_value = 250 with type 'percent'.
-- The clamp belongs in the database too.
--
-- NULL discount_value stays legal: that is what an invoice with no discount holds.

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_percent_discount_max
  CHECK (
    discount_type IS DISTINCT FROM 'percent'
    OR discount_value IS NULL
    OR discount_value <= 100
  );
