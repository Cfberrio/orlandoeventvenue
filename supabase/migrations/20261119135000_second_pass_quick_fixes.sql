-- Second-pass audit quick fixes (ClickUp 86e40ach2), applied 2026-11-19.
--
-- X2-05: sms_draft_log had RLS off and anon SELECT/INSERT/UPDATE/DELETE, so the public
-- website key could read every inbound customer message (566 rows, phones + emails).
-- Only ghl-sms-draft uses it, with the service role (which bypasses RLS).
ALTER TABLE public.sms_draft_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sms_draft_log FROM anon, authenticated;

-- V2-6: migration 20261117140000 added booking_addon_invoices_payment_status_check (with 'void')
-- but dropped the wrong name, so the legacy CHECK without 'void' still made every add-on void fail.
ALTER TABLE public.booking_addon_invoices DROP CONSTRAINT IF EXISTS valid_payment_status;

-- X2-03 / CM2-19: pg_cron job "sync-blocked-slots-hourly" calls sync-blocked-slots-cron, a function
-- deleted from the repo on 2026-01-11 (9649df3) but still deployed; it fails every hour with
-- "GHL API error: 422". Unscheduled. To restore (not recommended), re-create the job with:
--   SELECT cron.schedule('sync-blocked-slots-hourly', '0 * * * *',
--     $$SELECT net.http_post(url:='https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-blocked-slots-cron',
--       headers:='{"Content-Type":"application/json","Authorization":"Bearer <anon key>"}'::jsonb, body:='{}'::jsonb)$$);
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-blocked-slots-hourly') THEN
    PERFORM cron.unschedule('sync-blocked-slots-hourly');
  END IF;
END $$;
