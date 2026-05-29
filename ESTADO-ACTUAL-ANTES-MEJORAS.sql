-- =====================================================
-- ESTADO ACTUAL DEL SISTEMA (ANTES DE MEJORAS)
-- =====================================================
-- Ejecuta este SQL AHORA para guardar el estado actual
-- Luego, después de implementar, compara con el nuevo estado
-- =====================================================

-- =====================================================
-- SNAPSHOT ACTUAL DEL SISTEMA
-- =====================================================

SELECT 
  '===== ESTADO ACTUAL DEL SISTEMA =====' as titulo,
  NOW() as fecha_snapshot;

-- =====================================================
-- 1. Triggers actuales en tabla bookings
-- =====================================================
SELECT 
  'TRIGGERS ACTUALES' as seccion;

SELECT 
  tgname as trigger_name,
  CASE tgenabled
    WHEN 'O' THEN '✅ Activo'
    WHEN 'D' THEN '❌ Desactivado'
  END as estado,
  obj_description(oid) as descripcion
FROM pg_trigger
WHERE tgrelid = 'public.bookings'::regclass
ORDER BY tgname;

-- =====================================================
-- 2. Cron jobs actuales
-- =====================================================
SELECT 
  'CRON JOBS ACTUALES' as seccion;

SELECT 
  jobname,
  schedule,
  CASE WHEN active THEN '✅ Activo' ELSE '❌ Inactivo' END as estado,
  jobid
FROM cron.job
ORDER BY jobname;

-- =====================================================
-- 3. Edge Functions desplegadas
-- =====================================================
-- NOTA: Esto no se puede verificar con SQL
-- Ve a: Supabase Dashboard → Edge Functions
-- Anota cuántas funciones tienes actualmente

-- =====================================================
-- 4. Estado actual de bookings y jobs
-- =====================================================
SELECT 
  'ESTADO BOOKINGS Y JOBS' as seccion;

SELECT 
  COUNT(*) as total_bookings_activos,
  COUNT(CASE WHEN lifecycle_status = 'pre_event_ready' THEN 1 END) as en_pre_event_ready,
  COUNT(CASE WHEN lifecycle_status = 'in_progress' THEN 1 END) as en_in_progress,
  COUNT(CASE WHEN payment_status = 'deposit_paid' THEN 1 END) as con_deposit_paid,
  COUNT(CASE WHEN payment_status = 'fully_paid' THEN 1 END) as fully_paid
FROM bookings
WHERE status != 'cancelled'
  AND lifecycle_status IN ('pre_event_ready', 'in_progress');

SELECT 
  COUNT(*) as total_jobs_programados,
  COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending,
  COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
  COUNT(CASE WHEN job_type LIKE 'balance%' THEN 1 END) as balance_jobs,
  COUNT(CASE WHEN job_type LIKE 'host_report%' THEN 1 END) as host_report_jobs
FROM scheduled_jobs;

-- =====================================================
-- 5. Problemas actuales (antes de mejoras)
-- =====================================================
SELECT 
  'PROBLEMAS DETECTADOS AHORA' as seccion;

SELECT 
  'Jobs atrasados (>1h)' as problema,
  COUNT(*) as cantidad,
  CASE WHEN COUNT(*) = 0 THEN '✅ OK' ELSE '⚠️ Problema' END as estado
FROM scheduled_jobs
WHERE status = 'pending'
  AND run_at < NOW() - INTERVAL '1 hour'

UNION ALL

SELECT 
  'Jobs fallidos (3+ intentos)',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN '✅ OK' ELSE '⚠️ Problema' END
FROM scheduled_jobs
WHERE status = 'failed'
  AND attempts >= 3

UNION ALL

SELECT 
  'Bookings sin balance jobs',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN '✅ OK' ELSE '⚠️ Problema' END
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
  'Bookings sin host report jobs',
  COUNT(*),
  CASE WHEN COUNT(*) = 0 THEN '✅ OK' ELSE '⚠️ Problema' END
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
  );

-- =====================================================
-- 6. Guardar este snapshot
-- =====================================================
-- Guarda los resultados de este script
-- Después de implementar las mejoras, vuelve a ejecutar
-- y compara los resultados

-- =====================================================
-- INSTRUCCIONES
-- =====================================================

/*
📸 SNAPSHOT DEL SISTEMA

Este script te muestra el estado ACTUAL de tu sistema ANTES de implementar las mejoras.

ÚSALO ASÍ:

1. AHORA: Ejecuta este script completo y GUARDA los resultados
   - Anota cuántos triggers tienes
   - Anota cuántos cron jobs tienes
   - Anota cuántos problemas tienes ahora

2. IMPLEMENTA: Sigue EMPIEZA-AQUI.md o INSTRUCCIONES-IMPLEMENTACION-MEJORAS.md

3. DESPUÉS: Ejecuta TEST-RAPIDO-POST-IMPLEMENTACION.sql

4. COMPARA:
   ANTES: X triggers, Y cron jobs, Z problemas
   DESPUÉS: X+1 triggers, Y+2 cron jobs, Z problemas (mismos o menos)

Si DESPUÉS tienes MÁS componentes y MENOS problemas, ¡la implementación fue exitosa! ✅
*/
