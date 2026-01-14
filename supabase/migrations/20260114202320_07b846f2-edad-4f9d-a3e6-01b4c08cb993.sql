-- Enable pg_net for HTTP calls from triggers
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Config table for sync function URL and secret
CREATE TABLE IF NOT EXISTS public.ghl_calendar_sync_config (
  id int PRIMARY KEY DEFAULT 1,
  function_url text NOT NULL,
  secret text NULL,
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT single_config CHECK (id = 1)
);

-- Insert default config (update with your actual Supabase project ref)
INSERT INTO public.ghl_calendar_sync_config (id, function_url, secret)
VALUES (
  1,
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-ghl-calendar',
  NULL -- Set to match BOOKING_SYNC_WEBHOOK_SECRET if you enable it
)
ON CONFLICT (id) DO UPDATE SET
  function_url = EXCLUDED.function_url,
  updated_at = now();

-- Trigger function to call sync-ghl-calendar via HTTP
CREATE OR REPLACE FUNCTION public.trigger_sync_ghl_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg record;
  request_id bigint;
  headers jsonb;
BEGIN
  -- Get config
  SELECT * INTO cfg FROM public.ghl_calendar_sync_config WHERE id = 1;
  
  IF cfg.function_url IS NULL THEN
    RAISE NOTICE 'GHL calendar sync URL not configured, skipping';
    RETURN NEW;
  END IF;

  -- Build headers
  headers := '{"Content-Type": "application/json"}'::jsonb;
  IF cfg.secret IS NOT NULL AND cfg.secret != '' THEN
    headers := headers || jsonb_build_object('x-sync-secret', cfg.secret);
  END IF;

  -- Call function via pg_net (async)
  SELECT net.http_post(
    url := cfg.function_url,
    headers := headers,
    body := jsonb_build_object(
      'booking_id', NEW.id,
      'skip_if_unchanged', true
    )
  ) INTO request_id;
  
  RAISE NOTICE 'Triggered GHL calendar sync for booking % (request_id: %)', NEW.id, request_id;
  RETURN NEW;
END;
$$;

-- Trigger function for staff assignments (uses booking_id from assignment)
CREATE OR REPLACE FUNCTION public.trigger_sync_ghl_calendar_from_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg record;
  request_id bigint;
  target_booking_id uuid;
  headers jsonb;
BEGIN
  -- Get booking_id from NEW or OLD (for DELETE)
  IF TG_OP = 'DELETE' THEN
    target_booking_id := OLD.booking_id;
  ELSE
    target_booking_id := NEW.booking_id;
  END IF;

  -- Get config
  SELECT * INTO cfg FROM public.ghl_calendar_sync_config WHERE id = 1;
  
  IF cfg.function_url IS NULL THEN
    RAISE NOTICE 'GHL calendar sync URL not configured, skipping';
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Build headers
  headers := '{"Content-Type": "application/json"}'::jsonb;
  IF cfg.secret IS NOT NULL AND cfg.secret != '' THEN
    headers := headers || jsonb_build_object('x-sync-secret', cfg.secret);
  END IF;

  -- Call function via pg_net
  SELECT net.http_post(
    url := cfg.function_url,
    headers := headers,
    body := jsonb_build_object(
      'booking_id', target_booking_id,
      'skip_if_unchanged', false  -- Force update when staff changes
    )
  ) INTO request_id;
  
  RAISE NOTICE 'Triggered GHL calendar sync for booking % from staff assignment (request_id: %)', target_booking_id, request_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ========================================
-- TRIGGERS ON bookings
-- ========================================

-- Trigger for INSERT (new booking)
DROP TRIGGER IF EXISTS bookings_sync_ghl_insert ON public.bookings;
CREATE TRIGGER bookings_sync_ghl_insert
  AFTER INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_ghl_calendar();

-- Trigger for UPDATE (only relevant columns, NOT ghl_* to avoid loops)
DROP TRIGGER IF EXISTS bookings_sync_ghl_update ON public.bookings;
CREATE TRIGGER bookings_sync_ghl_update
  AFTER UPDATE OF 
    event_date,
    start_time,
    end_time,
    booking_type,
    status,
    full_name,
    email,
    phone,
    number_of_guests,
    event_type
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_ghl_calendar();

-- ========================================
-- TRIGGERS ON booking_staff_assignments
-- ========================================

DROP TRIGGER IF EXISTS staff_assignments_sync_ghl_insert ON public.booking_staff_assignments;
CREATE TRIGGER staff_assignments_sync_ghl_insert
  AFTER INSERT ON public.booking_staff_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_ghl_calendar_from_assignment();

DROP TRIGGER IF EXISTS staff_assignments_sync_ghl_update ON public.booking_staff_assignments;
CREATE TRIGGER staff_assignments_sync_ghl_update
  AFTER UPDATE ON public.booking_staff_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_ghl_calendar_from_assignment();

DROP TRIGGER IF EXISTS staff_assignments_sync_ghl_delete ON public.booking_staff_assignments;
CREATE TRIGGER staff_assignments_sync_ghl_delete
  AFTER DELETE ON public.booking_staff_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_sync_ghl_calendar_from_assignment();

-- Add comment for documentation
COMMENT ON FUNCTION public.trigger_sync_ghl_calendar() IS 
  'Auto-sync booking changes to GHL calendar via pg_net HTTP POST';

COMMENT ON FUNCTION public.trigger_sync_ghl_calendar_from_assignment() IS 
  'Auto-sync booking when staff assignments change';

COMMENT ON TABLE public.ghl_calendar_sync_config IS
  'Configuration for GHL calendar sync triggers (function URL and optional webhook secret)';