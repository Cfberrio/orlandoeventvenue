-- =====================================================
-- MEJORA #1: Trigger Automático para Booking Automation
-- =====================================================
-- Este trigger ejecuta automáticamente trigger-booking-automation
-- cuando un booking cambia a lifecycle_status = 'pre_event_ready'
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

-- Add comment for documentation
COMMENT ON FUNCTION public.auto_trigger_booking_automation() IS 
  'Auto-triggers booking automation when lifecycle_status changes to pre_event_ready. ' ||
  'Calls trigger-booking-automation Edge Function via pg_net to create balance and host report jobs.';

COMMENT ON TRIGGER bookings_auto_trigger_automation ON public.bookings IS
  'Automatically executes trigger-booking-automation when booking reaches pre_event_ready status';
