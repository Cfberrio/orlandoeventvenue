-- =====================================================
-- DASHBOARD DE MONITOREO EN TIEMPO REAL
-- =====================================================
-- Este dashboard te da una vista rápida del estado
-- de todos los jobs y automatizaciones
-- =====================================================

-- =====================================================
-- 📊 PANEL 1: MÉTRICAS CLAVE
-- =====================================================
WITH metrics AS (
  SELECT 
    'Total Bookings Activos' as metrica,
    COUNT(*) as valor,
    '📅' as icono,
    CASE WHEN COUNT(*) > 0 THEN 'success' ELSE 'warning' END as estado
  FROM bookings 
  WHERE status != 'cancelled'
    AND lifecycle_status IN ('pre_event_ready', 'in_progress')

  UNION ALL

  SELECT 
    'Jobs Pendientes Total',
    COUNT(*),
    '⏳',
    CASE 
      WHEN COUNT(*) = 0 THEN 'success'
      WHEN COUNT(*) < 10 THEN 'info'
      ELSE 'warning'
    END
  FROM scheduled_jobs
  WHERE status = 'pending'

  UNION ALL

  SELECT 
    'Jobs Atrasados (>1h)',
    COUNT(*),
    '⚠️',
    CASE WHEN COUNT(*) = 0 THEN 'success' ELSE 'critical' END
  FROM scheduled_jobs
  WHERE status = 'pending'
    AND run_at < NOW() - INTERVAL '1 hour'

  UNION ALL

  SELECT 
    'Jobs Fallidos (intentos máx)',
    COUNT(*),
    '❌',
    CASE WHEN COUNT(*) = 0 THEN 'success' ELSE 'warning' END
  FROM scheduled_jobs
  WHERE status = 'failed'
    AND attempts >= 3

  UNION ALL

  SELECT 
    'Sync GHL Fallidos (24h)',
    COUNT(*),
    '🔗',
    CASE WHEN COUNT(*) = 0 THEN 'success' ELSE 'critical' END
  FROM booking_events
  WHERE event_type = 'sync_to_ghl_failed'
    AND created_at > NOW() - INTERVAL '24 hours'

  UNION ALL

  SELECT 
    'Bookings sin Balance Jobs',
    COUNT(*),
    '💰',
    CASE WHEN COUNT(*) = 0 THEN 'success' ELSE 'critical' END
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
    'Bookings sin Host Report Jobs',
    COUNT(*),
    '📝',
    CASE WHEN COUNT(*) = 0 THEN 'success' ELSE 'warning' END
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
)
SELECT 
  icono,
  metrica,
  valor,
  CASE 
    WHEN estado = 'success' THEN '✅ OK'
    WHEN estado = 'info' THEN 'ℹ️ Info'
    WHEN estado = 'warning' THEN '⚠️ Atención'
    WHEN estado = 'critical' THEN '🚨 CRÍTICO'
  END as estado_visual
FROM metrics
ORDER BY 
  CASE estado
    WHEN 'critical' THEN 1
    WHEN 'warning' THEN 2
    WHEN 'info' THEN 3
    WHEN 'success' THEN 4
  END;

-- =====================================================
-- 📅 PANEL 2: PRÓXIMOS EVENTOS (Next 7 días)
-- =====================================================
SELECT 
  b.event_date,
  b.start_time,
  b.reservation_number,
  b.lifecycle_status,
  b.payment_status,
  CASE 
    WHEN b.payment_status = 'fully_paid' THEN '✅'
    WHEN b.payment_status = 'deposit_paid' THEN '⏳'
    ELSE '❌'
  END as payment_icon,
  (SELECT COUNT(*) FROM booking_staff_assignments WHERE booking_id = b.id) as staff_count,
  CASE 
    WHEN EXISTS (SELECT 1 FROM booking_staff_assignments WHERE booking_id = b.id) THEN '✅'
    ELSE '❌'
  END as staff_icon,
  (SELECT COUNT(*) FROM scheduled_jobs WHERE booking_id = b.id AND status = 'pending') as pending_jobs,
  (SELECT COUNT(*) FROM scheduled_jobs WHERE booking_id = b.id AND status = 'failed') as failed_jobs,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM scheduled_jobs 
      WHERE booking_id = b.id 
      AND status = 'pending' 
      AND run_at < NOW()
    ) THEN '⚠️ JOBS ATRASADOS'
    WHEN NOT EXISTS (
      SELECT 1 FROM scheduled_jobs 
      WHERE booking_id = b.id 
      AND job_type LIKE 'balance%'
    ) AND b.payment_status = 'deposit_paid' THEN '❌ SIN BALANCE JOBS'
    WHEN NOT EXISTS (
      SELECT 1 FROM scheduled_jobs 
      WHERE booking_id = b.id 
      AND job_type LIKE 'host_report%'
    ) THEN '⚠️ SIN HOST JOBS'
    ELSE '✅ OK'
  END as alerta
FROM bookings b
WHERE b.status != 'cancelled'
  AND b.event_date >= CURRENT_DATE
  AND b.event_date <= CURRENT_DATE + INTERVAL '7 days'
ORDER BY b.event_date, b.start_time;

-- =====================================================
-- ⏰ PANEL 3: PRÓXIMOS JOBS A EJECUTARSE (Next 24h)
-- =====================================================
SELECT 
  sj.run_at,
  b.reservation_number,
  b.event_date,
  sj.job_type,
  sj.status,
  CASE 
    WHEN sj.run_at < NOW() THEN '🚨 ATRASADO'
    WHEN sj.run_at < NOW() + INTERVAL '1 hour' THEN '⚠️ PRÓXIMO'
    WHEN sj.run_at < NOW() + INTERVAL '6 hours' THEN 'ℹ️ Hoy'
    ELSE '📅 Programado'
  END as urgencia,
  sj.attempts,
  EXTRACT(EPOCH FROM (sj.run_at - NOW())) / 3600 as horas_hasta_ejecucion
FROM scheduled_jobs sj
JOIN bookings b ON sj.booking_id = b.id
WHERE sj.status = 'pending'
  AND sj.run_at <= NOW() + INTERVAL '24 hours'
ORDER BY sj.run_at ASC
LIMIT 20;

-- =====================================================
-- ❌ PANEL 4: PROBLEMAS ACTIVOS
-- =====================================================
WITH active_issues AS (
  -- Issue: Jobs atrasados
  SELECT 
    b.reservation_number,
    b.id as booking_id,
    b.event_date,
    '🚨 Job Atrasado' as tipo_problema,
    sj.job_type || ' (run_at: ' || sj.run_at::text || ')' as detalle,
    'HIGH' as prioridad,
    sj.run_at as timestamp_problema
  FROM scheduled_jobs sj
  JOIN bookings b ON sj.booking_id = b.id
  WHERE sj.status = 'pending'
    AND sj.run_at < NOW() - INTERVAL '1 hour'

  UNION ALL

  -- Issue: Jobs fallidos
  SELECT 
    b.reservation_number,
    b.id,
    b.event_date,
    '❌ Job Fallido',
    sj.job_type || ' - ' || COALESCE(sj.last_error, 'Sin error') as detalle,
    CASE WHEN sj.attempts >= 3 THEN 'CRITICAL' ELSE 'MEDIUM' END,
    sj.updated_at
  FROM scheduled_jobs sj
  JOIN bookings b ON sj.booking_id = b.id
  WHERE sj.status = 'failed'
    AND b.status != 'cancelled'

  UNION ALL

  -- Issue: Bookings sin balance jobs
  SELECT 
    b.reservation_number,
    b.id,
    b.event_date,
    '💰 Sin Balance Jobs',
    'Payment: ' || b.payment_status || ', Lifecycle: ' || b.lifecycle_status,
    'HIGH',
    b.updated_at
  FROM bookings b
  WHERE b.payment_status = 'deposit_paid'
    AND b.status != 'cancelled'
    AND b.lifecycle_status = 'pre_event_ready'
    AND NOT EXISTS (
      SELECT 1 FROM scheduled_jobs sj 
      WHERE sj.booking_id = b.id 
      AND sj.job_type LIKE 'balance%'
    )

  UNION ALL

  -- Issue: Bookings sin host report jobs
  SELECT 
    b.reservation_number,
    b.id,
    b.event_date,
    '📝 Sin Host Report Jobs',
    'Lifecycle: ' || b.lifecycle_status || ', Step: ' || COALESCE(b.host_report_step, 'null'),
    'MEDIUM',
    b.updated_at
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

  UNION ALL

  -- Issue: Sync GHL fallidos recientes
  SELECT 
    b.reservation_number,
    b.id,
    b.event_date,
    '🔗 Sync GHL Fallido',
    'Error: ' || COALESCE(be.metadata->>'error', 'Unknown'),
    'HIGH',
    be.created_at
  FROM booking_events be
  JOIN bookings b ON be.booking_id = b.id
  WHERE be.event_type = 'sync_to_ghl_failed'
    AND be.created_at > NOW() - INTERVAL '24 hours'
)
SELECT 
  CASE prioridad
    WHEN 'CRITICAL' THEN '🔴'
    WHEN 'HIGH' THEN '🟠'
    WHEN 'MEDIUM' THEN '🟡'
    ELSE '🟢'
  END as urgencia_icon,
  tipo_problema,
  reservation_number,
  event_date,
  detalle,
  prioridad,
  timestamp_problema
FROM active_issues
ORDER BY 
  CASE prioridad
    WHEN 'CRITICAL' THEN 1
    WHEN 'HIGH' THEN 2
    WHEN 'MEDIUM' THEN 3
    ELSE 4
  END,
  timestamp_problema DESC;

-- =====================================================
-- 📈 PANEL 5: ACTIVIDAD RECIENTE (Últimas 2 horas)
-- =====================================================
SELECT 
  sj.updated_at,
  b.reservation_number,
  sj.job_type,
  sj.status,
  CASE 
    WHEN sj.status = 'completed' THEN '✅ Completado'
    WHEN sj.status = 'failed' THEN '❌ Fallido: ' || COALESCE(sj.last_error, 'Sin error')
    WHEN sj.status = 'cancelled' THEN '🚫 Cancelado: ' || COALESCE(sj.last_error, 'Sin razón')
    ELSE sj.status
  END as resultado,
  sj.attempts,
  sj.completed_at
FROM scheduled_jobs sj
JOIN bookings b ON sj.booking_id = b.id
WHERE sj.updated_at > NOW() - INTERVAL '2 hours'
  AND sj.status IN ('completed', 'failed', 'cancelled')
ORDER BY sj.updated_at DESC
LIMIT 20;

-- =====================================================
-- 🔄 PANEL 6: SALUD DEL PROCESADOR DE JOBS
-- =====================================================
-- Verifica que process-scheduled-jobs se está ejecutando

WITH processor_health AS (
  SELECT 
    MAX(created_at) as ultima_ejecucion,
    COUNT(*) as ejecuciones_ultimas_2h,
    COUNT(CASE WHEN response->>'status' = '200' THEN 1 END) as ejecuciones_exitosas,
    COUNT(CASE WHEN response->>'status' != '200' THEN 1 END) as ejecuciones_fallidas
  FROM net._http_response
  WHERE request->>'url' LIKE '%process-scheduled-jobs%'
    AND created_at > NOW() - INTERVAL '2 hours'
)
SELECT 
  CASE 
    WHEN ultima_ejecucion IS NULL THEN '🔴 CRÍTICO: No hay registros de ejecución'
    WHEN ultima_ejecucion < NOW() - INTERVAL '10 minutes' THEN '🟠 ADVERTENCIA: Última ejecución hace más de 10 min'
    ELSE '🟢 OK: Procesador funcionando'
  END as estado_procesador,
  ultima_ejecucion,
  EXTRACT(EPOCH FROM (NOW() - ultima_ejecucion)) / 60 as minutos_desde_ultima_ejecucion,
  ejecuciones_ultimas_2h,
  ejecuciones_exitosas,
  ejecuciones_fallidas,
  CASE 
    WHEN ejecuciones_ultimas_2h >= 20 THEN '✅ Frecuencia normal (cada 5-6 min)'
    WHEN ejecuciones_ultimas_2h >= 10 THEN '⚠️ Frecuencia baja'
    ELSE '❌ Frecuencia muy baja o inactivo'
  END as analisis_frecuencia
FROM processor_health;

-- =====================================================
-- 💡 PANEL 7: RECOMENDACIONES
-- =====================================================
SELECT 
  CASE 
    WHEN (SELECT COUNT(*) FROM scheduled_jobs WHERE status = 'pending' AND run_at < NOW() - INTERVAL '1 hour') > 0
      THEN '1. 🚨 URGENTE: Hay jobs atrasados. Verificar que el cron job esté activo.'
    WHEN (SELECT COUNT(*) FROM bookings b WHERE b.payment_status = 'deposit_paid' 
        AND b.lifecycle_status = 'pre_event_ready' 
        AND NOT EXISTS (SELECT 1 FROM scheduled_jobs WHERE booking_id = b.id AND job_type LIKE 'balance%')) > 0
      THEN '2. 🔧 Hay bookings sin balance jobs. Ejecutar REPARAR-JOBS-FALTANTES.sql'
    WHEN (SELECT COUNT(*) FROM booking_events WHERE event_type = 'sync_to_ghl_failed' 
        AND created_at > NOW() - INTERVAL '24 hours') > 0
      THEN '3. ⚠️ Hay fallos recientes en sync GHL. Revisar configuración de webhook.'
    WHEN (SELECT COUNT(*) FROM scheduled_jobs WHERE status = 'failed' AND attempts >= 3) > 0
      THEN '4. ℹ️ Hay jobs fallidos. Revisar detalles en Panel 4 y decidir si resetear.'
    ELSE '✅ Todo parece estar funcionando correctamente'
  END as recomendacion,
  NOW() as momento_revision;

-- =====================================================
-- INSTRUCCIONES DE USO DEL DASHBOARD
-- =====================================================

/*
🎯 CÓMO USAR ESTE DASHBOARD:

1. EJECUTA TODO EL SCRIPT (Ctrl+Enter o Run)
   - Verás múltiples tablas de resultados

2. REVISA PANEL 1 (MÉTRICAS CLAVE) primero
   - Si hay valores con 🚨 o ⚠️, hay problemas activos
   - Prioriza los marcados como "CRÍTICO"

3. REVISA PANEL 4 (PROBLEMAS ACTIVOS)
   - Lista todos los problemas detectados
   - Ordenados por prioridad
   - Usa esto para saber QUÉ bookings necesitan atención

4. REVISA PANEL 6 (SALUD DEL PROCESADOR)
   - Si está 🔴 o 🟠, el cron job no funciona
   - Sigue instrucciones en REPARAR-JOBS-FALTANTES.sql query #5

5. REVISA PANEL 7 (RECOMENDACIONES)
   - Te dice exactamente qué hacer siguiente

FRECUENCIA RECOMENDADA:
- Producción: Ejecutar 1-2 veces al día
- Durante testing: Ejecutar cada hora
- Si hay problemas: Ejecutar cada 15 minutos hasta resolver

GUARDAR COMO FAVORITO:
- En Supabase SQL Editor, guarda este query como "Dashboard Jobs"
- Así puedes ejecutarlo rápidamente cuando lo necesites
*/
