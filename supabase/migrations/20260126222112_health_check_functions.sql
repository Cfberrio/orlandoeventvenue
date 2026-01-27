-- =====================================================
-- MEJORA #4: Funciones SQL de Soporte para Health Check
-- =====================================================
-- Estas funciones cuentan bookings con problemas
-- para el sistema de monitoreo diario
-- =====================================================

-- Función para contar bookings sin balance jobs
CREATE OR REPLACE FUNCTION public.count_bookings_without_balance_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result INTEGER;
BEGIN
  SELECT COUNT(*) INTO result
  FROM bookings b
  WHERE b.payment_status = 'deposit_paid'
    AND b.status != 'cancelled'
    AND b.lifecycle_status = 'pre_event_ready'
    AND NOT EXISTS (
      SELECT 1 FROM scheduled_jobs sj 
      WHERE sj.booking_id = b.id 
      AND sj.job_type LIKE 'balance%'
    );
  RETURN result;
END;
$$;

-- Función para contar bookings sin host report jobs
CREATE OR REPLACE FUNCTION public.count_bookings_without_host_jobs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result INTEGER;
BEGIN
  SELECT COUNT(*) INTO result
  FROM bookings b
  WHERE b.status != 'cancelled'
    AND b.lifecycle_status IN ('pre_event_ready', 'in_progress')
    AND b.event_date >= CURRENT_DATE
    AND NOT EXISTS (SELECT 1 FROM booking_host_reports WHERE booking_id = b.id)
    AND NOT EXISTS (
      SELECT 1 FROM scheduled_jobs sj 
      WHERE sj.booking_id = b.id 
      AND sj.job_type LIKE 'host_report%'
      AND sj.status = 'pending'
    );
  RETURN result;
END;
$$;

-- Add comments for documentation
COMMENT ON FUNCTION public.count_bookings_without_balance_jobs() IS 
  'Returns count of bookings that should have balance payment jobs but don''t. ' ||
  'Used by daily-health-check function to detect system issues.';

COMMENT ON FUNCTION public.count_bookings_without_host_jobs() IS 
  'Returns count of bookings that should have host report jobs but don''t. ' ||
  'Used by daily-health-check function to detect system issues.';
