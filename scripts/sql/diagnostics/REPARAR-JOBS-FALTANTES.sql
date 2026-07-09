-- =====================================================
-- SCRIPT DE REPARACIÓN DE JOBS FALTANTES
-- =====================================================
-- Este script crea los jobs que faltan para bookings
-- que deberían tenerlos pero por alguna razón no los tienen
-- =====================================================

-- ⚠️ IMPORTANTE: Este script NO ejecuta las funciones directamente
-- ya que SQL no puede hacer llamadas HTTP a Edge Functions.
-- En su lugar, te muestra QUÉ bookings necesitan reparación
-- y te da los comandos exactos para ejecutar.

-- =====================================================
-- 1. IDENTIFICAR BOOKINGS QUE NECESITAN REPARACIÓN
-- =====================================================

-- Bookings sin balance payment jobs (cuando deberían tenerlos)
SELECT 
  b.id as booking_id,
  b.reservation_number,
  b.event_date,
  b.payment_status,
  b.lifecycle_status,
  'FALTA: balance payment jobs' as problema,
  'trigger-booking-automation' as funcion_a_llamar,
  -- Comando para ejecutar desde Supabase Functions o Postman
  format(
    'curl -X POST %s/functions/v1/trigger-booking-automation -H "Authorization: Bearer %s" -H "Content-Type: application/json" -d ''{"booking_id": "%s"}''',
    current_setting('app.settings.supabase_url', true),
    'YOUR_SERVICE_ROLE_KEY',
    b.id
  ) as comando_curl
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
-- 2. BOOKINGS SIN HOST REPORT JOBS
-- =====================================================

SELECT 
  b.id as booking_id,
  b.reservation_number,
  b.event_date,
  b.lifecycle_status,
  'FALTA: host report jobs' as problema,
  'trigger-booking-automation' as funcion_a_llamar,
  format(
    'curl -X POST %s/functions/v1/trigger-booking-automation -H "Authorization: Bearer %s" -H "Content-Type: application/json" -d ''{"booking_id": "%s"}''',
    current_setting('app.settings.supabase_url', true),
    'YOUR_SERVICE_ROLE_KEY',
    b.id
  ) as comando_curl
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
-- 3. GENERAR SCRIPT PARA REPARACIÓN MASIVA VIA pg_net
-- =====================================================
-- Este query genera los comandos SQL que puedes ejecutar
-- para reparar TODOS los bookings de una vez usando pg_net

SELECT format(
  'SELECT net.http_post(
    url := ''%s/functions/v1/trigger-booking-automation'',
    headers := jsonb_build_object(
      ''Content-Type'', ''application/json'',
      ''Authorization'', ''Bearer YOUR_SERVICE_ROLE_KEY''
    ),
    body := jsonb_build_object(''booking_id'', ''%s''::text)
  );',
  current_setting('app.settings.supabase_url', true),
  b.id
) as comando_sql_pg_net
FROM bookings b
WHERE b.status != 'cancelled'
  AND b.lifecycle_status = 'pre_event_ready'
  AND (
    -- Sin balance jobs cuando debería tenerlos
    (b.payment_status = 'deposit_paid' AND NOT EXISTS (
      SELECT 1 FROM scheduled_jobs sj 
      WHERE sj.booking_id = b.id 
      AND sj.job_type LIKE 'balance%'
    ))
    OR
    -- Sin host report jobs cuando debería tenerlos
    (b.event_date >= CURRENT_DATE AND NOT EXISTS (
      SELECT 1 FROM booking_host_reports WHERE booking_id = b.id
    ) AND NOT EXISTS (
      SELECT 1 FROM scheduled_jobs sj 
      WHERE sj.booking_id = b.id 
      AND sj.job_type LIKE 'host_report%'
      AND sj.status = 'pending'
    ))
  )
ORDER BY b.event_date;

-- =====================================================
-- 4. RESETEAR JOBS FALLIDOS (con precaución)
-- =====================================================
-- Solo ejecutar esto si estás SEGURO de que quieres reintentar

-- Ver detalles de jobs fallidos primero
SELECT 
  sj.id,
  b.reservation_number,
  sj.job_type,
  sj.last_error,
  sj.attempts,
  b.payment_status,
  b.lifecycle_status,
  b.status,
  -- Comando para resetear (ejecutar manualmente después de revisar)
  format(
    'UPDATE scheduled_jobs SET status = ''pending'', attempts = 0, last_error = NULL WHERE id = ''%s'';',
    sj.id
  ) as comando_reset
FROM scheduled_jobs sj
JOIN bookings b ON sj.booking_id = b.id
WHERE sj.status = 'failed'
  AND sj.attempts >= 3
  AND b.status != 'cancelled'
ORDER BY sj.updated_at DESC;

-- =====================================================
-- 5. VERIFICAR CONFIGURACIÓN DE CRON JOB
-- =====================================================
-- El procesador de jobs debe ejecutarse cada 5 minutos

SELECT 
  jobname,
  schedule,
  command,
  active,
  jobid
FROM cron.job
WHERE jobname LIKE '%process%scheduled%'
ORDER BY jobid DESC;

-- Si NO existe, crear el cron job:
-- (Reemplaza TU_PROJECT_URL y configuración según tu proyecto)

/*
SELECT cron.schedule(
  'process-scheduled-jobs-every-5-min',
  '*/5 * * * *', -- Cada 5 minutos
  $$
  SELECT net.http_post(
    url := 'https://TU_PROJECT.supabase.co/functions/v1/process-scheduled-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    ),
    body := '{}'::jsonb
  );
  $$
);
*/

-- =====================================================
-- 6. MONITOREO: ÚLTIMAS EJECUCIONES DEL PROCESADOR
-- =====================================================
-- Verificar que process-scheduled-jobs se está ejecutando

SELECT 
  id,
  created_at,
  status,
  request->'url' as url,
  response->>'status' as response_status,
  response->>'body' as response_body
FROM net._http_response
WHERE request->>'url' LIKE '%process-scheduled-jobs%'
ORDER BY created_at DESC
LIMIT 10;

-- =====================================================
-- INSTRUCCIONES DE USO
-- =====================================================

/*
PASO 1: Ejecutar queries 1 y 2 para ver qué bookings necesitan reparación

PASO 2: Si son pocos bookings (< 10):
  - Copiar los comandos curl del resultado
  - Ejecutarlos desde terminal o Postman
  - Verificar que se crearon los jobs

PASO 3: Si son muchos bookings (> 10):
  - Ejecutar query 3 para generar comandos SQL
  - Copiar los resultados
  - Reemplazar 'YOUR_SERVICE_ROLE_KEY' con tu clave real
  - Ejecutar todos los comandos en Supabase SQL Editor
  - NOTA: pg_net ejecutará las llamadas de forma asíncrona

PASO 4: Verificar configuración de cron job (query 5)
  - Si no existe, crear el cron job siguiendo el ejemplo
  - Si existe pero active = false, activarlo:
    SELECT cron.alter_job(JOB_ID, is_active := true);

PASO 5: Verificar que el procesador se está ejecutando (query 6)
  - Debe haber registros recientes (últimos 5-10 minutos)
  - response_status debe ser '200'
  - response_body debe mostrar jobs procesados

PASO 6: Esperar 10 minutos y ejecutar VERIFICACION-JOBS.sql query #10
  - Verificar que "Bookings sin jobs..." = 0
  - Si siguen habiendo problemas, revisar logs de las Edge Functions
*/
