CREATE OR REPLACE FUNCTION public.trigger_sync_ghl_calendar_from_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  cfg record;
  request_id bigint;
  target_booking_id uuid;
  v_payment_status text;
  v_lead_source text;
  headers jsonb;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_booking_id := OLD.booking_id;
  ELSE
    target_booking_id := NEW.booking_id;
  END IF;

  IF target_booking_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT b.payment_status::text, COALESCE(b.lead_source, '')
    INTO v_payment_status, v_lead_source
  FROM public.bookings b
  WHERE b.id = target_booking_id;

  IF v_payment_status = 'pending' AND v_lead_source <> 'internal_admin' THEN
    RAISE NOTICE '[LEAD GUARD] Skipping GHL calendar sync from assignment trigger for booking % (payment_status=pending)', target_booking_id;
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT * INTO cfg FROM public.ghl_calendar_sync_config WHERE id = 1;

  IF cfg.function_url IS NULL THEN
    RAISE NOTICE 'GHL calendar sync URL not configured, skipping';
    RETURN COALESCE(NEW, OLD);
  END IF;

  headers := '{"Content-Type": "application/json"}'::jsonb;
  IF cfg.secret IS NOT NULL AND cfg.secret <> '' THEN
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
$function$;