-- =====================================================
-- send-internal-booking-reminders: real pg_cron schedule
-- =====================================================
-- The function had its schedule declared only in supabase/config.toml under
-- [functions.send-internal-booking-reminders.cron]. That block is never
-- executed by this project, so the 1-day reminder for internal (admin-created)
-- bookings has NEVER run: availability_block_reminders is empty.
--
-- Orlando observes DST, so a fixed UTC hour drifts by one hour twice a year.
-- The job therefore fires at both candidate UTC hours (12:00 and 13:00) and the
-- body only calls the function during the 08:00–08:59 Orlando window, which
-- happens exactly once per day year-round.
-- =====================================================

SELECT cron.unschedule('send-internal-booking-reminders-8am-orlando')
WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-internal-booking-reminders-8am-orlando'
);

SELECT cron.schedule(
  'send-internal-booking-reminders-8am-orlando',
  '0 12,13 * * *',  -- 08:00 Orlando during EDT (12:00 UTC) and EST (13:00 UTC)
  $$
  SELECT net.http_post(
    url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-internal-booking-reminders',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 20000
  ) AS request_id
  WHERE extract(hour from (now() AT TIME ZONE 'America/New_York')) = 8;
  $$
);

DO $$
BEGIN
  RAISE NOTICE '[INTERNAL-REMINDERS] Cron "send-internal-booking-reminders-8am-orlando" scheduled';
  RAISE NOTICE '[INTERNAL-REMINDERS] Runs 12:00 and 13:00 UTC; body guard keeps exactly one 08:00 Orlando run per day';
END $$;
