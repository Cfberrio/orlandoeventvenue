CREATE OR REPLACE FUNCTION public.get_daily_generated_revenue(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  generated_date date,
  booking_count bigint,
  total_generated decimal,
  baseline_generated decimal,
  cleaning_generated decimal,
  production_generated decimal,
  addon_generated decimal,
  tax_generated decimal,
  discount_generated decimal
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.deposit_paid_at::date AS generated_date,
    COUNT(*) AS booking_count,
    SUM(b.total_amount) AS total_generated,
    SUM(b.base_rental) AS baseline_generated,
    SUM(b.cleaning_fee) AS cleaning_generated,
    SUM(b.package_cost) AS production_generated,
    SUM(b.optional_services) AS addon_generated,
    SUM(b.taxes_fees) AS tax_generated,
    SUM(-1 * COALESCE(b.discount_amount, 0)) AS discount_generated
  FROM public.bookings b
  WHERE b.deposit_paid_at::date BETWEEN p_start_date AND p_end_date
    AND b.deposit_paid_at IS NOT NULL
    AND b.booking_origin != 'internal'
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY b.deposit_paid_at::date
  ORDER BY b.deposit_paid_at::date;
$$;