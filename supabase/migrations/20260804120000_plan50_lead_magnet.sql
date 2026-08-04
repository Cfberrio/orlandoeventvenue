-- PLAN50 lead magnet: replaces HOST100 popup offer with Event Planning Kit + $50 OFF
-- Spec: ClickUp doc 8cqnrff-4977 / page 8cqnrff-11737 (OEV Lead Magnet System)

-- 1. popup_leads: store phone + consent evidence + lead source (spec section 8)
ALTER TABLE public.popup_leads
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS consent_given BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS consent_text TEXT,
  ADD COLUMN IF NOT EXISTS lead_source TEXT DEFAULT 'website_popup';

-- 2. New leads default to PLAN50
ALTER TABLE public.popup_leads
  ALTER COLUMN coupon_code SET DEFAULT 'PLAN50';

-- 3. PLAN50 coupon: exactly $50 off base rental, hourly + daily, no expiration
--    (individual per-contact expiration is deferred per the doc's developer note)
INSERT INTO public.discount_coupons (code, discount_type, discount_value, applies_to, applies_to_hourly, applies_to_daily, is_active)
VALUES ('PLAN50', 'fixed_amount', 50, 'base_rental', true, true, true)
ON CONFLICT (code) DO UPDATE SET
  discount_type = EXCLUDED.discount_type,
  discount_value = EXCLUDED.discount_value,
  applies_to = EXCLUDED.applies_to,
  applies_to_hourly = EXCLUDED.applies_to_hourly,
  applies_to_daily = EXCLUDED.applies_to_daily,
  is_active = true,
  updated_at = now();

-- 4. Retire the old offers (testing matrix: HOST100 / $100 must appear nowhere)
UPDATE public.discount_coupons
SET is_active = false, updated_at = now()
WHERE code IN ('HOST100', 'SAVE100', 'SAVE50');
