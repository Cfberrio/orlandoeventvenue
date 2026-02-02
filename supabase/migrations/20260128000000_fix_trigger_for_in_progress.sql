-- =====================================================
-- FIX: Actualizar trigger para incluir lifecycle 'in_progress'
-- =====================================================
-- PROBLEMA IDENTIFICADO:
-- - Booking OEV-G8TW7P se creó directamente con lifecycle_status = 'in_progress'
-- - El trigger solo se disparaba cuando cambiaba a 'pre_event_ready'
-- - Por lo tanto, los host report jobs nunca se crearon
--
-- SOLUCIÓN:
-- - Actualizar el trigger para que también se dispare cuando cambia a 'in_progress'
-- =====================================================

-- Actualizar la función del trigger
CREATE OR REPLACE FUNCTION public.auto_trigger_booking_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  request_id bigint;
BEGIN
  -- Ejecutar cuando cambia A pre_event_ready O in_progress
  -- (pero no si ya estaba en ese estado)
  IF (NEW.lifecycle_status IN ('pre_event_ready', 'in_progress')) AND 
     (OLD.lifecycle_status IS NULL OR 
      OLD.lifecycle_status NOT IN ('pre_event_ready', 'in_progress')) THEN
    
    -- Llamar a trigger-booking-automation via pg_net
    SELECT net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('booking_id', NEW.id)
    ) INTO request_id;
    
    RAISE NOTICE '[AUTO-TRIGGER] Booking automation triggered for booking % (lifecycle: % -> %, request_id: %)', 
      NEW.id, OLD.lifecycle_status, NEW.lifecycle_status, request_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Actualizar comentario de documentación
COMMENT ON FUNCTION public.auto_trigger_booking_automation() IS 
  'Auto-triggers booking automation when lifecycle_status changes to pre_event_ready or in_progress. ' ||
  'Calls trigger-booking-automation Edge Function via pg_net to create balance and host report jobs. ' ||
  'Updated 2026-01-28 to handle bookings that skip pre_event_ready and go directly to in_progress.';

-- Log de la actualización
DO $$
BEGIN
  RAISE NOTICE '[FIX-TRIGGER] Trigger function updated successfully';
  RAISE NOTICE '[FIX-TRIGGER] Now triggers on both pre_event_ready AND in_progress lifecycle changes';
  RAISE NOTICE '[FIX-TRIGGER] This prevents issues where bookings skip pre_event_ready (fast payments)';
END $$;
