-- Fix trigger to fire on BOTH pre_event_ready AND in_progress lifecycle transitions
-- This ensures bookings created directly in 'in_progress' state also get their jobs scheduled

CREATE OR REPLACE FUNCTION public.auto_trigger_booking_automation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  request_id bigint;
  retry_request_id bigint;
BEGIN
  -- Trigger when lifecycle changes TO 'pre_event_ready' OR 'in_progress' (from a different state)
  IF (NEW.lifecycle_status IN ('pre_event_ready', 'in_progress')) AND 
     (OLD.lifecycle_status IS NULL OR OLD.lifecycle_status NOT IN ('pre_event_ready', 'in_progress')) THEN
    
    -- First attempt: Call trigger-booking-automation via pg_net
    SELECT net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object('booking_id', NEW.id)
    ) INTO request_id;
    
    -- If first request failed (null or negative), retry after delay
    IF request_id IS NULL OR request_id < 0 THEN
      PERFORM pg_sleep(5);
      
      SELECT net.http_post(
        url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation',
        headers := jsonb_build_object(
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object('booking_id', NEW.id)
      ) INTO retry_request_id;
      
      IF retry_request_id IS NULL OR retry_request_id < 0 THEN
        -- Both attempts failed, log to booking_events
        INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
        VALUES (
          NEW.id,
          'automation_trigger_failed',
          'system',
          jsonb_build_object(
            'error', 'Both HTTP attempts to trigger-booking-automation failed',
            'first_request_id', request_id,
            'retry_request_id', retry_request_id,
            'lifecycle_status', NEW.lifecycle_status,
            'timestamp', NOW()
          )
        );
        RAISE WARNING '[AUTO-TRIGGER] Both attempts failed for booking %', NEW.id;
      ELSE
        RAISE NOTICE '[AUTO-TRIGGER] Retry succeeded for booking % (request_id: %)', NEW.id, retry_request_id;
      END IF;
    ELSE
      RAISE NOTICE '[AUTO-TRIGGER] Automation triggered for booking % on % transition (request_id: %)', 
        NEW.id, NEW.lifecycle_status, request_id;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Ensure trigger exists on bookings table
DROP TRIGGER IF EXISTS bookings_auto_trigger_automation ON public.bookings;

CREATE TRIGGER bookings_auto_trigger_automation
  AFTER UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_trigger_booking_automation();