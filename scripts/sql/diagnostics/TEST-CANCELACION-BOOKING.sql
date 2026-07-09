-- =====================================================
-- TEST DE CANCELACIÓN DE BOOKINGS
-- =====================================================
-- Ejecuta estos queries para probar la funcionalidad
-- de cancelación de bookings
-- =====================================================

-- =====================================================
-- 1. ANTES DE CANCELAR - Ver estado actual
-- =====================================================
-- Elige un booking de prueba (no completed, no cancelled)
SELECT 
  id,
  reservation_number,
  full_name,
  email,
  event_date,
  status,
  lifecycle_status,
  CASE 
    WHEN status = 'completed' THEN '❌ NO se puede cancelar (completed)'
    WHEN status = 'cancelled' THEN 'ℹ️ Ya está cancelado'
    ELSE '✅ Se puede cancelar'
  END as puede_cancelar
FROM bookings
WHERE status NOT IN ('completed', 'cancelled')
ORDER BY created_at DESC
LIMIT 5;

-- Anota el booking_id que vas a usar para testing

-- =====================================================
-- 2. VER JOBS ANTES DE CANCELAR
-- =====================================================
-- Reemplaza 'TU_BOOKING_ID' con el ID del booking de prueba
SELECT 
  job_type,
  status,
  run_at,
  attempts,
  created_at,
  CASE 
    WHEN status IN ('pending', 'failed') THEN '🗑️ Se eliminará al cancelar'
    WHEN status = 'completed' THEN '✅ Se mantendrá (ya completado)'
    ELSE '❓ Desconocido'
  END as que_pasara
FROM scheduled_jobs
WHERE booking_id = 'TU_BOOKING_ID'
ORDER BY created_at;

-- Anota cuántos jobs hay y cuántos son pending/failed

-- =====================================================
-- 3. DESPUÉS DE USAR EL BOTÓN - Verificar cambios
-- =====================================================
-- Verificar que el booking cambió a 'cancelled'
SELECT 
  id,
  reservation_number,
  status,
  lifecycle_status,
  updated_at,
  CASE 
    WHEN status = 'cancelled' THEN '✅ Cancelado correctamente'
    ELSE '❌ NO se canceló'
  END as resultado
FROM bookings
WHERE id = 'TU_BOOKING_ID';

-- =====================================================
-- 4. VERIFICAR QUE SE ELIMINARON LOS JOBS
-- =====================================================
-- Debería mostrar solo jobs 'completed' (si los había)
-- Jobs 'pending' y 'failed' deben haber sido eliminados
SELECT 
  job_type,
  status,
  run_at,
  attempts,
  CASE 
    WHEN status = 'completed' THEN '✅ Mantenido (ya estaba completado)'
    ELSE '⚠️ Este job NO debería estar aquí'
  END as verificacion
FROM scheduled_jobs
WHERE booking_id = 'TU_BOOKING_ID'
ORDER BY created_at;

-- Si NO aparecen jobs 'pending' o 'failed', ✅ FUNCIONA CORRECTAMENTE

-- =====================================================
-- 5. VERIFICAR EVENTO EN booking_events
-- =====================================================
-- Debe existir un evento 'booking_cancelled'
SELECT 
  event_type,
  channel,
  metadata,
  created_at,
  CASE 
    WHEN event_type = 'booking_cancelled' THEN '✅ Evento registrado correctamente'
    ELSE 'ℹ️ Otro evento'
  END as tipo_evento
FROM booking_events
WHERE booking_id = 'TU_BOOKING_ID'
ORDER BY created_at DESC
LIMIT 10;

-- Debe aparecer un evento reciente con type 'booking_cancelled'

-- =====================================================
-- 6. VERIFICAR METADATA DEL EVENTO
-- =====================================================
-- Ver detalles de la cancelación
SELECT 
  metadata->>'cancelled_at' as fecha_cancelacion,
  (metadata->>'jobs_deleted')::int as jobs_eliminados,
  metadata->>'previous_status' as status_anterior,
  metadata->>'previous_lifecycle' as lifecycle_anterior
FROM booking_events
WHERE booking_id = 'TU_BOOKING_ID'
  AND event_type = 'booking_cancelled';

-- =====================================================
-- 7. RESUMEN DE VERIFICACIÓN
-- =====================================================
WITH booking_check AS (
  SELECT 
    b.id,
    b.reservation_number,
    b.status = 'cancelled' as is_cancelled,
    NOT EXISTS (
      SELECT 1 FROM scheduled_jobs 
      WHERE booking_id = b.id 
      AND status IN ('pending', 'failed')
    ) as jobs_cleaned,
    EXISTS (
      SELECT 1 FROM booking_events 
      WHERE booking_id = b.id 
      AND event_type = 'booking_cancelled'
    ) as event_logged
  FROM bookings b
  WHERE b.id = 'TU_BOOKING_ID'
)
SELECT 
  reservation_number,
  CASE 
    WHEN is_cancelled AND jobs_cleaned AND event_logged 
    THEN '✅ CANCELACIÓN EXITOSA - TODO FUNCIONÓ CORRECTAMENTE'
    ELSE '❌ PROBLEMA - Ver detalles abajo'
  END as resultado_general,
  CASE WHEN is_cancelled THEN '✅' ELSE '❌ NO cancelado' END as status_updated,
  CASE WHEN jobs_cleaned THEN '✅' ELSE '❌ Jobs no limpiados' END as jobs_deleted,
  CASE WHEN event_logged THEN '✅' ELSE '❌ Evento no registrado' END as event_recorded
FROM booking_check;

-- =====================================================
-- INSTRUCCIONES DE USO
-- =====================================================

/*
📋 CÓMO PROBAR LA CANCELACIÓN:

PASO 1: Identificar booking de prueba
- Ejecuta query #1
- Elige un booking que muestre "✅ Se puede cancelar"
- Anota su booking_id

PASO 2: Ver estado inicial
- Ejecuta query #2 con el booking_id
- Anota cuántos jobs tiene

PASO 3: Cancelar desde UI
- Ve a Admin → Bookings → Click en el booking
- Click en botón rojo "Cancel Booking"
- Confirma en el dialog

PASO 4: Verificar cancelación
- Ejecuta queries #3-7 con el booking_id
- Query #7 debe mostrar: "✅ CANCELACIÓN EXITOSA - TODO FUNCIONÓ CORRECTAMENTE"

PASO 5: Verificar email
- Revisa el inbox del guest (booking.email)
- Debe haber llegado email de "Booking Cancelled"

PASO 6: Verificar GHL (opcional)
- Ve a GoHighLevel
- Busca el contacto del booking
- Debe mostrar status actualizado a 'cancelled'

RESULTADO ESPERADO:
✅ Status → 'cancelled'
✅ Jobs pending/failed → eliminados
✅ Jobs completed → mantenidos
✅ Evento → registrado en booking_events
✅ Email → enviado al guest
✅ GHL → sincronizado

Si todo muestra ✅, la funcionalidad está perfecta.
*/
