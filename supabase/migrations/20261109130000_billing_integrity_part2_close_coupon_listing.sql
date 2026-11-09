-- Billing integrity, part 2 (ClickUp 86e3zfnm0).
--
-- APPLY ONLY AFTER the booking page that calls validate_discount_code() is
-- published on orlandoeventvenue.org. Until then the live page still reads
-- discount_coupons directly and every code would show as invalid.
--
-- Removes the last public access to the coupon table: anyone could list every
-- active code (including 100%-off ones) with the public anon key.

DROP POLICY IF EXISTS "Public can read active coupons" ON public.discount_coupons;
