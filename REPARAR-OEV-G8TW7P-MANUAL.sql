-- =====================================================
-- REPARACIÓN MANUAL: OEV-G8TW7P
-- =====================================================
-- Este booking no tiene host report jobs creados
-- Ejecutar esta reparación manual para crear los jobs
-- =====================================================

-- PASO 1: Verificar el estado actual del booking
SELECT 
  id,
  reservation_number,
  event_date,
  lifecycle_status,
  host_report_step,
  payment_status,
  status,
  created_at,
  event_date::date - CURRENT_DATE as dias_hasta_evento
FROM bookings
WHERE reservation_number = 'OEV-G8TW7P';

-- Interpretación:
-- - Si dias_hasta_evento es positivo: El evento todavía no pasó, podemos crear los jobs
-- - Si dias_hasta_evento es negativo: El evento ya pasó, NO crear jobs (solo documentar)


-- PASO 2: Verificar los jobs actuales (debería mostrar 0 host jobs)
SELECT 
  job_type,
  run_at,
  status,
  created_at
FROM scheduled_jobs
WHERE booking_id = (SELECT id FROM bookings WHERE reservation_number = 'OEV-G8TW7P')
ORDER BY created_at;


-- PASO 3: Llamar manualmente a schedule-host-report-reminders
-- IMPORTANTE: Solo ejecutar este paso SI el evento todavía no pasó (dias_hasta_evento > 0)

SELECT net.http_post(
  url := 'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/schedule-host-report-reminders',
  headers := '{"Content-Type": "application/json"}'::jsonb,
  body := jsonb_build_object(
    'booking_id', (SELECT id FROM bookings WHERE reservation_number = 'OEV-G8TW7P'),
    'force_reschedule', true
  )
);

-- Esperar 5 segundos y luego verificar...


-- PASO 4: Verificar que se crearon los jobs
SELECT 
  job_type,
  run_at,
  status,
  created_at,
  CASE 
    WHEN run_at > NOW() THEN '⏳ Pendiente de ejecutar'
    WHEN run_at <= NOW() AND status = 'pending' THEN '⚠ Vencido - Será ejecutado pronto'
    WHEN status = 'completed' THEN '✓ Ya ejecutado'
    ELSE status
  END as estado_interpretado
FROM scheduled_jobs
WHERE booking_id = (SELECT id FROM bookings WHERE reservation_number = 'OEV-G8TW7P')
  AND job_type LIKE '%host%'
ORDER BY run_at;

-- Interpretación:
-- Debería mostrar 1-3 jobs dependiendo de cuántos días faltan para el evento:
-- - Si faltan más de 30 días: 3 jobs (30d, 7d, 1d)
-- - Si faltan 7-30 días: 2 jobs (7d, 1d)
-- - Si faltan 1-7 días: 1 job (1d)
-- - Si falta menos de 1 día: 0 jobs (evento muy cercano)


-- PASO 5: Verificar el host_report_step
SELECT 
  reservation_number,
  host_report_step,
  CASE 
    WHEN host_report_step IS NULL THEN '⚠ Nunca se inicializó'
    WHEN host_report_step = 'not_started' THEN '✓ Correcto - En espera'
    WHEN host_report_step = 'pre_event_sent' THEN '✓ Reminder de 30d enviado'
    WHEN host_report_step = 'during_sent' THEN '✓ Reminder de 7d enviado'
    WHEN host_report_step = 'post_sent' THEN '✓ Reminder de 1d enviado'
    ELSE host_report_step
  END as estado
FROM bookings
WHERE reservation_number = 'OEV-G8TW7P';


-- =====================================================
-- RESUMEN DE EJECUCIÓN
-- =====================================================
/*

FECHA DE EJECUCIÓN: [Llenar al ejecutar]

PASO 1 - Estado del Booking:
- ID: [Llenar]
- Event Date: [Llenar]
- Días hasta evento: [Llenar]
- ¿Se puede reparar? [SÍ/NO]

PASO 2 - Jobs Antes de Reparar:
- Balance jobs: [Cantidad]
- Host jobs: [Cantidad - debería ser 0]

PASO 3 - Reparación:
- ¿Se ejecutó? [SÍ/NO]
- Motivo si NO se ejecutó: [Llenar si aplica]

PASO 4 - Jobs Después de Reparar:
- Host jobs creados: [Cantidad]
- Estado: [Descripción]

PASO 5 - Host Report Step:
- Antes: [NULL probablemente]
- Después: [Debería ser 'not_started']

RESULTADO FINAL:
[✓ Reparado exitosamente / ❌ No se pudo reparar / ⚠ Evento ya pasó]

*/
