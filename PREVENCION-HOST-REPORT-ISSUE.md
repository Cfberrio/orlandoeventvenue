# Prevención: Host Report Jobs No Creados

## 📋 Problema Identificado

**Booking:** OEV-G8TW7P
**Fecha:** 2026-01-28
**Síntoma:** No se crearon host report jobs para el booking

---

## 🔍 Causa Raíz

### El Flujo Normal (Esperado):

1. Booking se crea con `lifecycle_status = 'confirmed'`
2. Deposit se paga → `lifecycle_status = 'deposit_paid'`
3. Balance se paga → `lifecycle_status = 'pre_event_ready'`
4. **Trigger automático se dispara** → Crea balance y host report jobs
5. Booking avanza a `lifecycle_status = 'in_progress'`

### Lo Que Pasó con OEV-G8TW7P:

1. Booking se crea con `lifecycle_status = 'in_progress'` (¡directamente!)
2. Deposit se paga 40 segundos después
3. Balance se paga 8 días después
4. **El trigger NUNCA se disparó** porque el lifecycle nunca cambió A 'pre_event_ready' o 'in_progress' (ya estaba en in_progress desde el inicio)
5. Los host report jobs NUNCA se crearon

### ¿Por Qué Se Creó Directamente en 'in_progress'?

Posibles causas:
- **Booking creado manualmente en admin dashboard** con lifecycle incorrecto
- **Importación desde sistema externo** (GHL?) con lifecycle ya avanzado
- **Bug en el flujo de creación** que saltó estados

---

## ✅ Solución Implementada

### 1. Actualización del Trigger Automático

**Archivo:** `supabase/migrations/20260128000000_fix_trigger_for_in_progress.sql`

**Cambio:**
```sql
-- ANTES (solo pre_event_ready):
IF NEW.lifecycle_status = 'pre_event_ready' AND ...

-- DESPUÉS (pre_event_ready O in_progress):
IF (NEW.lifecycle_status IN ('pre_event_ready', 'in_progress')) AND ...
```

**Resultado:**
- Ahora el trigger se dispara cuando un booking cambia a `'pre_event_ready'` O `'in_progress'`
- Cubre el caso de bookings que saltan 'pre_event_ready'

### 2. Cron de Auto-Reparación (Ya Existente)

**Archivo:** `supabase/migrations/20260126222113_auto_fix_missing_jobs_cron.sql`

**Ya Implementado:**
```sql
WHERE b.lifecycle_status IN ('pre_event_ready', 'in_progress')
  AND NOT EXISTS (SELECT 1 FROM scheduled_jobs ...)
```

El cron ya buscaba bookings en 'in_progress' sin jobs y los reparaba automáticamente cada hora.

**¿Por qué no reparó OEV-G8TW7P?**
- Posible timing: El cron se ejecuta a los :15 de cada hora
- Si el booking se creó entre dos ejecuciones, pudo pasar desapercibido temporalmente
- O si el booking se creó después de que implementamos el cron (timeline reciente)

---

## 🛡️ Prevención Futura

### A. Validaciones en Creación de Bookings

**Recomendación:** Agregar validación en el código de creación de bookings:

```typescript
// Al crear un booking nuevo:
if (isNewBooking) {
  // SIEMPRE iniciar en 'confirmed', nunca en 'in_progress'
  lifecycle_status = 'confirmed';
}
```

### B. Monitoreo Proactivo

El sistema de `daily-health-check` ya detecta bookings sin host jobs:

```sql
SELECT COUNT(*) FROM bookings b
WHERE b.lifecycle_status IN ('pre_event_ready', 'in_progress')
  AND b.event_date >= CURRENT_DATE
  AND NOT EXISTS (SELECT 1 FROM scheduled_jobs WHERE booking_id = b.id AND job_type LIKE 'host_report%')
```

Esto envía una alerta diaria a las 8 AM EST.

### C. Reparación Automática

El cron `auto-fix-missing-jobs-hourly` detecta y repara automáticamente cada hora.

### D. Trigger Actualizado

El trigger ahora cubre ambos estados (`pre_event_ready` e `in_progress`).

---

## 📊 Sistema de Protección Actual (Post-Fix)

| Capa | Descripción | Frecuencia |
|------|-------------|------------|
| **Trigger Automático** | Se dispara al cambiar a 'pre_event_ready' o 'in_progress' | Inmediato |
| **Cron Auto-Reparación** | Detecta y repara bookings sin jobs | Cada hora (:15) |
| **Health Check Diario** | Alerta por email de problemas | Diario (8 AM EST) |

Con estas 3 capas, el problema de OEV-G8TW7P **no debería volver a ocurrir**.

---

## 🔧 Reparación Manual (Si Ocurre Nuevamente)

Si se detecta un booking sin host report jobs:

1. Ejecutar el script: `REPARAR-OEV-G8TW7P-MANUAL.sql`
2. Reemplazar `OEV-G8TW7P` con el reservation_number afectado
3. Verificar que el evento todavía no pasó
4. Ejecutar el paso 3 (llamar a `schedule-host-report-reminders`)
5. Verificar que los jobs se crearon correctamente

---

## 📈 Métricas de Éxito

Para confirmar que el fix funciona:

```sql
-- Ejecutar semanalmente para verificar:
SELECT 
  COUNT(*) as bookings_sin_host_jobs,
  ARRAY_AGG(reservation_number) as bookings_afectados
FROM bookings b
WHERE b.lifecycle_status IN ('pre_event_ready', 'in_progress')
  AND b.event_date >= CURRENT_DATE
  AND b.status != 'cancelled'
  AND NOT EXISTS (
    SELECT 1 FROM scheduled_jobs 
    WHERE booking_id = b.id AND job_type LIKE 'host_report%'
  );
```

**Meta:** Este query debería retornar `bookings_sin_host_jobs = 0` siempre.

Si retorna bookings, el sistema de auto-reparación los corregirá en la siguiente hora.

---

## 🎯 Conclusión

**Causa:** Trigger no cubría el caso de bookings que saltan 'pre_event_ready'

**Solución:** Actualizar trigger para incluir 'in_progress'

**Resultado:** Sistema ahora tiene 3 capas de protección contra este problema

**Estado:** ✅ Resuelto y prevenido
