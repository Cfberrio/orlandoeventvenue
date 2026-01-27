-- =====================================================
-- PARTE 1: Trigger Automático y Funciones de Health Check
-- =====================================================

-- Función que se ejecuta cuando lifecycle_status cambia
CREATE OR REPLACE FUNCTION public.auto_trigger_booking_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
BEGIN
  -- Solo ejecutar cuando cambia A pre_event_ready (no cuando ya estaba en pre_event_ready)
  IF NEW.lifecycle_status = 'pre_event_ready' AND 
     (OLD.lifecycle_status IS NULL OR OLD.lifecycle_status != 'pre_event_ready') THEN
    
    -- Llamar a trigger-booking-automation via pg_net
    SELECT net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('booking_id', NEW.id)
    ) INTO request_id;
    
    RAISE NOTICE '[AUTO-TRIGGER] Booking automation triggered for booking % (request_id: %)', NEW.id, request_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Crear el trigger
DROP TRIGGER IF EXISTS bookings_auto_trigger_automation ON public.bookings;
CREATE TRIGGER bookings_auto_trigger_automation
  AFTER UPDATE OF lifecycle_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_trigger_booking_automation();

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