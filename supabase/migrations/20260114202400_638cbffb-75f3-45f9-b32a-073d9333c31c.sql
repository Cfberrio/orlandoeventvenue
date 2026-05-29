-- Enable RLS on ghl_calendar_sync_config
ALTER TABLE public.ghl_calendar_sync_config ENABLE ROW LEVEL SECURITY;

-- Only admins can view/modify the sync config
CREATE POLICY "Admins can manage ghl_calendar_sync_config" 
ON public.ghl_calendar_sync_config 
FOR ALL 
USING (has_role(auth.uid(), 'admin'::app_role));

-- Allow service role (triggers run as SECURITY DEFINER, so they bypass RLS anyway)
-- But we need a SELECT policy for the trigger function to read config
CREATE POLICY "Allow trigger function to read config"
ON public.ghl_calendar_sync_config
FOR SELECT
USING (true);

-- Fix search_path on trigger functions
CREATE OR REPLACE FUNCTION public.trigger_sync_ghl_calendar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg record;
  request_id bigint;
  headers jsonb;
BEGIN
  SELECT * INTO cfg FROM public.ghl_calendar_sync_config WHERE id = 1;
  
  IF cfg.function_url IS NULL THEN
    RAISE NOTICE 'GHL calendar sync URL not configured, skipping';
    RETURN NEW;
  END IF;

  headers := '{"Content-Type": "application/json"}'::jsonb;
  IF cfg.secret IS NOT NULL AND cfg.secret != '' THEN
    headers := headers || jsonb_build_object('x-sync-secret', cfg.secret);
  END IF;

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

CREATE OR REPLACE FUNCTION public.trigger_sync_ghl_calendar_from_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cfg record;
  request_id bigint;
  target_booking_id uuid;
  headers jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_booking_id := OLD.booking_id;
  ELSE
    target_booking_id := NEW.booking_id;
  END IF;

  SELECT * INTO cfg FROM public.ghl_calendar_sync_config WHERE id = 1;
  
  IF cfg.function_url IS NULL THEN
    RAISE NOTICE 'GHL calendar sync URL not configured, skipping';
    RETURN COALESCE(NEW, OLD);
  END IF;

  headers := '{"Content-Type": "application/json"}'::jsonb;
  IF cfg.secret IS NOT NULL AND cfg.secret != '' THEN
    headers := headers || jsonb_build_object('x-sync-secret', cfg.secret);
  END IF;

  SELECT net.http_post(
    url := cfg.function_url,
    headers := headers,
    body := jsonb_build_object(
      'booking_id', target_booking_id,
      'skip_if_unchanged', false
    )
  ) INTO request_id;
  
  RAISE NOTICE 'Triggered GHL calendar sync for booking % from staff assignment (request_id: %)', target_booking_id, request_id;
  RETURN COALESCE(NEW, OLD);
END;
$$;