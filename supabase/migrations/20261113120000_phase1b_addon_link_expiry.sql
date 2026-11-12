-- Phase 1B / M-30 (ClickUp 86e40ach2): add-on payment links that are dead.
--
-- create-addon-invoice opens a Stripe Checkout Session without expires_at, so
-- Stripe closes it 24h after creation. The row stayed "pending" and the admin
-- kept offering the dead link, so the office regenerated links (CNZQVC: 3 for
-- one package) and an unpaid twin sat next to the paid one (CDYXE2).
--
-- 1. expire_stale_addon_invoices(): marks pending rows whose session is older
--    than 25h (24h Stripe lifetime + 1h margin) as 'expired'. A late payment
--    still lands: the webhook marks paid on paid_at IS NULL, whatever the status.
-- 2. Runs once now (backfill) and hourly from pg_cron.
-- Rows with no Stripe session (link never created) are left alone.

CREATE OR REPLACE FUNCTION public.expire_stale_addon_invoices()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.booking_addon_invoices
    SET payment_status = 'expired'
    WHERE payment_status = 'pending'
      AND paid_at IS NULL
      AND stripe_session_id IS NOT NULL
      AND created_at < now() - interval '25 hours'
    RETURNING id, booking_id
  ), logged AS (
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    SELECT booking_id, 'addon_invoice_link_expired', 'system',
           jsonb_build_object('invoice_id', id, 'reason', 'stripe_checkout_session_24h')
    FROM expired
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM logged;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_addon_invoices() FROM PUBLIC, anon, authenticated;

SELECT public.expire_stale_addon_invoices();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-stale-addon-invoices-hourly') THEN
    PERFORM cron.unschedule('expire-stale-addon-invoices-hourly');
  END IF;
  PERFORM cron.schedule(
    'expire-stale-addon-invoices-hourly',
    '40 * * * *',
    'SELECT public.expire_stale_addon_invoices();'
  );
END $$;
