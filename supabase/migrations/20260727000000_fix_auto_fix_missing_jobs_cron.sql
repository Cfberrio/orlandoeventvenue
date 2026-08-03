-- =====================================================
-- FIX: cron 'auto-fix-missing-jobs-hourly' nunca quedó registrado
-- =====================================================
-- La migración 20260126222113 anidó un bloque DO $$ dentro del string $$ de
-- cron.schedule(). El $$ interno cerraba el string externo, dejando SQL
-- inválido, por lo que el cron de auto-reparación jamás existió en pg_cron.
-- Consecuencia real: bookings reagendados sin jobs pendientes (ej. OEV-E3G92D)
-- quedaron sin host report jobs y nadie los reparó.
--
-- Solución: mover la lógica a una función con dollar-quoting de tag único y
-- registrar el cron con un simple SELECT (mismo patrón que
-- 'process-scheduled-jobs-5min', que sí funciona).

CREATE OR REPLACE FUNCTION public.auto_fix_missing_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $auto_fix$
DECLARE
  booking_record RECORD;
  request_id bigint;
  balance_fixed INT := 0;
  host_fixed INT := 0;
BEGIN
  -- 1. Bookings sin balance jobs
  FOR booking_record IN
    SELECT b.id, b.reservation_number
    FROM bookings b
    WHERE b.payment_status = 'deposit_paid'
      AND b.status != 'cancelled'
      AND b.lifecycle_status = 'pre_event_ready'
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_jobs sj
        WHERE sj.booking_id = b.id AND sj.job_type LIKE 'balance%'
      )
  LOOP
    SELECT net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzNDA2MDIsImV4cCI6MjA3OTkxNjYwMn0.8z3tFxcYHbrVA9ZrRUFwuiI9Sb5StGCrpAvCbRtUgK4"}'::jsonb,
      body := jsonb_build_object('booking_id', booking_record.id)
    ) INTO request_id;

    balance_fixed := balance_fixed + 1;
    RAISE NOTICE '[AUTO-FIX] Repaired booking % (missing balance jobs, request_id: %)',
      booking_record.reservation_number, request_id;
  END LOOP;

  -- 2. Bookings sin host report jobs
  -- Excluye bookings ya en post_event con evento a <=1 día: por diseño no
  -- tienen jobs pendientes (smart catch-up) y no hay nada que reparar.
  FOR booking_record IN
    SELECT b.id, b.reservation_number
    FROM bookings b
    WHERE b.status != 'cancelled'
      AND b.lifecycle_status IN ('pre_event_ready', 'in_progress')
      AND b.event_date >= CURRENT_DATE
      AND NOT (
        b.host_report_step = 'post_event'
        AND b.event_date <= CURRENT_DATE + 1
      )
      AND NOT EXISTS (SELECT 1 FROM booking_host_reports WHERE booking_id = b.id)
      AND NOT EXISTS (
        SELECT 1 FROM scheduled_jobs sj
        WHERE sj.booking_id = b.id
          AND sj.job_type LIKE 'host_report%'
          AND sj.status = 'pending'
      )
  LOOP
    SELECT net.http_post(
      url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/schedule-host-report-reminders',
      headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzNDA2MDIsImV4cCI6MjA3OTkxNjYwMn0.8z3tFxcYHbrVA9ZrRUFwuiI9Sb5StGCrpAvCbRtUgK4"}'::jsonb,
      body := jsonb_build_object('booking_id', booking_record.id, 'force_reschedule', true)
    ) INTO request_id;

    host_fixed := host_fixed + 1;
    RAISE NOTICE '[AUTO-FIX] Repaired booking % (missing host report jobs, request_id: %)',
      booking_record.reservation_number, request_id;
  END LOOP;

  IF balance_fixed + host_fixed > 0 THEN
    RAISE NOTICE '[AUTO-FIX] Completed: % bookings repaired (% balance, % host report)',
      balance_fixed + host_fixed, balance_fixed, host_fixed;
  ELSE
    RAISE NOTICE '[AUTO-FIX] Completed: No bookings needed repair';
  END IF;
END;
$auto_fix$;

-- Desregistrar restos del cron viejo si existieran (no falla si no existe)
DO $cleanup$
BEGIN
  PERFORM cron.unschedule('auto-fix-missing-jobs-hourly');
EXCEPTION
  WHEN OTHERS THEN NULL;
END;
$cleanup$;

-- Registrar el cron con string simple (sin anidamiento de $$)
SELECT cron.schedule(
  'auto-fix-missing-jobs-hourly',
  '15 * * * *',
  'SELECT public.auto_fix_missing_jobs();'
);
