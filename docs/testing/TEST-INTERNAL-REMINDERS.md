# 🧪 Testing Internal Booking Reminders

## 📋 Test Plan

Este documento te guía paso a paso para probar el sistema de reminders para internal bookings.

---

## ⚙️ Pre-requisitos

### 1. Aplicar migración

```bash
cd /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue

# Aplicar la migración
npx supabase db push
```

**Verificar que se aplicó**:
```sql
-- En Supabase SQL Editor
SELECT table_name 
FROM information_schema.tables 
WHERE table_name = 'availability_block_reminders';
-- Debe retornar 1 fila
```

### 2. Deploy Edge Function

```bash
# Deploy la nueva función
npx supabase functions deploy send-internal-booking-reminders
```

### 3. Configurar Variables de Entorno

En Supabase Dashboard → Settings → Edge Functions → Secrets:

**Opción A: SendGrid (Recomendado)**
```
SENDGRID_API_KEY = "SG.xxxxxxxxxxxxxxxxxxxxxxxx"
SENDGRID_FROM_EMAIL = "noreply@orlandoeventvenue.com"
```

**Opción B: GoHighLevel**
```
GHL_API_KEY = "your-ghl-api-key"
GHL_LOCATION_ID = "your-location-id"
```

---

## 🧪 Test 1: Verificar Tabla Creada

**Tiempo**: 1 minuto

```sql
-- Ejecutar en Supabase SQL Editor

-- 1. Verificar tabla existe
SELECT * FROM availability_block_reminders LIMIT 1;
-- Resultado esperado: 0 rows (tabla vacía al inicio)

-- 2. Verificar indexes
SELECT indexname 
FROM pg_indexes 
WHERE tablename = 'availability_block_reminders';
-- Resultado esperado: 5 indexes

-- 3. Verificar constraint UNIQUE
SELECT conname 
FROM pg_constraint 
WHERE conrelid = 'availability_block_reminders'::regclass
  AND contype = 'u';
-- Resultado esperado: availability_block_reminders_block_id_reminder_type_key
```

**✅ Resultado esperado**: Tabla existe con indexes y constraints correctos

---

## 🧪 Test 2: Crear Internal Booking de Prueba

**Tiempo**: 3 minutos

### Paso 1: Crear booking para MAÑANA

1. Ir a `/admin/schedule`
2. Click "Internal Booking"
3. Llenar formulario:
   - **Booking Type**: Daily
   - **Date**: MAÑANA (fecha de mañana)
   - **Event Type**: Test Meeting
   - **Client Name**: Test Internal Reminder
   - **Email**: tu-email@ejemplo.com (usa tu email real para recibir el reminder)
   - **Phone**: (555) 123-4567
   - **Notes**: Test reminder system
4. Click "Create Internal Booking"

### Paso 2: Verificar en Database

```sql
-- Buscar el booking creado
SELECT 
  b.id,
  b.full_name,
  b.email,
  b.event_date,
  b.booking_origin,
  bp.policy_name,
  bp.send_pre_event_1d
FROM bookings b
JOIN booking_policies bp ON b.policy_id = bp.id
WHERE b.full_name = 'Test Internal Reminder'
ORDER BY b.created_at DESC
LIMIT 1;
```

**Verificar**:
- ✅ `booking_origin` = 'internal'
- ✅ `policy_name` = 'INTERNAL_BLOCK_FLOW'
- ✅ `send_pre_event_1d` = TRUE
- ✅ `event_date` = MAÑANA

### Paso 3: Verificar Availability Block

```sql
-- Buscar el availability block
SELECT 
  ab.id,
  ab.booking_id,
  ab.start_date,
  ab.source,
  b.full_name
FROM availability_blocks ab
JOIN bookings b ON ab.booking_id = b.id
WHERE b.full_name = 'Test Internal Reminder';
```

**Verificar**:
- ✅ `source` = 'internal_admin'
- ✅ `start_date` = MAÑANA

**✅ Resultado esperado**: Booking e internal block creados correctamente

---

## 🧪 Test 3: Invocar Función Manualmente

**Tiempo**: 2 minutos

### Opción A: Desde Terminal (cURL)

```bash
# Reemplaza YOUR_SERVICE_KEY con tu Supabase service role key
curl -X POST \
  https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-internal-booking-reminders \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json"
```

### Opción B: Desde Supabase Dashboard

1. Ir a Edge Functions → send-internal-booking-reminders
2. Click "Invoke"
3. Body: `{}` (vacío)
4. Click "Invoke Function"

### Respuesta Esperada:

```json
{
  "success": true,
  "date": "2026-01-18",
  "total_blocks": 1,
  "sent": 1,
  "skipped": 0,
  "errors": 0,
  "results": [
    {
      "block_id": "abc-123-...",
      "status": "sent"
    }
  ]
}
```

**✅ Resultado esperado**: `sent: 1`, `errors: 0`

---

## 🧪 Test 4: Verificar Email Recibido

**Tiempo**: 2 minutos

1. Revisar inbox del email que usaste en el booking
2. Buscar email de: `noreply@orlandoeventvenue.com` (o tu SENDGRID_FROM_EMAIL)
3. Subject: "🔔 Event Reminder: Tomorrow at Orlando Event Venue"

**Contenido esperado**:
```
🔔 Reminder: Your event at Orlando Event Venue is TOMORROW!

Event: Test Meeting
Date: [Fecha de mañana]
Time: All day
Guests: 50

Location:
Orlando Event Venue
3847 E Colonial Dr
Orlando, FL 32803

...
```

**✅ Resultado esperado**: Email recibido con contenido correcto

---

## 🧪 Test 5: Verificar Registro en DB

**Tiempo**: 1 minuto

```sql
-- Ver el reminder enviado
SELECT 
  abr.id,
  abr.reminder_type,
  abr.sent_at,
  abr.channel,
  abr.status,
  b.full_name,
  b.email,
  ab.start_date
FROM availability_block_reminders abr
JOIN bookings b ON abr.booking_id = b.id
JOIN availability_blocks ab ON abr.block_id = ab.id
WHERE b.full_name = 'Test Internal Reminder'
ORDER BY abr.sent_at DESC;
```

**Verificar**:
- ✅ 1 registro existe
- ✅ `reminder_type` = '1d_before'
- ✅ `status` = 'sent'
- ✅ `channel` = 'sendgrid' o 'ghl'
- ✅ `sent_at` = ahora

**✅ Resultado esperado**: Reminder registrado correctamente

---

## 🧪 Test 6: Idempotencia (No Duplicados)

**Tiempo**: 2 minutos

### Paso 1: Invocar función de nuevo

```bash
# Mismo curl command de Test 3
curl -X POST \
  https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-internal-booking-reminders \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json"
```

### Respuesta Esperada:

```json
{
  "success": true,
  "date": "2026-01-18",
  "total_blocks": 1,
  "sent": 0,
  "skipped": 1,
  "errors": 0,
  "results": [
    {
      "block_id": "abc-123-...",
      "status": "skipped",
      "reason": "already_sent"
    }
  ]
}
```

**Verificar**:
- ✅ `sent: 0` (no se envió de nuevo)
- ✅ `skipped: 1` (se saltó porque ya existía)
- ✅ `reason: "already_sent"`

### Paso 2: Verificar que NO llegó email duplicado

Revisar inbox: NO debe haber 2do email

### Paso 3: Verificar DB

```sql
-- Contar reminders para este booking
SELECT COUNT(*) 
FROM availability_block_reminders abr
JOIN bookings b ON abr.booking_id = b.id
WHERE b.full_name = 'Test Internal Reminder';
-- Debe retornar: 1 (no 2)
```

**✅ Resultado esperado**: Idempotencia funciona, NO hay duplicados

---

## 🧪 Test 7: Booking Recurrente (Múltiples Blocks)

**Tiempo**: 5 minutos

### Paso 1: Crear booking recurrente

1. Ir a `/admin/schedule`
2. Click "Internal Booking"
3. Llenar:
   - **Booking Type**: Hourly
   - **Date**: MAÑANA (selecciona un día específico, ej: Lunes)
   - **Start Time**: 10:00
   - **End Time**: 14:00
   - **Duration**: 1 Week (para crear 2 ocurrencias)
   - **Event Type**: Recurring Test
   - **Client Name**: Test Recurring Reminder
   - **Email**: tu-email@ejemplo.com
   - **Phone**: (555) 999-9999
4. Click "Create Internal Booking"

### Paso 2: Verificar múltiples blocks

```sql
-- Debe crear 2 blocks (misma hora, 2 días diferentes)
SELECT 
  ab.id,
  ab.start_date,
  ab.start_time,
  ab.end_time,
  b.full_name
FROM availability_blocks ab
JOIN bookings b ON ab.booking_id = b.id
WHERE b.full_name = 'Test Recurring Reminder'
ORDER BY ab.start_date;
```

**Verificar**:
- ✅ 2 filas retornadas
- ✅ Misma hora (10:00 - 14:00)
- ✅ Fechas diferentes (1 semana de diferencia)

### Paso 3: Invocar función

```bash
# Solo el primer block debe enviarse (para mañana)
curl -X POST \
  https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-internal-booking-reminders \
  -H "Authorization: Bearer YOUR_SERVICE_KEY"
```

**Respuesta esperada**:
```json
{
  "sent": 1,
  "total_blocks": 2,
  ...
}
```
Solo 1 enviado porque solo 1 block es "mañana"

### Paso 4: Verificar DB

```sql
-- Solo 1 reminder debe existir (para mañana)
SELECT 
  abr.id,
  ab.start_date,
  abr.sent_at
FROM availability_block_reminders abr
JOIN availability_blocks ab ON abr.block_id = ab.id
JOIN bookings b ON ab.booking_id = b.id
WHERE b.full_name = 'Test Recurring Reminder';
```

**Verificar**:
- ✅ Solo 1 fila (no 2)
- ✅ `start_date` = MAÑANA

**✅ Resultado esperado**: Solo se envió reminder para la primera ocurrencia

---

## 🧪 Test 8: Cron Job (Ejecución Automática)

**Tiempo**: 24 horas

### Paso 1: Esperar al próximo día a las 8 AM

El cron job está configurado para ejecutar diariamente a las 8 AM Orlando time (13:00 UTC).

### Paso 2: Verificar logs

1. Ir a Supabase Dashboard
2. Edge Functions → send-internal-booking-reminders
3. Pestaña "Invocations"
4. Buscar ejecución a las ~8:00 AM

**Verificar**:
- ✅ Función se ejecutó automáticamente
- ✅ No hay errores en logs
- ✅ `sent` > 0 si había bookings para "mañana"

### Paso 3: Verificar reminders en DB

```sql
-- Ver reminders enviados hoy por cron
SELECT 
  abr.sent_at,
  b.full_name,
  b.event_date,
  abr.status
FROM availability_block_reminders abr
JOIN bookings b ON abr.booking_id = b.id
WHERE DATE(abr.sent_at) = CURRENT_DATE
ORDER BY abr.sent_at DESC;
```

**✅ Resultado esperado**: Cron job ejecuta automáticamente todos los días

---

## 🧪 Test 9: Policy Guard (External Booking)

**Tiempo**: 3 minutos

### Paso 1: Crear external booking para mañana

1. Ir a `/admin/schedule`
2. Click "External Booking"
3. Crear para MAÑANA
4. Email: test-external@ejemplo.com

### Paso 2: Invocar función

```bash
curl -X POST \
  https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-internal-booking-reminders \
  -H "Authorization: Bearer YOUR_SERVICE_KEY"
```

### Respuesta Esperada:

```json
{
  "total_blocks": 0,
  "sent": 0,
  ...
}
```

**Por qué?**: La función solo busca blocks con `source = 'internal_admin'`, y external bookings usan `source = 'external_admin'`.

**✅ Resultado esperado**: External bookings NO reciben reminders (correcto)

---

## 🧪 Test 10: Clean Up (Limpiar Tests)

**Tiempo**: 2 minutos

```sql
-- Eliminar todos los bookings de prueba
DELETE FROM bookings 
WHERE full_name LIKE 'Test%Reminder';

-- Verificar que reminders también se eliminaron (CASCADE)
SELECT COUNT(*) 
FROM availability_block_reminders;
-- Debe ser 0 (o menos que antes)
```

---

## 📊 Resumen de Tests

| Test | Objetivo | Estado |
|------|----------|--------|
| 1 | Tabla creada | [ ] |
| 2 | Crear internal booking | [ ] |
| 3 | Invocar función manual | [ ] |
| 4 | Email recibido | [ ] |
| 5 | Registro en DB | [ ] |
| 6 | Idempotencia | [ ] |
| 7 | Booking recurrente | [ ] |
| 8 | Cron job automático | [ ] |
| 9 | Policy guard (external) | [ ] |
| 10 | Clean up | [ ] |

---

## 🚨 Troubleshooting

### Email no llega

1. **Verificar SendGrid configurado**:
```bash
# En Supabase Dashboard → Settings → Edge Functions → Secrets
# Debe existir: SENDGRID_API_KEY
```

2. **Ver logs de función**:
```
# En Supabase Dashboard → Edge Functions → Logs
# Buscar:
[SENDGRID_SENT] Email to test@ejemplo.com
# o
[SENDGRID_ERROR] ...
```

3. **Verificar spam folder**

4. **Verificar SendGrid Dashboard**:
- Activity → Email Activity
- Buscar por email
- Ver status (delivered/bounced)

### Función retorna error

1. **Ver logs completos**:
```
# Supabase Dashboard → Edge Functions → Logs
# Buscar [ERROR] o [FATAL_ERROR]
```

2. **Verificar variables de entorno**:
```bash
# Deben existir:
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SENDGRID_API_KEY (o GHL_API_KEY)
```

### Cron job no ejecuta

1. **Verificar config.toml**:
```toml
[functions.send-internal-booking-reminders.cron]
schedule = "0 13 * * *"
```

2. **Re-deploy si necesario**:
```bash
npx supabase functions deploy send-internal-booking-reminders
```

---

## ✅ Criterios de Éxito

Para aprobar el testing completo:

- [x] Migración aplicada sin errores
- [x] Edge function deployada
- [x] Variables de entorno configuradas
- [x] Test 1-6 completados exitosamente
- [x] Email recibido en inbox
- [x] Idempotencia funciona (no duplicados)
- [x] Booking recurrente funciona (solo 1er block enviado)
- [x] Cron job ejecuta automáticamente (verificar al día siguiente)
- [x] External bookings NO reciben reminders (correcto)

**Si todos estos puntos se cumplen: ✅ Sistema funcional y listo para producción**

---

**Fecha de testing**: ___________  
**Testeado por**: ___________  
**Resultado**: [ ] APROBADO / [ ] FALLÓ  
**Notas**: ___________________________________________
