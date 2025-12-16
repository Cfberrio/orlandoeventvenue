-- Change cron job to run every 5 minutes instead of hourly for better precision
SELECT cron.unschedule('process-scheduled-jobs-hourly');

SELECT cron.schedule(
  'process-scheduled-jobs-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/process-scheduled-jobs',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzNDA2MDIsImV4cCI6MjA3OTkxNjYwMn0.8z3tFxcYHbrVA9ZrRUFwuiI9Sb5StGCrpAvCbRtUgK4"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);