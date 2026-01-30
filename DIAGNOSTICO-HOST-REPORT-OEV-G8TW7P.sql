-- =====================================================
-- DIAGNÓSTICO: Por qué OEV-G8TW7P no recibió host report reminders
-- Comparación con OEV-76FQL3 que SÍ funcionó correctamente
-- =====================================================

-- =====================================================
-- QUERY 1: COMPARAR DATOS BÁSICOS DE AMBOS BOOKINGS
-- =====================================================
-- Esto muestra las diferencias clave entre los dos bookings

SELECT 
  reservation_number,
  event_date,
  created_at,
  lifecycle_status,
  host_report_step,
  payment_status,
  booking_origin,
  policy_id,
  status,
  EXTRACT(DAY FROM (event_date - created_at::date)) as dias_entre_creacion_y_evento,
  CASE 
    WHEN lifecycle_status = 'pre_event_ready' THEN '✓ OK - Debe tener jobs'
    WHEN lifecycle_status = 'in_progress' THEN '✓ OK - Evento en progreso'
    WHEN lifecycle_status = 'post_event' THEN '✓ OK - Evento terminado'
    ELSE '⚠ PROBLEMA - No llegó a pre_event_ready'
  END as estado_lifecycle
FROM bookings
WHERE reservation_number IN ('OEV-G8TW7P', 'OEV-76FQL3')
ORDER BY created_at;

-- Interpretación:
-- - dias_entre_creacion_y_evento: Si es < 30, el reminder de 30d no aplica
-- - lifecycle_status: DEBE ser 'pre_event_ready' para que se creen jobs
-- - host_report_step: Debe cambiar de 'not_started' a 'pre_event_sent', 'during_sent', 'post_sent'
-- - policy_id: Debe ser el mismo para ambos (WEBSITE_FULL_FLOW)


-- =====================================================
-- QUERY 2: VERIFICAR SCHEDULED JOBS CREADOS
-- =====================================================
-- Esto muestra SI se crearon los jobs de host report

SELECT 
  b.reservation_number,
  sj.job_type,
  sj.run_at,
  sj.status,
  sj.attempts,
  sj.last_error,
  sj.created_at,
  EXTRACT(DAY FROM (b.event_date - sj.run_at::date)) as dias_antes_del_evento,
  CASE 
    WHEN sj.status = 'completed' THEN '✓ Ejecutado correctamente'
    WHEN sj.status = 'pending' THEN '⏳ Pendiente de ejecutar'
    WHEN sj.status = 'failed' THEN '❌ Falló - Ver last_error'
    ELSE sj.status
  END as estado_job
FROM scheduled_jobs sj
JOIN bookings b ON b.id = sj.booking_id
WHERE b.reservation_number IN ('OEV-G8TW7P', 'OEV-76FQL3')
  AND sj.job_type LIKE '%host%'
ORDER BY b.reservation_number, sj.run_at;

-- Interpretación:
-- Si NO hay rows para OEV-G8TW7P: Los jobs nunca se crearon (CAUSA 3)
-- Si hay rows con status='failed': Los jobs se crearon pero fallaron (CAUSA 2)
-- Si hay rows con status='pending' y run_at ya pasó: Procesador no está corriendo (PROBLEMA CRÍTICO)


-- =====================================================
-- QUERY 3: VERIFICAR EVENTOS DE BOOKING
-- =====================================================
-- Esto muestra el historial de eventos relacionados con host report y GHL

SELECT 
  b.reservation_number,
  be.event_type,
  be.channel,
  be.metadata::text,
  be.created_at,
  CASE 
    WHEN be.event_type LIKE '%host%' THEN '📋 Host Report'
    WHEN be.event_type LIKE '%ghl%' THEN '🔄 GHL Sync'
    WHEN be.event_type = 'lifecycle_status_updated' THEN '🔄 Lifecycle Change'
    ELSE '📝 Otro'
  END as categoria_evento
FROM booking_events be
JOIN bookings b ON b.id = be.booking_id
WHERE b.reservation_number IN ('OEV-G8TW7P', 'OEV-76FQL3')
  AND (
    be.event_type LIKE '%host%' 
    OR be.event_type LIKE '%ghl%'
    OR be.event_type = 'lifecycle_status_updated'
  )
ORDER BY b.reservation_number, be.created_at;

-- Interpretación:
-- Si OEV-G8TW7P no tiene eventos 'host_report_*': Los reminders nunca se enviaron
-- Si tiene 'sync_to_ghl_failed': Problema con GHL (CAUSA 6)
-- Si OEV-76FQL3 tiene eventos pero G8TW7P no: Comparar qué diferencia hay


-- =====================================================
-- QUERY 4: VERIFICAR POLICY ASOCIADA
-- =====================================================
-- Esto verifica que ambos bookings tengan las configuraciones correctas

SELECT 
  b.reservation_number,
  bp.policy_name,
  bp.include_host_report,
  bp.send_pre_event_30d,
  bp.send_pre_event_7d,
  bp.send_pre_event_1d,
  bp.requires_staff_assignment,
  bp.send_balance_emails,
  CASE 
    WHEN bp.include_host_report = true AND 
         bp.send_pre_event_30d = true AND 
         bp.send_pre_event_7d = true AND 
         bp.send_pre_event_1d = true 
    THEN '✓ Policy correcta para host reports'
    ELSE '⚠ Policy NO configurada para host reports'
  END as estado_policy
FROM bookings b
JOIN booking_policies bp ON bp.id = b.policy_id
WHERE b.reservation_number IN ('OEV-G8TW7P', 'OEV-76FQL3');

-- Interpretación:
-- Si OEV-G8TW7P tiene policy diferente a OEV-76FQL3: CAUSA 5
-- Si include_host_report = false: No se crearán jobs de host report


-- =====================================================
-- QUERY 5: VERIFICAR TIMELINE COMPLETO DEL BOOKING
-- =====================================================
-- Esto muestra la línea de tiempo completa de OEV-G8TW7P

SELECT 
  b.reservation_number,
  'Booking creado' as evento,
  b.created_at as fecha,
  b.lifecycle_status as estado
FROM bookings b
WHERE b.reservation_number = 'OEV-G8TW7P'

UNION ALL

SELECT 
  b.reservation_number,
  'Deposit pagado' as evento,
  b.deposit_paid_at as fecha,
  b.payment_status as estado
FROM bookings b
WHERE b.reservation_number = 'OEV-G8TW7P' AND b.deposit_paid_at IS NOT NULL

UNION ALL

SELECT 
  b.reservation_number,
  'Balance pagado' as evento,
  b.balance_paid_at as fecha,
  b.payment_status as estado
FROM bookings b
WHERE b.reservation_number = 'OEV-G8TW7P' AND b.balance_paid_at IS NOT NULL

UNION ALL

SELECT 
  b.reservation_number,
  be.event_type as evento,
  be.created_at as fecha,
  NULL as estado
FROM booking_events be
JOIN bookings b ON b.id = be.booking_id
WHERE b.reservation_number = 'OEV-G8TW7P'

ORDER BY fecha;

-- Interpretación:
-- Este timeline muestra CUÁNDO pasó cada cosa
-- Buscar: ¿Cuándo cambió a 'pre_event_ready'?
-- ¿Cuántos días faltaban para el evento en ese momento?


-- =====================================================
-- QUERY 6: VERIFICAR TODOS LOS JOBS (NO SOLO HOST)
-- =====================================================
-- Ver TODOS los jobs del booking para entender el patrón completo

SELECT 
  b.reservation_number,
  sj.job_type,
  sj.run_at,
  sj.status,
  sj.attempts,
  sj.executed_at,
  sj.last_error,
  sj.created_at,
  CASE 
    WHEN sj.job_type LIKE '%balance%' THEN '💰 Balance Payment'
    WHEN sj.job_type LIKE '%host%' THEN '📋 Host Report'
    WHEN sj.job_type LIKE '%ghl%' THEN '🔄 GHL Automation'
    ELSE '❓ Otro'
  END as categoria
FROM scheduled_jobs sj
JOIN bookings b ON b.id = sj.booking_id
WHERE b.reservation_number = 'OEV-G8TW7P'
ORDER BY sj.created_at, sj.run_at;

-- Interpretación:
-- Si NO hay NINGÚN job: El booking nunca activó la automatización (PROBLEMA GRAVE)
-- Si hay jobs de balance pero no de host: La función schedule-host-report-reminders no se llamó
-- Si TODOS los jobs tienen status='failed': Problema con el procesador


-- =====================================================
-- QUERY 7: COMPARAR AMBOS BOOKINGS LADO A LADO
-- =====================================================
-- Vista comparativa directa

WITH booking_comparison AS (
  SELECT 
    b.reservation_number,
    b.event_date,
    b.created_at,
    b.lifecycle_status,
    b.host_report_step,
    b.payment_status,
    b.booking_origin,
    (SELECT COUNT(*) FROM scheduled_jobs WHERE booking_id = b.id AND job_type LIKE '%host%') as host_jobs_count,
    (SELECT COUNT(*) FROM scheduled_jobs WHERE booking_id = b.id AND job_type LIKE '%balance%') as balance_jobs_count,
    (SELECT COUNT(*) FROM booking_events WHERE booking_id = b.id AND event_type LIKE '%host%') as host_events_count,
    (SELECT COUNT(*) FROM booking_events WHERE booking_id = b.id AND event_type LIKE '%ghl%') as ghl_events_count
  FROM bookings b
  WHERE b.reservation_number IN ('OEV-G8TW7P', 'OEV-76FQL3')
)
SELECT 
  reservation_number,
  event_date,
  created_at,
  lifecycle_status,
  host_report_step,
  payment_status,
  booking_origin,
  host_jobs_count,
  balance_jobs_count,
  host_events_count,
  ghl_events_count,
  CASE 
    WHEN host_jobs_count = 0 THEN '❌ SIN HOST JOBS'
    WHEN host_jobs_count = 3 THEN '✓ 3 host jobs (correcto)'
    ELSE '⚠ ' || host_jobs_count || ' host jobs (verificar)'
  END as diagnostico_host_jobs
FROM booking_comparison
ORDER BY created_at;

-- Interpretación:
-- Esta vista muestra DIRECTAMENTE la diferencia entre ambos bookings
-- host_jobs_count debería ser 3 (30d, 7d, 1d) o menos si el booking se creó cerca del evento


-- =====================================================
-- QUERY 8: VERIFICAR TRIGGER AUTOMÁTICO
-- =====================================================
-- Verificar que el trigger bookings_auto_trigger_automation existe y está activo

SELECT 
  tgname as trigger_name,
  tgenabled as enabled,
  tgtype as trigger_type,
  pg_get_triggerdef(oid) as trigger_definition
FROM pg_trigger
WHERE tgname = 'bookings_auto_trigger_automation';

-- Interpretación:
-- Si NO hay rows: El trigger no está instalado (PROBLEMA CRÍTICO)
-- Si tgenabled != 'O': El trigger está deshabilitado
-- 'O' = Enabled, 'D' = Disabled


-- =====================================================
-- QUERY 9: BUSCAR ERRORES EN LOGS (si existen)
-- =====================================================
-- Intentar buscar logs de errores relacionados

SELECT 
  id,
  booking_id,
  event_type,
  metadata,
  created_at
FROM booking_events
WHERE booking_id IN (
  SELECT id FROM bookings WHERE reservation_number IN ('OEV-G8TW7P', 'OEV-76FQL3')
)
  AND (
    event_type LIKE '%error%' 
    OR event_type LIKE '%failed%'
    OR metadata::text LIKE '%error%'
  )
ORDER BY created_at;

-- Interpretación:
-- Si hay eventos de error: Ver qué falló específicamente


-- =====================================================
-- QUERY 10: VERIFICAR CRON DE AUTO-REPARACIÓN
-- =====================================================
-- Ver si el sistema de auto-reparación detectó el problema

SELECT 
  jobid,
  jobname,
  schedule,
  active,
  command
FROM cron.job
WHERE jobname LIKE '%auto-fix%' OR jobname LIKE '%health%';

-- Interpretación:
-- Verificar que el cron 'auto-fix-missing-jobs-hourly' esté activo
-- Este cron debería haber detectado y reparado el problema automáticamente


-- =====================================================
-- RESUMEN DE EJECUCIÓN
-- =====================================================
-- Ejecuta las queries en orden y documenta los resultados aquí:
/*

RESULTADOS:

Query 1 (Datos Básicos):
- OEV-76FQL3: [Documentar resultados]
- OEV-G8TW7P: [Documentar resultados]

Query 2 (Scheduled Jobs):
- OEV-76FQL3: [Cuántos jobs de host report]
- OEV-G8TW7P: [Cuántos jobs de host report]

Query 3 (Eventos):
- OEV-76FQL3: [Eventos de host report]
- OEV-G8TW7P: [Eventos de host report]

Query 4 (Policy):
- [Comparar policies]

Query 7 (Comparación Directa):
- [Vista lado a lado]

CAUSA IDENTIFICADA:
[Escribir aquí la causa raíz después del análisis]

SOLUCIÓN APLICADA:
[Escribir aquí la solución implementada]

*/


-- =====================================================
-- SOLUCIÓN TEMPORAL: REPARAR OEV-G8TW7P MANUALMENTE
-- =====================================================
-- Si el booking todavía está activo y no tiene jobs, ejecutar esto:

/*
-- PASO 1: Obtener el booking_id
SELECT id, event_date, lifecycle_status 
FROM bookings 
WHERE reservation_number = 'OEV-G8TW7P';

-- PASO 2: Llamar manualmente a la función de scheduling
-- (Reemplazar BOOKING_ID_AQUI con el ID real del paso 1)
SELECT extensions.http_post(
  url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/schedule-host-report-reminders',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := jsonb_build_object('booking_id', 'BOOKING_ID_AQUI')
);

-- PASO 3: Verificar que se crearon los jobs
SELECT job_type, run_at, status 
FROM scheduled_jobs 
WHERE booking_id = 'BOOKING_ID_AQUI' 
  AND job_type LIKE '%host%'
ORDER BY run_at;
*/
