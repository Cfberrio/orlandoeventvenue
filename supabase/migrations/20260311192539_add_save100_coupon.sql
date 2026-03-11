INSERT INTO discount_coupons (code, discount_type, discount_value, applies_to, applies_to_hourly, applies_to_daily, is_active)
VALUES ('SAVE100', 'fixed_amount', 100, 'base_rental', true, true, true)
ON CONFLICT (code) DO UPDATE SET
  discount_type = EXCLUDED.discount_type,
  discount_value = EXCLUDED.discount_value,
  is_active = EXCLUDED.is_active,
  updated_at = now();
