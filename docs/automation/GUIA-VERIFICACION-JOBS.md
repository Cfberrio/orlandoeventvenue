# Guía de Verificación y Diagnóstico de Jobs

## 📋 Resumen del Sistema de Jobs

Tu sistema de bookings utiliza **scheduled_jobs** para automatizar las siguientes tareas:

### 1. **Balance Payment Jobs** 💰
- `balance_retry_1`, `balance_retry_2`, `balance_retry_3`
- `create_balance_payment_link`
- **Cuándo se crean**: Cuando un booking llega a `lifecycle_status = 'pre_event_ready'` y `payment_status = 'deposit_paid'`
- **Lógica**:
  - **Short notice (≤15 días)**: Crea link inmediatamente + 1 retry a las 48h
  - **Long notice (>15 días)**: Programa 3 retries (T-15 días, +48h, +48h)

### 2. **Host Report Jobs** 📝
- `host_report_pre_start` (event - 30 días)
- `host_report_during` (event - 7 días)
- `host_report_post` (event - 1 hora)
- **Cuándo se crean**: Cuando un booking llega a `pre_event_ready`
- **Qué hacen**: Actualizan el campo `host_report_step` del booking, lo que dispara workflows en GHL

### 3. **Lifecycle Transition Jobs** 🔄
- `set_lifecycle_in_progress`: Se ejecuta al inicio del evento
- `set_lifecycle_post_event`: Se ejecuta 24h después del fin del evento
- **Condiciones**: Verifica que el booking esté fully_paid y tenga staff asignado

### 4. **Sincronización con GHL** 🔗
- Función: `sync-to-ghl`
- Se llama automáticamente después de cambios importantes
- Envía un snapshot completo del booking a GHL

---

## 🔍 Cómo Verificar que Todo Funciona

### Paso 1: Ejecutar el Script de Verificación

Abre **Supabase SQL Editor** y ejecuta el archivo `VERIFICACION-JOBS.sql`:

```bash
# Conecta a Supabase y copia el contenido del archivo VERIFICACION-JOBS.sql
```

Este script te mostrará:
- ✅ Bookings con todos sus jobs correctamente programados
- ❌ Bookings sin jobs (cuando deberían tenerlos)
- ⚠️ Jobs fallidos o atrasados
- 📊 Resumen ejecutivo de problemas

### Paso 2: Revisar el Resumen Ejecutivo (Query #10)

El último query del script te da un resumen de problemas:

```
metrica                                      | valor
---------------------------------------------|-------
Total bookings activos                       | 25
Bookings sin jobs de balance (deposit_paid)  | 3
Bookings sin jobs de host report             | 2
Jobs fallidos (todos los tipos)              | 1
Jobs atrasados (>1 hora)                     | 0
Fallos sync GHL (últimas 24h)                | 0
```

**Interpretación**:
- Si `Bookings sin jobs de balance` > 0: Hay bookings que necesitan jobs de balance
- Si `Bookings sin jobs de host report` > 0: Hay bookings que necesitan jobs de host report
- Si `Jobs fallidos` > 0: Revisa los detalles en queries anteriores
- Si `Jobs atrasados` > 0: El cron job `process-scheduled-jobs` no se está ejecutando

---

## 🔧 Cómo se Crean los Jobs

### Flujo Normal de Creación

```
1. Booking creado → status = 'pending'
2. Depósito pagado → payment_status = 'deposit_paid'
3. Admin marca como "Pre-Event Ready" → lifecycle_status = 'pre_event_ready'
4. Se llama a 'trigger-booking-automation' (manualmente o por trigger)
5. 'trigger-booking-automation' llama a:
   - 'schedule-balance-payment' → Crea balance payment jobs
   - 'schedule-host-report-reminders' → Crea host report jobs
```

### ⚠️ PUNTO CRÍTICO: trigger-booking-automation

**Actualmente**, `trigger-booking-automation` se llama **manualmente** desde el admin:

📍 **Archivo**: `src/pages/admin/BookingDetail.tsx` (línea 254)

```typescript
const { data, error } = await supabase.functions.invoke("trigger-booking-automation", {
  body: { booking_id: bookingId }
});
```

**PROBLEMA POTENCIAL**: Si el admin olvida hacer clic en el botón, los jobs NO se crean.

### ✅ Solución Recomendada: Trigger Automático

Necesitas crear un **database trigger** que llame a `trigger-booking-automation` automáticamente cuando:
- `lifecycle_status` cambia a `'pre_event_ready'`

**Script para crear el trigger**:

```sql
-- Función que llama a trigger-booking-automation via HTTP
CREATE OR REPLACE FUNCTION public.auto_trigger_booking_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cfg record;
  request_id bigint;
  supabase_url text;
  service_key text;
BEGIN
  -- Solo ejecutar cuando cambia a pre_event_ready
  IF NEW.lifecycle_status = 'pre_event_ready' AND 
     (OLD.lifecycle_status IS NULL OR OLD.lifecycle_status != 'pre_event_ready') THEN
    
    supabase_url := current_setting('app.settings.supabase_url', true);
    service_key := current_setting('app.settings.service_key', true);
    
    IF supabase_url IS NULL OR service_key IS NULL THEN
      RAISE NOTICE 'Supabase URL or service key not configured';
      RETURN NEW;
    END IF;
    
    -- Llamar a trigger-booking-automation via pg_net
    SELECT net.http_post(
      url := supabase_url || '/functions/v1/trigger-booking-automation',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || service_key
      ),
      body := jsonb_build_object('booking_id', NEW.id)
    ) INTO request_id;
    
    RAISE NOTICE 'Triggered booking automation for % (request_id: %)', NEW.id, request_id;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Crear el trigger
DROP TRIGGER IF EXISTS bookings_auto_trigger_automation ON public.bookings;
CREATE TRIGGER bookings_auto_trigger_automation
  AFTER UPDATE OF lifecycle_status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_trigger_booking_automation();
```

---

## 🩺 Diagnóstico de Problemas Comunes

### Problema 1: Bookings sin Balance Payment Jobs

**Síntomas**:
- Query #2 del script muestra bookings sin jobs de balance
- `payment_status = 'deposit_paid'` pero no hay jobs programados

**Causas**:
1. No se llamó a `trigger-booking-automation`
2. La función `schedule-balance-payment` falló silenciosamente
3. El booking tiene `requires_payment = false` en su policy

**Solución**:
```sql
-- Verificar si se llamó trigger-booking-automation
SELECT * FROM booking_events 
WHERE booking_id = 'TU_BOOKING_ID' 
AND event_type = 'booking_automation_triggered';

-- Si NO aparece, llamarlo manualmente:
-- (desde Supabase Functions o Postman)
POST https://TU_PROJECT.supabase.co/functions/v1/trigger-booking-automation
{
  "booking_id": "TU_BOOKING_ID"
}
```

### Problema 2: Bookings sin Host Report Jobs

**Síntomas**:
- Query #4 muestra bookings sin host report jobs
- `lifecycle_status = 'pre_event_ready'` pero no hay jobs

**Causas**:
1. No se llamó a `trigger-booking-automation`
2. La función `schedule-host-report-reminders` falló

**Solución**: Igual que Problema 1

### Problema 3: Jobs Atrasados

**Síntomas**:
- Query #10 muestra "Jobs atrasados (>1 hora)" > 0
- Jobs con `status = 'pending'` y `run_at < NOW()`

**Causas**:
1. El cron job `process-scheduled-jobs` no se está ejecutando
2. El cron job está deshabilitado o mal configurado

**Solución**:
```bash
# Verificar cron jobs en Supabase Dashboard
# Database → Cron Jobs → Buscar "process-scheduled-jobs"

# Debería ejecutarse cada 5 minutos:
SELECT cron.schedule(
  'process-scheduled-jobs-cron',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://TU_PROJECT.supabase.co/functions/v1/process-scheduled-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_key')
    ),
    body := '{}'::jsonb
  );
  $$
);
```

### Problema 4: Sincronización GHL Fallida

**Síntomas**:
- Query #6 muestra `sync_to_ghl_failed`
- Los datos no se actualizan en GHL

**Causas**:
1. URL de webhook GHL mal configurada
2. GHL rechaza el request (token inválido, formato incorrecto)
3. Network timeout

**Solución**:
```sql
-- Ver detalles del error
SELECT 
  b.reservation_number,
  be.created_at,
  be.metadata->>'error' as error_detalle,
  be.metadata->>'context' as contexto
FROM booking_events be
JOIN bookings b ON be.booking_id = b.id
WHERE be.event_type = 'sync_to_ghl_failed'
ORDER BY be.created_at DESC
LIMIT 10;

-- Reintentar manualmente
-- POST https://TU_PROJECT.supabase.co/functions/v1/sync-to-ghl
-- { "booking_id": "TU_BOOKING_ID" }
```

### Problema 5: Jobs Fallidos (attempts >= 3)

**Síntomas**:
- Query #3 o #5 muestran jobs con `status = 'failed'` y `attempts >= 3`

**Causas**:
- Balance payment: Booking no en `deposit_paid`, o ya está `fully_paid`
- Host report: Booking cancelado o host report ya completado
- Lifecycle: Condiciones no cumplidas (sin staff, no fully_paid)

**Solución**:
```sql
-- Ver razón del fallo
SELECT 
  sj.id,
  sj.job_type,
  sj.last_error,
  sj.attempts,
  b.reservation_number,
  b.payment_status,
  b.lifecycle_status,
  b.status
FROM scheduled_jobs sj
JOIN bookings b ON sj.booking_id = b.id
WHERE sj.status = 'failed' 
  AND sj.attempts >= 3
ORDER BY sj.updated_at DESC;

-- Si es un fallo legítimo (booking cancelado, ya pagado, etc.):
-- NO hacer nada, el sistema lo manejó correctamente

-- Si es un fallo temporal (network, etc.):
-- Resetear el job para reintento
UPDATE scheduled_jobs 
SET status = 'pending', attempts = 0, last_error = NULL
WHERE id = 'JOB_ID';
```

---

## 📊 Checklist de Verificación Diaria

- [ ] Ejecutar `VERIFICACION-JOBS.sql` query #10 (Resumen Ejecutivo)
- [ ] Verificar que `Jobs atrasados` = 0
- [ ] Verificar que `Jobs fallidos` = 0 (o investigar si > 0)
- [ ] Verificar que no hay bookings sin jobs cuando deberían tenerlos
- [ ] Revisar fallos recientes de sync GHL (últimas 24h)

---

## 🔧 Scripts de Reparación Rápida

### Reparar Booking sin Jobs

```sql
-- Llamar a trigger-booking-automation para UN booking específico
SELECT net.http_post(
  url := 'https://TU_PROJECT.supabase.co/functions/v1/trigger-booking-automation',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.settings.service_key')
  ),
  body := jsonb_build_object('booking_id', 'TU_BOOKING_ID')
);
```

### Reparar TODOS los Bookings sin Jobs

```sql
-- Solo ejecutar si tienes MUCHOS bookings sin jobs
SELECT net.http_post(
  url := 'https://TU_PROJECT.supabase.co/functions/v1/trigger-booking-automation',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || current_setting('app.settings.service_key')
  ),
  body := jsonb_build_object('booking_id', b.id)
)
FROM bookings b
WHERE b.lifecycle_status = 'pre_event_ready'
  AND b.payment_status = 'deposit_paid'
  AND b.status != 'cancelled'
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_jobs sj 
    WHERE sj.booking_id = b.id 
    AND sj.job_type LIKE 'balance%'
  );
```

---

## 📞 Contacto y Soporte

Si después de seguir esta guía sigues teniendo problemas:

1. Ejecuta `VERIFICACION-JOBS.sql` y guarda los resultados
2. Revisa los logs de Supabase Functions (especialmente `process-scheduled-jobs`)
3. Busca en `booking_events` eventos de error relacionados
4. Contacta con el equipo de desarrollo con:
   - Resultados del script de verificación
   - IDs de bookings problemáticos
   - Mensajes de error específicos
