-- ClickUp 86e40ach2, second pass, security batch (X2). Idempotent.
--
-- Edge functions the database calls (trigger-booking-automation,
-- schedule-host-report-reminders, schedule-balance-payment, daily-health-check,
-- sync-ghl-calendar) now accept only: the service-role key, an admin session,
-- or the internal secret in the x-sync-secret header (_shared/caller-auth.ts).
-- This migration gives the database that secret and makes every DB caller send
-- it. The headers it adds are ignored by the code deployed today, so it is safe
-- to apply before the functions are redeployed.

-- ---------------------------------------------------------------------------
-- 1. The secret's home. ghl_calendar_sync_config granted anon/authenticated
--    everything and had a SELECT-for-everyone policy, so the public key could
--    read it. Only the database (SECURITY DEFINER triggers) and the service
--    role (edge functions) read it; nothing in src/ does.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.ghl_calendar_sync_config FROM anon, authenticated;
DROP POLICY IF EXISTS "Allow trigger function to read config" ON public.ghl_calendar_sync_config;

UPDATE public.ghl_calendar_sync_config
   SET secret = replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
       updated_at = now()
 WHERE id = 1
   AND (secret IS NULL OR length(btrim(secret)) < 16);

CREATE OR REPLACE FUNCTION public._internal_call_headers()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT jsonb_build_object('Content-Type', 'application/json')
         || CASE WHEN c.secret IS NOT NULL AND btrim(c.secret) <> ''
                 THEN jsonb_build_object('x-sync-secret', c.secret)
                 ELSE '{}'::jsonb END
  FROM (SELECT 1) one
  LEFT JOIN public.ghl_calendar_sync_config c ON c.id = 1;
$function$;
REVOKE ALL ON FUNCTION public._internal_call_headers() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._internal_call_headers() TO service_role;

-- ---------------------------------------------------------------------------
-- 2. DB callers send the secret. Each existing header object is kept and the
--    internal headers are merged into it (|| keeps the anon Authorization the
--    gateway may still expect).
-- ---------------------------------------------------------------------------
DO $mig$
DECLARE
  v_def text;
  v_new text;
BEGIN
  -- auto_trigger_booking_automation -> trigger-booking-automation (two posts)
  v_def := pg_get_functiondef('public.auto_trigger_booking_automation()'::regprocedure);
  IF position('_internal_call_headers' IN v_def) = 0 THEN
    v_new := regexp_replace(v_def,
      $re$headers := jsonb_build_object\(\s*'Content-Type', 'application/json'\s*\)$re$,
      $rp$headers := jsonb_build_object('Content-Type', 'application/json') || public._internal_call_headers()$rp$,
      'g');
    IF (length(v_new) - length(replace(v_new, '_internal_call_headers', ''))) / length('_internal_call_headers') <> 2 THEN
      RAISE EXCEPTION 'auto_trigger_booking_automation: expected 2 header anchors';
    END IF;
    EXECUTE v_new;
  END IF;

  -- auto_fix_missing_jobs -> schedule-balance-payment, schedule-host-report-reminders
  v_def := pg_get_functiondef('public.auto_fix_missing_jobs()'::regprocedure);
  IF position('_internal_call_headers' IN v_def) = 0 THEN
    v_new := regexp_replace(v_def,
      $re$(headers := '\{[^']*\}'::jsonb)$re$,
      $rp$\1 || public._internal_call_headers()$rp$,
      'g');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'auto_fix_missing_jobs: no header anchors found';
    END IF;
    EXECUTE v_new;
  END IF;
END
$mig$;

-- daily-health-check cron: same schedule, headers now carry the secret.
DO $cron$
DECLARE
  v_sched text;
BEGIN
  SELECT schedule INTO v_sched FROM cron.job WHERE jobname = 'daily-health-check-8am-est';
  IF v_sched IS NOT NULL THEN
    PERFORM cron.unschedule('daily-health-check-8am-est');
    PERFORM cron.schedule('daily-health-check-8am-est', v_sched, $cmd$SELECT net.http_post(
    url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/daily-health-check',
    headers := '{"Content-Type": "application/json"}'::jsonb || public._internal_call_headers(),
    body := '{}'::jsonb
  ) AS request_id$cmd$);
  END IF;
END
$cron$;

-- trigger_sync_ghl_calendar and trigger_sync_ghl_calendar_from_assignment
-- already send x-sync-secret from this row once it is set (step 1).

-- ---------------------------------------------------------------------------
-- 3. X2-09: per-IP rate limit for public senders (send-popup-lead,
--    send-contact-form). Same pattern as claim_license_upload_slot.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.public_rate_slots (
  id bigserial PRIMARY KEY,
  bucket text NOT NULL,
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS public_rate_slots_bucket_ip_created_idx ON public.public_rate_slots (bucket, ip, created_at);
ALTER TABLE public.public_rate_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.public_rate_slots FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.public_rate_slots TO service_role;

CREATE OR REPLACE FUNCTION public.claim_public_rate_slot(p_bucket text, p_ip text, p_max integer, p_window_seconds integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_n integer;
BEGIN
  IF p_bucket IS NULL OR p_ip IS NULL OR p_max IS NULL OR p_max < 1 OR p_window_seconds IS NULL OR p_window_seconds < 1 THEN
    RETURN false;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('claim_public_rate_slot:' || p_bucket || ':' || p_ip));
  DELETE FROM public.public_rate_slots
   WHERE bucket = p_bucket AND ip = p_ip AND created_at < now() - interval '1 day';
  SELECT count(*) INTO v_n FROM public.public_rate_slots
   WHERE bucket = p_bucket AND ip = p_ip
     AND created_at > now() - make_interval(secs => p_window_seconds);
  IF v_n >= p_max THEN
    RETURN false;
  END IF;
  INSERT INTO public.public_rate_slots (bucket, ip) VALUES (p_bucket, p_ip);
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_public_rate_slot(text, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_public_rate_slot(text, text, integer, integer) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. X2-07 / X2-16: daily-health-check emails the office once per Orlando day.
--    The old dedupe wrote booking_events with no booking (FK always failed).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.health_check_alert_claims (
  alert_date date PRIMARY KEY,
  issues_count integer,
  total_problems integer,
  critical_count integer,
  high_count integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.health_check_alert_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.health_check_alert_claims FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.health_check_alert_claims TO service_role;

-- ---------------------------------------------------------------------------
-- 5. X2-10: send-low-rating-alert claims one alert per booking.
-- ---------------------------------------------------------------------------
ALTER TABLE public.guest_report_submissions ADD COLUMN IF NOT EXISTS low_rating_alert_sent_at timestamptz;
