-- Fix timezone: use America/New_York instead of UTC for created_at grouping
CREATE OR REPLACE FUNCTION public.get_daily_generated_revenue(p_start_date date, p_end_date date)
 RETURNS TABLE(generated_date date, booking_count bigint, total_generated numeric, baseline_generated numeric, cleaning_generated numeric, production_generated numeric, addon_generated numeric, tax_generated numeric, discount_generated numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (b.created_at AT TIME ZONE 'America/New_York')::date AS generated_date, COUNT(*) AS booking_count,
    SUM(b.total_amount) AS total_generated, SUM(b.base_rental) AS baseline_generated,
    SUM(b.cleaning_fee) AS cleaning_generated, SUM(b.package_cost) AS production_generated,
    SUM(b.optional_services) AS addon_generated, SUM(b.taxes_fees) AS tax_generated,
    SUM(-1 * COALESCE(b.discount_amount, 0)) AS discount_generated
  FROM public.bookings b
  WHERE (b.created_at AT TIME ZONE 'America/New_York')::date BETWEEN p_start_date AND p_end_date
    AND b.booking_origin = 'website' AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY (b.created_at AT TIME ZONE 'America/New_York')::date ORDER BY (b.created_at AT TIME ZONE 'America/New_York')::date;
$function$;