-- Hardening for 20260923160000 (Codex review):
--  1. No more anonymous direct writes to the bucket. Uploads go through the
--     upload-driver-license edge function (service role), which rate-limits.
--  2. Files never attached to a booking are deleted after 48h by
--     cleanup-driver-licenses, run hourly from pg_cron.

DROP POLICY IF EXISTS "Guests can upload driver licenses" ON storage.objects;

-- ── Rate limit ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.license_upload_attempts (
  id bigserial PRIMARY KEY,
  ip text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS license_upload_attempts_ip_created_idx
  ON public.license_upload_attempts (ip, created_at);
CREATE INDEX IF NOT EXISTS license_upload_attempts_created_idx
  ON public.license_upload_attempts (created_at);
ALTER TABLE public.license_upload_attempts ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role touches this table.

-- Atomic check-and-claim. The advisory lock serialises concurrent callers so
-- two requests cannot both read "under the limit" and both insert.
-- Limits: 8 per IP per hour (front + back, a few retries), 200 per hour overall.
CREATE OR REPLACE FUNCTION public.claim_license_upload_slot(p_ip text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ip_count int;
  v_total int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('claim_license_upload_slot'));

  DELETE FROM license_upload_attempts WHERE created_at < now() - interval '1 day';

  SELECT count(*) INTO v_ip_count FROM license_upload_attempts
   WHERE ip = p_ip AND created_at > now() - interval '1 hour';
  SELECT count(*) INTO v_total FROM license_upload_attempts
   WHERE created_at > now() - interval '1 hour';

  IF v_ip_count >= 8 OR v_total >= 200 THEN
    RETURN false;
  END IF;

  INSERT INTO license_upload_attempts (ip) VALUES (p_ip);
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_license_upload_slot(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_license_upload_slot(text) TO service_role;

-- ── Orphan cleanup ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.orphan_driver_license_paths(p_limit int DEFAULT 500)
RETURNS TABLE (name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, storage
AS $$
  SELECT o.name
    FROM storage.objects o
   WHERE o.bucket_id = 'driver-licenses'
     AND o.created_at < now() - interval '48 hours'
     AND NOT EXISTS (
       SELECT 1 FROM public.bookings b
        WHERE b.license_front_path = o.name OR b.license_back_path = o.name
     )
   ORDER BY o.created_at
   LIMIT p_limit;
$$;
REVOKE ALL ON FUNCTION public.orphan_driver_license_paths(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orphan_driver_license_paths(int) TO service_role;

CREATE INDEX IF NOT EXISTS bookings_license_front_path_idx ON public.bookings (license_front_path) WHERE license_front_path IS NOT NULL;
CREATE INDEX IF NOT EXISTS bookings_license_back_path_idx ON public.bookings (license_back_path) WHERE license_back_path IS NOT NULL;

-- Same invocation pattern as process-recurring-invoices (20260608120000).
SELECT cron.unschedule('cleanup-driver-licenses-hourly')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-driver-licenses-hourly');
SELECT cron.schedule(
  'cleanup-driver-licenses-hourly',
  '25 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/cleanup-driver-licenses',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzNDA2MDIsImV4cCI6MjA3OTkxNjYwMn0.8z3tFxcYHbrVA9ZrRUFwuiI9Sb5StGCrpAvCbRtUgK4"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
