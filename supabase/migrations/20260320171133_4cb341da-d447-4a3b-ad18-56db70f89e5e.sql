CREATE OR REPLACE FUNCTION public.trigger_sync_ghl_calendar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
  request_id bigint;
  headers jsonb;
BEGIN
  -- LEAD GUARD: Skip GHL calendar sync for unpaid website bookings (leads).
  -- bookings with payment_status='pending' are leads that haven't paid deposit yet.
  -- Only sync to GHL calendar once payment is confirmed (deposit_paid, fully_paid, invoiced).
  -- Exception: internal_admin bookings bypass this guard.
  IF NEW.payment_status = 'pending' AND COALESCE(NEW.lead_source, '') != 'internal_admin' THEN
    RAISE NOTICE 'Skipping GHL calendar sync for booking % — payment_status is pending (lead)', NEW.id;
    RETURN NEW;
  END IF;

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
$function$;