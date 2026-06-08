-- =====================================================
-- FIX: Recurring invoices were never sending
-- =====================================================
-- The process-recurring-invoices edge function existed and worked, but its
-- schedule lived ONLY in config.toml ([functions.process-recurring-invoices.cron]),
-- which is not active in this project. Every other working cron is a real
-- pg_cron job created in a migration (see process-scheduled-jobs, daily-health-check).
-- This migration registers the missing pg_cron job, matching that proven pattern.
--
-- Schedule: 19:00 and 20:00 UTC daily = 3 PM Orlando year-round
--   EDT (summer, UTC-4): 19:00 UTC = 3 PM, second run at 4 PM is a harmless no-op
--   EST (winter, UTC-5): 20:00 UTC = 3 PM
-- Running twice is safe: the function bumps recurring_next_send_at after each send,
-- so the second run finds nothing due.
-- =====================================================

-- STEP 1 — Prevent a duplicate send.
-- Any active recurring parent whose next-send is already in the past would be
-- treated as "due" the moment the cron goes live and sent immediately. The
-- overdue occurrence was already sent manually, so advance each overdue parent
-- forward on its own cadence to the next 3 PM America/New_York strictly in the
-- future (preserves day-of-cycle alignment; handles any interval incl. daily).
UPDATE public.invoices i
SET recurring_next_send_at = (
  (
    (i.recurring_next_send_at AT TIME ZONE 'America/New_York')::date
    + (
        (
          floor(
            (
              (now() AT TIME ZONE 'America/New_York')::date
              - (i.recurring_next_send_at AT TIME ZONE 'America/New_York')::date
            )::numeric / i.recurring_interval_days
          ) + 1
        )::int * i.recurring_interval_days
      ) * interval '1 day'
  )::date + interval '15 hours'
) AT TIME ZONE 'America/New_York'
WHERE i.is_recurring = true
  AND i.recurring_parent_id IS NULL
  AND i.recurring_active = true
  AND i.recurring_interval_days IS NOT NULL
  AND i.recurring_interval_days > 0
  AND i.recurring_next_send_at <= now();

-- STEP 2 — Register the missing cron job (idempotent).
DO $$
BEGIN
  PERFORM cron.unschedule('process-recurring-invoices-3pm-et');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'process-recurring-invoices-3pm-et',
  '0 19,20 * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/process-recurring-invoices',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzNDA2MDIsImV4cCI6MjA3OTkxNjYwMn0.8z3tFxcYHbrVA9ZrRUFwuiI9Sb5StGCrpAvCbRtUgK4"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);

DO $$
BEGIN
  RAISE NOTICE '[RECURRING-INVOICES] Cron "process-recurring-invoices-3pm-et" scheduled (19:00 & 20:00 UTC = 3 PM Orlando)';
END $$;
