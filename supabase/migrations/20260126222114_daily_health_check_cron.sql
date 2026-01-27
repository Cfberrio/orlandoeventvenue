-- =====================================================
-- MEJORA #4: Cron Job para Health Check Diario
-- =====================================================
-- Este cron job ejecuta el health check diariamente
-- y envía email solo si hay problemas detectados
-- =====================================================

-- Cron job que ejecuta el health check todos los días a las 8:00 AM EST
SELECT cron.schedule(
  'daily-health-check-8am-est',
  '0 13 * * *',  -- 13:00 UTC = 8:00 AM EST (UTC-5)
  $$
  SELECT net.http_post(
    url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/daily-health-check',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzUyNDgwMiwiZXhwIjoyMDQ5MTAwODAyfQ.YOUR_ACTUAL_SERVICE_ROLE_KEY_HERE"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

-- Log the cron job creation
DO $$
BEGIN
  RAISE NOTICE '[HEALTH-CHECK] Cron job "daily-health-check-8am-est" scheduled successfully';
  RAISE NOTICE '[HEALTH-CHECK] Schedule: Every day at 8:00 AM EST (13:00 UTC)';
  RAISE NOTICE '[HEALTH-CHECK] Purpose: Check system health and send email alerts to orlandoglobalministries@gmail.com';
  RAISE NOTICE '[HEALTH-CHECK] Email: Only sent when problems are detected';
END $$;
