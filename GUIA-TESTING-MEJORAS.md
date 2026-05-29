# Guía de Testing para las Mejoras de Automatización

## 🧪 Testing Seguro sin Afectar Producción

Esta guía te permite probar cada mejora de forma segura **antes** de depender completamente del sistema automatizado.

---

## ✅ TEST 1: Verificar que Todo se Instaló Correctamente

### SQL de Verificación Rápida:

```sql
-- Ejecutar este SQL primero
WITH verification AS (
  SELECT 
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'bookings_auto_trigger_automation') as trigger_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_trigger_booking_automation') as trigger_function_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'count_bookings_without_balance_jobs') as health_function_1_exists,
    EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'count_bookings_without_host_jobs') as health_function_2_exists,
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-fix-missing-jobs-hourly' AND active = true) as autofix_cron_active,
    EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-health-check-8am-est' AND active = true) as healthcheck_cron_active
)
SELECT 
  CASE 
    WHEN trigger_exists AND trigger_function_exists AND 
         health_function_1_exists AND health_function_2_exists AND
         autofix_cron_active AND healthcheck_cron_active
    THEN '✅ TODAS LAS MEJORAS INSTALADAS CORRECTAMENTE'
    ELSE '❌ FALTAN COMPONENTES - Revisar implementación'
  END as resultado_instalacion,
  trigger_exists,
  trigger_function_exists,
  health_function_1_exists,
  health_function_2_exists,
  autofix_cron_active,
  healthcheck_cron_active
FROM verification;
```

**Resultado esperado:** Todo en `true` y mensaje `✅ TODAS LAS MEJORAS INSTALADAS CORRECTAMENTE`

---

## 🧪 TEST 2: Probar el Trigger Automático (MEJORA #1)

### Opción A: Test con Booking Real (Seguro)

**Requisito:** Tener un booking en cualquier status que NO sea `pre_event_ready`

```sql
-- 1. Identificar un booking de prueba
SELECT 
  id,
  reservation_number,
  lifecycle_status,
  payment_status,
  event_date
FROM bookings
WHERE status != 'cancelled'
  AND lifecycle_status != 'pre_event_ready'
  AND payment_status = 'deposit_paid'
LIMIT 1;

-- 2. Anotar el ID del booking

-- 3. Contar jobs ANTES del cambio
SELECT COUNT(*) as jobs_antes
FROM scheduled_jobs
WHERE booking_id = 'TU_BOOKING_ID_AQUI';

-- 4. Cambiar a pre_event_ready
UPDATE bookings
SET lifecycle_status = 'pre_event_ready'
WHERE id = 'TU_BOOKING_ID_AQUI';

-- 5. Esperar 5-10 segundos

-- 6. Contar jobs DESPUÉS del cambio
SELECT COUNT(*) as jobs_despues
FROM scheduled_jobs
WHERE booking_id = 'TU_BOOKING_ID_AQUI';

-- 7. Ver los jobs creados
SELECT 
  job_type,
  status,
  run_at,
  created_at
FROM scheduled_jobs
WHERE booking_id = 'TU_BOOKING_ID_AQUI'
ORDER BY created_at DESC;

-- 8. Verificar que se crearon 6 jobs en total:
-- - 3 balance_retry jobs
-- - 3 host_report jobs
-- Si ves esto, ¡EL TRIGGER FUNCIONA! ✅
```

### Verificar logs del trigger:

```sql
-- Ver si el trigger ejecutó la llamada HTTP
SELECT 
  created_at,
  request->>'url' as url,
  response->>'status' as http_status,
  response->>'body' as response
FROM net._http_response
WHERE request->>'url' LIKE '%trigger-booking-automation%'
ORDER BY created_at DESC
LIMIT 3;

-- Deberías ver una entrada reciente con status '200'
```

---

## 🧪 TEST 3: Probar la Auto-Reparación (MEJORA #2)

### Test Manual (Forzar una situación de error):

```sql
-- 1. Crear un booking de prueba en pre_event_ready sin jobs
-- (simulamos que algo falló y no se crearon los jobs)

-- Primero, identifica un booking
SELECT id, reservation_number 
FROM bookings 
WHERE status != 'cancelled' 
LIMIT 1;

-- 2. Eliminar temporalmente sus jobs (para simular el problema)
-- NOTA: Solo hacer esto en ambiente de testing
DELETE FROM scheduled_jobs 
WHERE booking_id = 'TU_BOOKING_ID'
  AND job_type LIKE 'balance%';

-- 3. Verificar que no tiene jobs
SELECT COUNT(*) as jobs_count
FROM scheduled_jobs
WHERE booking_id = 'TU_BOOKING_ID'
  AND job_type LIKE 'balance%';
-- Debería ser 0

-- 4. Esperar hasta el minuto :15 de la próxima hora
-- (el cron se ejecuta a las :15 de cada hora)
-- Ejemplo: Si son las 2:30 PM, espera hasta las 3:15 PM

-- 5. Después del minuto :15, verificar que se reparó
SELECT COUNT(*) as jobs_count
FROM scheduled_jobs
WHERE booking_id = 'TU_BOOKING_ID'
  AND job_type LIKE 'balance%';
-- Ahora debería ser 3 ✅

-- 6. Ver logs del auto-fix
SELECT 
  created_at,
  request->>'url' as url,
  response->>'status' as status
FROM net._http_response
WHERE request->>'url' LIKE '%trigger-booking-automation%'
  OR request->>'url' LIKE '%schedule-host-report%'
ORDER BY created_at DESC
LIMIT 5;
```

---

## 🧪 TEST 4: Probar el Health Check y Email (MEJORA #4)

### Test Manual de la Edge Function:

**Desde Supabase Dashboard:**

1. Ve a **Edge Functions** → **daily-health-check**
2. Haz clic en **Invoke**
3. Body: `{}`
4. Haz clic en **Run**

**Resultado esperado:**
- Si todo está bien: `{"ok": true, "alert_sent": false, "message": "Sistema funcionando correctamente"}`
- Si hay problemas: `{"ok": true, "alert_sent": true, "issues_count": N, "issues": [...]}`

**Si `alert_sent: true`**, deberías recibir un email en **orlandoglobalministries@gmail.com** en 1-2 minutos.

### Test desde Terminal:

```bash
curl -X POST https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/daily-health-check \
  -H "Authorization: Bearer TU_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Forzar un Email de Alerta (para probar que funciona):

```sql
-- 1. Crear un job "atrasado" artificial para forzar una alerta
INSERT INTO scheduled_jobs (job_type, booking_id, run_at, status, attempts)
SELECT 
  'test_overdue_job',
  id,
  NOW() - INTERVAL '2 hours',  -- 2 horas en el pasado
  'pending',
  0
FROM bookings
WHERE status != 'cancelled'
LIMIT 1;

-- 2. Ejecutar el health check manualmente (desde Dashboard o curl)

-- 3. Deberías recibir un email con "🚨 Jobs Atrasados"

-- 4. Limpiar el job de prueba
DELETE FROM scheduled_jobs WHERE job_type = 'test_overdue_job';
```

---

## 🧪 TEST 5: Verificar Cron Jobs

### Ver próximas ejecuciones:

```sql
-- Ver cuándo se ejecutarán los cron jobs
SELECT 
  jobname,
  schedule,
  active,
  (SELECT run_start FROM cron.job_run_details 
   WHERE jobid = j.jobid 
   ORDER BY run_start DESC LIMIT 1) as ultima_ejecucion,
  CASE jobname
    WHEN 'process-scheduled-jobs-5min' THEN 'Cada 5 minutos (procesa jobs)'
    WHEN 'auto-fix-missing-jobs-hourly' THEN 'Cada hora a los :15 (repara bookings)'
    WHEN 'daily-health-check-8am-est' THEN 'Diario a las 8 AM EST (envía alertas)'
  END as descripcion
FROM cron.job j
WHERE jobname IN (
  'process-scheduled-jobs-5min',
  'auto-fix-missing-jobs-hourly',
  'daily-health-check-8am-est'
)
ORDER BY jobname;
```

### Ejecutar manualmente un cron (para testing):

**NOTA:** Los crons ejecutan código SQL, no se pueden ejecutar manualmente de forma simple.

Para probar el auto-fix manualmente, puedes ejecutar el código del cron directamente:

```sql
-- Ejecutar el código del auto-fix manualmente (solo para testing)
DO $$
DECLARE
  booking_record RECORD;
  request_id bigint;
  fixed_count INT := 0;
BEGIN
  RAISE NOTICE '[TEST-AUTO-FIX] Starting manual test...';
  
  -- Buscar bookings sin balance jobs
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
    LIMIT 1  -- Solo 1 para testing
  LOOP
    RAISE NOTICE '[TEST-AUTO-FIX] Found booking to repair: %', booking_record.reservation_number;
    fixed_count := fixed_count + 1;
  END LOOP;
  
  IF fixed_count = 0 THEN
    RAISE NOTICE '[TEST-AUTO-FIX] No bookings need repair - system is healthy ✅';
  ELSE
    RAISE NOTICE '[TEST-AUTO-FIX] Found % booking(s) that would be repaired', fixed_count;
  END IF;
END $$;
```

---

## 📋 Checklist de Testing Completo

Ejecuta estos tests en orden:

- [ ] **TEST 1:** Verificar instalación (query arriba) → Todo debe estar en `true`
- [ ] **TEST 2:** Probar trigger automático → Debe crear 6 jobs
- [ ] **TEST 3:** Verificar auto-reparación → Logs en `net._http_response`
- [ ] **TEST 4:** Probar health check manualmente → Debe responder correctamente
- [ ] **TEST 5:** Forzar email de alerta → Debe llegar a orlandoglobalministries@gmail.com
- [ ] **TEST 6:** Verificar cron jobs activos → Deben estar en `active: true`
- [ ] **Esperar 1 hora** → Ver si auto-fix ejecutó (query logs)
- [ ] **Esperar al día siguiente (8 AM)** → Ver si health check ejecutó

---

## 🎯 Criterios de Éxito

### El sistema funciona correctamente si:

1. ✅ Cuando cambias un booking a `pre_event_ready`, se crean 6 jobs automáticamente (3 balance + 3 host report)
2. ✅ Los cron jobs aparecen como `active: true` en `cron.job`
3. ✅ El health check responde correctamente cuando lo invocas manualmente
4. ✅ Recibes el email de prueba cuando fuerzas una alerta
5. ✅ Los logs de `net._http_response` muestran llamadas exitosas (status 200)
6. ✅ No hay errores en los logs de Edge Functions

### Si alguno falla:

- Revisa `INSTRUCCIONES-IMPLEMENTACION-MEJORAS.md` para ver si te saltaste algún paso
- Verifica que el SERVICE_ROLE_KEY es correcto en los 3 archivos
- Revisa logs en Supabase Dashboard → Edge Functions → Logs
- Ejecuta el rollback y vuelve a intentar

---

## 🚀 Después del Testing

Una vez que todos los tests pasen:

1. ✅ **Deja el sistema funcionando**
2. ✅ **Monitorea los primeros 3-7 días** (ejecuta `DASHBOARD-MONITOREO-JOBS.sql` diariamente)
3. ✅ **Después de 1 semana**, si todo funciona bien, olvídate del sistema
4. ✅ **Solo actúa cuando recibas un email de alerta**

**El sistema ahora se mantiene solo.**
