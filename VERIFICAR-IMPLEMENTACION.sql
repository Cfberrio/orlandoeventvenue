-- =====================================================
-- SCRIPT DE VERIFICACIÓN POST-IMPLEMENTACIÓN
-- =====================================================
-- Ejecuta estos queries después de implementar las mejoras
-- para verificar que todo está funcionando correctamente
-- =====================================================

-- =====================================================
-- 1. VERIFICAR QUE EL TRIGGER EXISTE
-- =====================================================
SELECT 
  tgname as trigger_name,
  tgenabled as enabled,
  'bookings' as table_name,
  CASE tgenabled
    WHEN 'O' THEN '✅ ACTIVO'
    WHEN 'D' THEN '❌ DESACTIVADO'
    ELSE 'DESCONOCIDO'
  END as estado
FROM pg_trigger
WHERE tgname = 'bookings_auto_trigger_automation';

-- Si no aparece ninguna fila, el trigger NO se creó correctamente

-- =====================================================
-- 2. VERIFICAR QUE LA FUNCIÓN DEL TRIGGER EXISTE
-- =====================================================
SELECT 
  proname as function_name,
  'public' as schema,
  CASE prokind
    WHEN 'f' THEN '✅ Function'
    WHEN 't' THEN 'Trigger'
    ELSE 'Other'
  END as type
FROM pg_proc
WHERE proname = 'auto_trigger_booking_automation';

-- =====================================================
-- 3. VERIFICAR FUNCIONES DE HEALTH CHECK
-- =====================================================
SELECT 
  proname as function_name,
  'public' as schema,
  pg_get_function_result(oid) as returns,
  '✅ Existe' as estado
FROM pg_proc
WHERE proname IN ('count_bookings_without_balance_jobs', 'count_bookings_without_host_jobs');

-- Debería mostrar 2 funciones

-- =====================================================
-- 4. VERIFICAR CRON JOBS
-- =====================================================
SELECT 
  jobid,
  jobname,
  schedule,
  active,
  CASE 
    WHEN active = true THEN '✅ ACTIVO'
    ELSE '❌ INACTIVO'
  END as estado,
  CASE jobname
    WHEN 'auto-fix-missing-jobs-hourly' THEN 'Repara bookings sin jobs cada hora'
    WHEN 'daily-health-check-8am-est' THEN 'Envía email si hay problemas (8 AM diario)'
    WHEN 'process-scheduled-jobs-5min' THEN 'Procesa jobs pendientes (cada 5 min)'
    ELSE 'Otro'
  END as descripcion
FROM cron.job
WHERE jobname IN (
  'auto-fix-missing-jobs-hourly',
  'daily-health-check-8am-est',
  'process-scheduled-jobs-5min'
)
ORDER BY jobname;

-- Debería mostrar 3 cron jobs activos

-- =====================================================
-- 5. VERIFICAR EDGE FUNCTION daily-health-check
-- =====================================================
-- Nota: Esto no se puede verificar con SQL
-- Debes ir a Supabase Dashboard → Edge Functions
-- y verificar que "daily-health-check" aparece en la lista

-- =====================================================
-- 6. PROBAR LAS FUNCIONES DE HEALTH CHECK
-- =====================================================
-- Ejecutar las funciones para ver si funcionan
SELECT 
  'Bookings sin balance jobs' as metrica,
  count_bookings_without_balance_jobs() as valor;

SELECT 
  'Bookings sin host report jobs' as metrica,
  count_bookings_without_host_jobs() as valor;

-- =====================================================
-- 7. VERIFICAR ÚLTIMA EJECUCIÓN DE CRON JOBS
-- =====================================================
-- Ver cuándo se ejecutó cada cron por última vez
SELECT 
  j.jobname,
  j.schedule,
  j.active,
  d.status,
  d.run_start as last_run,
  d.run_end,
  EXTRACT(EPOCH FROM (NOW() - d.run_start)) / 60 as minutos_desde_ultima_ejecucion
FROM cron.job j
LEFT JOIN LATERAL (
  SELECT * FROM cron.job_run_details 
  WHERE jobid = j.jobid 
  ORDER BY run_start DESC 
  LIMIT 1
) d ON true
WHERE j.jobname IN (
  'auto-fix-missing-jobs-hourly',
  'daily-health-check-8am-est',
  'process-scheduled-jobs-5min'
)
ORDER BY j.jobname;

-- =====================================================
-- 8. VERIFICAR LOGS DEL TRIGGER (últimas ejecuciones)
-- =====================================================
-- Ver si el trigger ha ejecutado llamadas
SELECT 
  created_at,
  request->>'url' as url,
  response->>'status' as http_status,
  response->>'body' as response_body
FROM net._http_response
WHERE request->>'url' LIKE '%trigger-booking-automation%'
ORDER BY created_at DESC
LIMIT 5;

-- =====================================================
-- 9. RESUMEN FINAL DE VERIFICACIÓN
-- =====================================================
WITH verification AS (
  SELECT 
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_auto_trigger_automation') as trigger_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_trigger_booking_automation') as trigger_function_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'count_bookings_without_balance_jobs') as health_function_1_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'count_bookings_without_host_jobs') as health_function_2_exists,
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-fix-missing-jobs-hourly' AND active = true) as autofix_cron_active,
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-health-check-8am-est' AND active = true) as healthcheck_cron_active,
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-scheduled-jobs-5min' AND active = true) as processor_cron_active
)
SELECT 
  CASE 
    WHEN trigger_exists AND trigger_function_exists AND 
         health_function_1_exists AND health_function_2_exists AND
         autofix_cron_active AND healthcheck_cron_active AND processor_cron_active
    THEN '✅ TODO VERIFICADO CORRECTAMENTE'
    ELSE '❌ FALTAN COMPONENTES - Ver detalles abajo'
  END as estado_general,
  CASE WHEN trigger_exists THEN '✅' ELSE '❌' END as trigger,
  CASE WHEN trigger_function_exists THEN '✅' ELSE '❌' END as trigger_function,
  CASE WHEN health_function_1_exists THEN '✅' ELSE '❌' END as health_func_balance,
  CASE WHEN health_function_2_exists THEN '✅' ELSE '❌' END as health_func_host,
  CASE WHEN autofix_cron_active THEN '✅' ELSE '❌' END as autofix_cron,
  CASE WHEN healthcheck_cron_active THEN '✅' ELSE '❌' END as healthcheck_cron,
  CASE WHEN processor_cron_active THEN '✅' ELSE '❌' END as processor_cron
FROM verification;

-- =====================================================
-- INSTRUCCIONES DE USO
-- =====================================================

/*
📋 CÓMO USAR ESTE SCRIPT:

1. Después de implementar todas las mejoras, ejecuta este script COMPLETO
2. Revisa el query #9 (Resumen Final) primero
3. Si todo muestra ✅, la implementación fue exitosa
4. Si algo muestra ❌, revisa los queries anteriores para ver qué falta
5. Usa los logs (query #7 y #8) para debugging

TIEMPO DE VERIFICACIÓN:
- Inmediatamente después de implementar: Ejecutar queries 1-6
- Después de 1 hora: Ejecutar query 7 para ver si auto-fix corrió
- Al día siguiente (después de las 8 AM): Verificar si llegó email (solo si había problemas)

FRECUENCIA RECOMENDADA:
- Primera semana: Ejecutar daily (queries 7-9)
- Después: Solo cuando recibas un email de alerta
*/
