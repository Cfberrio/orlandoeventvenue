-- =====================================================
-- MEJORA #2: Cron Job de Auto-Reparación
-- =====================================================
-- Este cron job se ejecuta cada hora para detectar y reparar
-- bookings que deberían tener jobs pero no los tienen
-- =====================================================

-- Cron job que repara bookings sin jobs automáticamente
SELECT cron.schedule(
  'auto-fix-missing-jobs-hourly',
  '15 * * * *',  -- Cada hora a los 15 minutos (para no coincidir con process-scheduled-jobs)
  $$
  DO $$
  DECLARE
    booking_record RECORD;
    request_id bigint;
    fixed_count INT := 0;
    balance_fixed INT := 0;
    host_fixed INT := 0;
  BEGIN
    RAISE NOTICE '[AUTO-FIX] Starting auto-fix job at %', NOW();
    
    -- =====================================================
    -- 1. Buscar y reparar bookings sin balance jobs
    -- =====================================================
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
      -- Llamar a trigger-booking-automation para reparar
      SELECT net.http_post(
        url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object('booking_id', booking_record.id)
      ) INTO request_id;
      
      balance_fixed := balance_fixed + 1;
      RAISE NOTICE '[AUTO-FIX] Repaired booking % (missing balance jobs, request_id: %)', 
        booking_record.reservation_number, request_id;
    END LOOP;
    
    -- =====================================================
    -- 2. Buscar y reparar bookings sin host report jobs
    -- =====================================================
    FOR booking_record IN
      SELECT b.id, b.reservation_number
      FROM bookings b
      WHERE b.status != 'cancelled'
        AND b.lifecycle_status IN ('pre_event_ready', 'in_progress')
        AND b.event_date >= CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM booking_host_reports WHERE booking_id = b.id)
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_jobs sj 
          WHERE sj.booking_id = b.id 
          AND sj.job_type LIKE 'host_report%'
          AND sj.status = 'pending'
        )
    LOOP
      -- Llamar a schedule-host-report-reminders para reparar
      SELECT net.http_post(
        url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/schedule-host-report-reminders',
        headers := '{"Content-Type": "application/json"}'::jsonb,
        body := jsonb_build_object('booking_id', booking_record.id, 'force_reschedule', true)
      ) INTO request_id;
      
      host_fixed := host_fixed + 1;
      RAISE NOTICE '[AUTO-FIX] Repaired booking % (missing host report jobs, request_id: %)', 
        booking_record.reservation_number, request_id;
    END LOOP;
    
    -- =====================================================
    -- 3. Log summary
    -- =====================================================
    fixed_count := balance_fixed + host_fixed;
    
    IF fixed_count > 0 THEN
      RAISE NOTICE '[AUTO-FIX] Completed: % bookings repaired (% balance, % host report)', 
        fixed_count, balance_fixed, host_fixed;
    ELSE
      RAISE NOTICE '[AUTO-FIX] Completed: No bookings needed repair';
    END IF;
    
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING '[AUTO-FIX] Error occurred: %', SQLERRM;
  END $$;
  $$
);

-- Add comment for documentation
COMMENT ON EXTENSION pg_cron IS 'pg_cron extension for scheduling periodic jobs';

-- Log the cron job creation
DO $$
BEGIN
  RAISE NOTICE '[AUTO-FIX] Cron job "auto-fix-missing-jobs-hourly" scheduled successfully';
  RAISE NOTICE '[AUTO-FIX] Schedule: Every hour at :15 minutes';
  RAISE NOTICE '[AUTO-FIX] Purpose: Automatically repair bookings missing balance or host report jobs';
END $$;
