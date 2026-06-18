-- Allow discount coupons to target the full subtotal, not just the base rental.
-- discount_coupons.applies_to already exists (TEXT, default 'base_rental').
-- This adds an explicit CHECK so only the supported targets are stored:
--   'base_rental' -> discount applies to base rental only (legacy/default)
--   'total'       -> discount applies to the full subtotal
--                    (rental + cleaning + package + optional services + bar),
--                    BEFORE the processing fee, which is always added on top.

ALTER TABLE discount_coupons
  DROP CONSTRAINT IF EXISTS discount_coupons_applies_to_check;

ALTER TABLE discount_coupons
  ADD CONSTRAINT discount_coupons_applies_to_check
  CHECK (applies_to IN ('base_rental', 'total'));

COMMENT ON COLUMN discount_coupons.applies_to IS
  'Discount target: base_rental (base rental only) or total (full subtotal before processing fee).';
