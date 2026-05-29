-- =====================================================
-- SCRIPT DE VERIFICACIÓN COMPLETA DE JOBS
-- =====================================================
-- Este script verifica que todos los jobs se estén creando
-- y ejecutando correctamente para cada booking
-- =====================================================

-- =====================================================
-- 1. RESUMEN GENERAL DE BOOKINGS Y SUS JOBS
-- =====================================================
SELECT 
  b.reservation_number,
  b.id as booking_id,
  b.event_date,
  b.lifecycle_status,
  b.payment_status,
  b.status,
  b.host_report_step,
  COUNT(sj.id) as total_jobs,
  COUNT(CASE WHEN sj.status = 'pending' THEN 1 END) as pending_jobs,
  COUNT(CASE WHEN sj.status = 'completed' THEN 1 END) as completed_jobs,
  COUNT(CASE WHEN sj.status = 'failed' THEN 1 END) as failed_jobs,
  COUNT(CASE WHEN sj.status = 'cancelled' THEN 1 END) as cancelled_jobs
FROM bookings b
LEFT JOIN scheduled_jobs sj ON b.id = sj.booking_id
WHERE b.status != 'cancelled' 
  AND b.lifecycle_status IN ('pre_event_ready', 'in_progress', 'post_event')
GROUP BY b.id, b.reservation_number, b.event_date, b.lifecycle_status, b.payment_status, b.status, b.host_report_step
ORDER BY b.event_date ASC;

-- =====================================================
-- 2. VERIFICACIÓN DE BALANCE PAYMENT JOBS
-- =====================================================
-- Bookings que deberían tener jobs de balance payment
-- pero no los tienen
SELECT 
  b.reservation_number,
  b.id as booking_id,
  b.event_date,
  b.payment_status,
  b.lifecycle_status,
  b.balance_payment_url,
  '❌ SIN JOBS DE BALANCE' as problema,
  CASE 
    WHEN (CURRENT_DATE - b.event_date::date) <= 15 THEN 'Short notice - debería tener link inmediato'
    ELSE 'Long notice - debería tener 3 retries programados'
  END as esperado
FROM bookings b
WHERE b.payment_status = 'deposit_paid'
  AND b.status != 'cancelled'
  AND b.lifecycle_status = 'pre_event_ready'
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_jobs sj 
    WHERE sj.booking_id = b.id 
    AND sj.job_type IN ('balance_retry_1', 'balance_retry_2', 'balance_retry_3', 'create_balance_payment_link')
  )
ORDER BY b.event_date;

-- =====================================================
-- 3. DETALLE DE BALANCE PAYMENT JOBS EXISTENTES
-- =====================================================
SELECT 
  b.reservation_number,
  b.event_date,
  b.payment_status,
  sj.job_type,
  sj.status,
  sj.run_at,
  sj.attempts,
  sj.last_error,
  sj.completed_at,
  sj.created_at,
  CASE 
    WHEN sj.status = 'pending' AND sj.run_at < NOW() THEN '⚠️ ATRASADO - debería haberse ejecutado'
    WHEN sj.status = 'failed' AND sj.attempts >= 3 THEN '❌ FALLIDO - máximo de intentos alcanzado'
    WHEN sj.status = 'failed' THEN '⚠️ FALLIDO - se reintentará'
    WHEN sj.status = 'completed' THEN '✅ COMPLETADO'
    WHEN sj.status = 'pending' THEN '⏳ PENDIENTE'
    ELSE sj.status
  END as estado_detallado
FROM bookings b
JOIN scheduled_jobs sj ON b.id = sj.booking_id
WHERE sj.job_type IN ('balance_retry_1', 'balance_retry_2', 'balance_retry_3', 'create_balance_payment_link')
ORDER BY b.event_date, sj.run_at;

-- =====================================================
-- 4. VERIFICACIÓN DE HOST REPORT JOBS
-- =====================================================
-- Bookings que deberían tener jobs de host report
-- pero no los tienen
SELECT 
  b.reservation_number,
  b.id as booking_id,
  b.event_date,
  b.lifecycle_status,
  b.host_report_step,
  '❌ SIN JOBS DE HOST REPORT' as problema,
  'Debería tener jobs programados: pre_start, during, post' as esperado
FROM bookings b
WHERE b.status != 'cancelled'
  AND b.lifecycle_status IN ('pre_event_ready', 'in_progress')
  AND b.event_date >= CURRENT_DATE
  AND NOT EXISTS (
    SELECT 1 FROM booking_host_reports bhr 
    WHERE bhr.booking_id = b.id
  )
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_jobs sj 
    WHERE sj.booking_id = b.id 
    AND sj.job_type IN ('host_report_pre_start', 'host_report_during', 'host_report_post')
    AND sj.status = 'pending'
  )
ORDER BY b.event_date;

-- =====================================================
-- 5. DETALLE DE HOST REPORT JOBS EXISTENTES
-- =====================================================
SELECT 
  b.reservation_number,
  b.event_date,
  b.start_time,
  b.lifecycle_status,
  b.host_report_step,
  sj.job_type,
  sj.status,
  sj.run_at,
  sj.attempts,
  sj.last_error,
  sj.completed_at,
  CASE 
    WHEN sj.status = 'pending' AND sj.run_at < NOW() THEN '⚠️ ATRASADO - debería haberse ejecutado'
    WHEN sj.status = 'failed' AND sj.attempts >= 3 THEN '❌ FALLIDO - máximo de intentos alcanzado'
    WHEN sj.status = 'completed' THEN '✅ COMPLETADO'
    WHEN sj.status = 'cancelled' THEN '🚫 CANCELADO - ' || COALESCE(sj.last_error, 'sin razón')
    WHEN sj.status = 'pending' THEN '⏳ PENDIENTE'
    ELSE sj.status
  END as estado_detallado
FROM bookings b
JOIN scheduled_jobs sj ON b.id = sj.booking_id
WHERE sj.job_type IN ('host_report_pre_start', 'host_report_during', 'host_report_post')
ORDER BY b.event_date, sj.run_at;

-- =====================================================
-- 6. VERIFICACIÓN DE EVENTOS DE SINCRONIZACIÓN GHL
-- =====================================================
-- Últimas sincronizaciones GHL por booking
SELECT 
  b.reservation_number,
  b.event_date,
  b.lifecycle_status,
  b.payment_status,
  be.event_type,
  be.created_at,
  be.metadata->>'error' as error_detalle,
  CASE 
    WHEN be.event_type = 'sync_to_ghl_failed' THEN '❌ SINCRONIZACIÓN FALLIDA'
    WHEN be.event_type = 'sync_to_ghl_success' THEN '✅ SINCRONIZACIÓN EXITOSA'
    ELSE be.event_type
  END as estado_sync
FROM bookings b
JOIN booking_events be ON b.id = be.booking_id
WHERE be.event_type IN ('sync_to_ghl_success', 'sync_to_ghl_failed')
  AND be.created_at > NOW() - INTERVAL '7 days'
ORDER BY be.created_at DESC
LIMIT 50;

-- =====================================================
-- 7. BOOKINGS CON PROBLEMAS DETECTADOS
-- =====================================================
-- Combina todos los problemas posibles en un solo reporte
WITH booking_issues AS (
  SELECT 
    b.reservation_number,
    b.id as booking_id,
    b.event_date,
    b.lifecycle_status,
    b.payment_status,
    CASE 
      -- Issue 1: Sin jobs de balance cuando debería tenerlos
      WHEN b.payment_status = 'deposit_paid' 
        AND b.lifecycle_status = 'pre_event_ready'
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_jobs sj 
          WHERE sj.booking_id = b.id 
          AND sj.job_type LIKE 'balance%'
        ) THEN '❌ SIN BALANCE JOBS'
      
      -- Issue 2: Jobs de balance fallidos
      WHEN EXISTS (
        SELECT 1 FROM scheduled_jobs sj 
        WHERE sj.booking_id = b.id 
        AND sj.job_type LIKE 'balance%'
        AND sj.status = 'failed'
        AND sj.attempts >= 3
      ) THEN '❌ BALANCE JOBS FALLIDOS'
      
      -- Issue 3: Sin jobs de host report cuando debería tenerlos
      WHEN b.lifecycle_status IN ('pre_event_ready', 'in_progress')
        AND b.event_date >= CURRENT_DATE
        AND NOT EXISTS (SELECT 1 FROM booking_host_reports WHERE booking_id = b.id)
        AND NOT EXISTS (
          SELECT 1 FROM scheduled_jobs sj 
          WHERE sj.booking_id = b.id 
          AND sj.job_type LIKE 'host_report%'
          AND sj.status = 'pending'
        ) THEN '❌ SIN HOST REPORT JOBS'
      
      -- Issue 4: Host report step no actualizado
      WHEN b.host_report_step IS NULL 
        AND b.lifecycle_status IN ('pre_event_ready', 'in_progress')
        AND b.event_date >= CURRENT_DATE THEN '⚠️ HOST_REPORT_STEP NULO'
      
      -- Issue 5: Jobs atrasados
      WHEN EXISTS (
        SELECT 1 FROM scheduled_jobs sj 
        WHERE sj.booking_id = b.id 
        AND sj.status = 'pending'
        AND sj.run_at < NOW() - INTERVAL '1 hour'
      ) THEN '⚠️ JOBS ATRASADOS'
      
      -- Issue 6: Fallos recientes en sync GHL
      WHEN EXISTS (
        SELECT 1 FROM booking_events be 
        WHERE be.booking_id = b.id 
        AND be.event_type = 'sync_to_ghl_failed'
        AND be.created_at > NOW() - INTERVAL '24 hours'
      ) THEN '⚠️ SYNC GHL FALLIDO RECIENTE'
      
      ELSE NULL
    END as issue_type,
    
    -- Detalles adicionales
    (SELECT COUNT(*) FROM scheduled_jobs WHERE booking_id = b.id AND status = 'pending') as pending_jobs,
    (SELECT COUNT(*) FROM scheduled_jobs WHERE booking_id = b.id AND status = 'failed') as failed_jobs,
    (SELECT MAX(created_at) FROM booking_events WHERE booking_id = b.id AND event_type LIKE '%sync%') as last_sync
  FROM bookings b
  WHERE b.status != 'cancelled'
)
SELECT * 
FROM booking_issues
WHERE issue_type IS NOT NULL
ORDER BY event_date ASC;

-- =====================================================
-- 8. VERIFICACIÓN DE LIFECYCLE TRANSITION JOBS
-- =====================================================
-- Jobs de transición de lifecycle (pre_event_ready -> in_progress -> post_event)
SELECT 
  b.reservation_number,
  b.event_date,
  b.start_time,
  b.lifecycle_status,
  b.payment_status,
  sj.job_type,
  sj.status,
  sj.run_at,
  sj.attempts,
  sj.last_error,
  CASE 
    WHEN sj.status = 'pending' AND sj.run_at < NOW() THEN '⚠️ DEBERÍA HABERSE EJECUTADO'
    WHEN sj.status = 'completed' THEN '✅ COMPLETADO'
    WHEN sj.status = 'cancelled' THEN '🚫 CANCELADO: ' || COALESCE(sj.last_error, '')
    WHEN sj.status = 'pending' THEN '⏳ PENDIENTE'
    ELSE sj.status
  END as estado
FROM bookings b
JOIN scheduled_jobs sj ON b.id = sj.booking_id
WHERE sj.job_type IN ('set_lifecycle_in_progress', 'set_lifecycle_post_event')
ORDER BY b.event_date, sj.run_at;

-- =====================================================
-- 9. EVENTOS DE AUTOMATIZACIÓN
-- =====================================================
-- Verifica si se llamó a trigger-booking-automation
SELECT 
  b.reservation_number,
  b.event_date,
  b.lifecycle_status,
  be.event_type,
  be.created_at,
  be.metadata->>'host_report_result' as host_report_result,
  be.metadata->>'balance_payment_result' as balance_payment_result
FROM bookings b
LEFT JOIN booking_events be ON b.id = be.booking_id
WHERE be.event_type = 'booking_automation_triggered'
  AND b.status != 'cancelled'
ORDER BY be.created_at DESC
LIMIT 20;

-- =====================================================
-- 10. RESUMEN EJECUTIVO
-- =====================================================
SELECT 
  'Total bookings activos' as metrica,
  COUNT(*) as valor
FROM bookings 
WHERE status != 'cancelled'
  AND lifecycle_status IN ('pre_event_ready', 'in_progress')

UNION ALL

SELECT 
  'Bookings sin jobs de balance (deposit_paid)',
  COUNT(*)
FROM bookings b
WHERE payment_status = 'deposit_paid'
  AND status != 'cancelled'
  AND lifecycle_status = 'pre_event_ready'
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_jobs sj 
    WHERE sj.booking_id = b.id 
    AND sj.job_type LIKE 'balance%'
  )

UNION ALL

SELECT 
  'Bookings sin jobs de host report',
  COUNT(*)
FROM bookings b
WHERE status != 'cancelled'
  AND lifecycle_status IN ('pre_event_ready', 'in_progress')
  AND event_date >= CURRENT_DATE
  AND NOT EXISTS (SELECT 1 FROM booking_host_reports WHERE booking_id = b.id)
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_jobs sj 
    WHERE sj.booking_id = b.id 
    AND sj.job_type LIKE 'host_report%'
    AND sj.status = 'pending'
  )

UNION ALL

SELECT 
  'Jobs fallidos (todos los tipos)',
  COUNT(*)
FROM scheduled_jobs
WHERE status = 'failed'
  AND attempts >= 3

UNION ALL

SELECT 
  'Jobs atrasados (>1 hora)',
  COUNT(*)
FROM scheduled_jobs
WHERE status = 'pending'
  AND run_at < NOW() - INTERVAL '1 hour'

UNION ALL

SELECT 
  'Fallos sync GHL (últimas 24h)',
  COUNT(*)
FROM booking_events
WHERE event_type = 'sync_to_ghl_failed'
  AND created_at > NOW() - INTERVAL '24 hours';
