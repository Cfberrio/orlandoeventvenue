# 🔔 Internal Booking Reminders - Sistema de Recordatorios

## 📋 Resumen

Sistema automático para enviar recordatorios 1 día antes de **cada ocurrencia** de un internal booking, incluyendo bookings recurrentes.

---

## 🎯 Problema que Resuelve

### Antes:
- Internal bookings recurrentes creaban 1 booking + múltiples availability_blocks
- Ejemplo: Booking todos los lunes x 2 meses = 1 booking + 8 blocks
- Solo se podía enviar 1 reminder (para el primer día)
- Las ocurrencias subsecuentes no recibían reminder

### Ahora:
- Sistema envía reminder automático 1 día antes de **cada ocurrencia**
- Cada availability_block = 1 reminder independiente
- Cron job diario verifica qué blocks son "mañana" y envía reminders
- Tracking completo de qué reminders se enviaron

---

## 🏗️ Arquitectura

### Componentes:

1. **Tabla**: `availability_block_reminders`
   - Trackea qué reminders se enviaron
   - Previene duplicados
   - Almacena status (sent/failed)

2. **Edge Function**: `send-internal-booking-reminders`
   - Ejecuta diariamente a las 8 AM Orlando time
   - Busca blocks para "mañana"
   - Envía reminders via SendGrid o GHL
   - Registra en DB

3. **Cron Job**: Schedule en `config.toml`
   - `0 13 * * *` (1 PM UTC = 8 AM Orlando)
   - Invoca la edge function automáticamente

---

## 🔄 Flujo Completo

```
Día 1: Admin crea internal booking recurrente
  ├─> Booking type: Hourly
  ├─> Date: Lunes (Jan 20)
  ├─> Time: 10:00 - 14:00
  ├─> Duration: 1 Month
  └─> Resultado: 1 booking + 4 availability_blocks (4 lunes)

Día X (Jan 19 a las 8 AM):
  Cron Job ejecuta ─> send-internal-booking-reminders
    ├─> Busca blocks para "mañana" (Jan 20)
    ├─> Encuentra: Block #1 (primer lunes)
    ├─> Verifica: send_pre_event_1d = TRUE ✅
    ├─> Verifica: reminder ya enviado? NO ✅
    ├─> Envía: Email via SendGrid
    ├─> Registra: availability_block_reminders (block #1)
    └─> Log: "[SUCCESS] ✅ Reminder sent for block abc123"

Día X+7 (Jan 26 a las 8 AM):
  Cron Job ejecuta ─> send-internal-booking-reminders
    ├─> Busca blocks para "mañana" (Jan 27)
    ├─> Encuentra: Block #2 (segundo lunes)
    ├─> Verifica: reminder ya enviado? NO ✅
    ├─> Envía: Email via SendGrid
    └─> Registra: availability_block_reminders (block #2)

... y así sucesivamente para cada ocurrencia
```

---

## 📊 Schema de Base de Datos

### Tabla: `availability_block_reminders`

```sql
CREATE TABLE availability_block_reminders (
  id UUID PRIMARY KEY,
  block_id UUID REFERENCES availability_blocks(id),
  booking_id UUID REFERENCES bookings(id),
  reminder_type TEXT NOT NULL, -- '1d_before'
  sent_at TIMESTAMPTZ DEFAULT now(),
  channel TEXT, -- 'sendgrid', 'ghl', 'sms'
  status TEXT DEFAULT 'sent', -- 'sent', 'failed', 'pending'
  error_message TEXT,
  metadata JSONB,
  
  UNIQUE(block_id, reminder_type) -- Previene duplicados
);
```

### Relaciones:
- `block_id` → `availability_blocks.id`
- `booking_id` → `bookings.id`

### Indexes:
- `block_id` (búsquedas frecuentes)
- `booking_id` (reportes)
- `sent_at` (auditoría)
- `status` (filtrar errores)

---

## ⚙️ Configuración

### Variables de Entorno Requeridas:

#### Opción A: SendGrid (Recomendado para emails)
```bash
SENDGRID_API_KEY="SG.xxxxxxxxxxxxxxxxxxxxxxxx"
SENDGRID_FROM_EMAIL="noreply@orlandoeventvenue.com"
```

#### Opción B: GoHighLevel (Si prefieres GHL)
```bash
GHL_API_KEY="your-ghl-api-key"
GHL_LOCATION_ID="your-location-id"
```

**Nota**: La función intenta SendGrid primero, luego GHL como fallback.

---

## 🧪 Testing Manual

### 1. Invocar la función manualmente

```bash
curl -X POST \
  https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/send-internal-booking-reminders \
  -H "Authorization: Bearer YOUR_SERVICE_KEY" \
  -H "Content-Type: application/json"
```

**Respuesta esperada**:
```json
{
  "success": true,
  "date": "2026-01-18",
  "total_blocks": 2,
  "sent": 2,
  "skipped": 0,
  "errors": 0,
  "results": [
    {
      "block_id": "abc-123",
      "status": "sent"
    },
    {
      "block_id": "def-456",
      "status": "sent"
    }
  ]
}
```

### 2. Crear un internal booking de prueba

```typescript
// En admin dashboard:
// 1. Ir a /admin/schedule
// 2. Click "Internal Booking"
// 3. Crear booking para MAÑANA
// 4. Esperar 5 minutos
// 5. Invocar manualmente la función
// 6. Verificar que se envió el reminder
```

### 3. Verificar en Database

```sql
-- Ver todos los reminders enviados
SELECT 
  abr.id,
  abr.reminder_type,
  abr.sent_at,
  abr.channel,
  abr.status,
  b.full_name,
  b.event_type,
  ab.start_date
FROM availability_block_reminders abr
JOIN bookings b ON abr.booking_id = b.id
JOIN availability_blocks ab ON abr.block_id = ab.id
ORDER BY abr.sent_at DESC
LIMIT 20;

-- Ver blocks que necesitan reminder mañana
SELECT 
  ab.id,
  ab.start_date,
  b.full_name,
  b.email,
  b.event_type,
  bp.send_pre_event_1d
FROM availability_blocks ab
JOIN bookings b ON ab.booking_id = b.id
JOIN booking_policies bp ON b.policy_id = bp.id
WHERE ab.source = 'internal_admin'
  AND ab.start_date = CURRENT_DATE + INTERVAL '1 day'
  AND bp.send_pre_event_1d = TRUE;

-- Verificar si reminder ya fue enviado para un block
SELECT * 
FROM availability_block_reminders 
WHERE block_id = 'your-block-id'
  AND reminder_type = '1d_before';
```

---

## 📧 Contenido del Reminder

### Email enviado al cliente:

```
🔔 Reminder: Your event at Orlando Event Venue is TOMORROW!

Event: Corporate Meeting
Date: Saturday, January 18, 2026
Time: 10:00 AM - 2:00 PM
Guests: 50

Location:
Orlando Event Venue
3847 E Colonial Dr
Orlando, FL 32803

Access Instructions:
- Use the magnetic key from the lockbox (CODE: 10102025)
- WiFi: GlobalChurch / Orlandoministry
- Full venue rules in your booking confirmation

Questions? Contact us at (407) 276-3234

See you tomorrow!
```

---

## 🔍 Queries Útiles

### 1. Ver reminders de hoy
```sql
SELECT 
  abr.*,
  b.full_name,
  b.email,
  ab.start_date
FROM availability_block_reminders abr
JOIN bookings b ON abr.booking_id = b.id
JOIN availability_blocks ab ON abr.block_id = ab.id
WHERE DATE(abr.sent_at) = CURRENT_DATE;
```

### 2. Ver reminders fallidos
```sql
SELECT * 
FROM availability_block_reminders 
WHERE status = 'failed'
ORDER BY sent_at DESC;
```

### 3. Contar reminders por mes
```sql
SELECT 
  DATE_TRUNC('month', sent_at) as month,
  COUNT(*) as total_reminders,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM availability_block_reminders
GROUP BY month
ORDER BY month DESC;
```

### 4. Ver próximos reminders a enviar
```sql
SELECT 
  ab.id as block_id,
  ab.start_date,
  b.full_name,
  b.email,
  b.event_type,
  CASE 
    WHEN EXISTS (
      SELECT 1 FROM availability_block_reminders 
      WHERE block_id = ab.id AND reminder_type = '1d_before'
    ) THEN 'Already sent'
    ELSE 'Pending'
  END as reminder_status
FROM availability_blocks ab
JOIN bookings b ON ab.booking_id = b.id
JOIN booking_policies bp ON b.policy_id = bp.id
WHERE ab.source = 'internal_admin'
  AND ab.start_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 days'
  AND bp.send_pre_event_1d = TRUE
ORDER BY ab.start_date;
```

---

## 🚨 Troubleshooting

### Problema: Reminder no se envió

**Verificar**:

1. **Policy correcta?**
```sql
SELECT b.id, bp.policy_name, bp.send_pre_event_1d
FROM bookings b
JOIN booking_policies bp ON b.policy_id = bp.id
WHERE b.id = 'your-booking-id';
```
→ Si `send_pre_event_1d = FALSE`, el reminder NO se envía (correcto)

2. **Availability block existe para mañana?**
```sql
SELECT * FROM availability_blocks
WHERE source = 'internal_admin'
  AND start_date = CURRENT_DATE + INTERVAL '1 day';
```
→ Si no hay blocks, no hay qué recordar

3. **Ya se envió reminder para ese block?**
```sql
SELECT * FROM availability_block_reminders
WHERE block_id = 'your-block-id'
  AND reminder_type = '1d_before';
```
→ Si existe registro, ya se envió (idempotencia funcionando)

4. **Cron job está ejecutando?**
```bash
# Ver logs en Supabase Dashboard
# Edge Functions → send-internal-booking-reminders → Logs
# Buscar ejecuciones recientes a las 8 AM
```

5. **Variables de entorno configuradas?**
```bash
# Verificar que SENDGRID_API_KEY o GHL_API_KEY estén configuradas
# En Supabase Dashboard → Settings → Edge Functions → Secrets
```

---

### Problema: Reminder se envió múltiples veces (duplicado)

**Causa**: Constraint `UNIQUE(block_id, reminder_type)` debe prevenir esto

**Verificar**:
```sql
SELECT block_id, reminder_type, COUNT(*) as count
FROM availability_block_reminders
GROUP BY block_id, reminder_type
HAVING COUNT(*) > 1;
```

**Solución**: Si hay duplicados, eliminar manualmente:
```sql
-- Mantener solo el más reciente
DELETE FROM availability_block_reminders
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY block_id, reminder_type 
      ORDER BY sent_at DESC
    ) as rn
    FROM availability_block_reminders
  ) t WHERE rn > 1
);
```

---

### Problema: Cron job no ejecuta

**Verificar**:

1. **Configuración en config.toml**:
```toml
[functions.send-internal-booking-reminders.cron]
schedule = "0 13 * * *"
```

2. **Re-deploy si es necesario**:
```bash
npx supabase functions deploy send-internal-booking-reminders
```

3. **Ver logs de ejecución**:
- Ir a Supabase Dashboard
- Edge Functions → send-internal-booking-reminders
- Pestaña "Invocations"
- Verificar ejecuciones a las 8 AM (13:00 UTC)

---

### Problema: Email no llega

**Verificar**:

1. **SendGrid configurado?**
```bash
echo $SENDGRID_API_KEY
# Debe mostrar: SG.xxxxxxxxxx
```

2. **Email en spam?**
- Verificar carpeta de spam del cliente
- Verificar dominio de SendGrid esté verificado

3. **Logs de SendGrid**:
- Ir a SendGrid Dashboard
- Activity → Email Activity
- Buscar email del cliente
- Ver status (delivered/bounced/spam)

4. **Fallback a GHL**:
Si SendGrid no está configurado, la función intenta GHL automáticamente

---

## 📊 Monitoreo y Métricas

### Dashboard recomendado (queries para crear gráficos):

```sql
-- Reminders enviados por día (últimos 30 días)
SELECT 
  DATE(sent_at) as date,
  COUNT(*) as total,
  COUNT(CASE WHEN status = 'sent' THEN 1 END) as successful,
  COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed
FROM availability_block_reminders
WHERE sent_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY DATE(sent_at)
ORDER BY date DESC;

-- Tasa de éxito
SELECT 
  ROUND(
    100.0 * COUNT(CASE WHEN status = 'sent' THEN 1 END) / COUNT(*),
    2
  ) as success_rate_pct
FROM availability_block_reminders
WHERE sent_at >= CURRENT_DATE - INTERVAL '30 days';

-- Reminders por canal
SELECT 
  channel,
  COUNT(*) as total,
  ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 2) as percentage
FROM availability_block_reminders
WHERE sent_at >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY channel;
```

---

## 🔧 Mantenimiento

### Limpiar reminders antiguos (opcional)

```sql
-- Eliminar reminders de hace más de 6 meses
DELETE FROM availability_block_reminders
WHERE sent_at < CURRENT_DATE - INTERVAL '6 months';
```

### Re-enviar reminder fallido manualmente

```sql
-- 1. Eliminar registro fallido
DELETE FROM availability_block_reminders
WHERE block_id = 'your-block-id'
  AND reminder_type = '1d_before';

-- 2. Invocar la función manualmente (curl command arriba)
-- La función detectará que no existe y lo enviará de nuevo
```

---

## 🎯 Futuras Mejoras (Opcional)

### 1. Reminders 2 horas antes
```sql
-- Agregar nuevo reminder_type
INSERT INTO availability_block_reminders (..., reminder_type = '2h_before');

-- Modificar edge function para soportar múltiples tipos
```

### 2. SMS Reminders
```typescript
// Ya soportado en sendViaGHL()
// Solo necesita configurar Twilio credentials
```

### 3. Personalización de mensajes
```sql
-- Agregar columna a booking_policies
ALTER TABLE booking_policies 
ADD COLUMN reminder_message_template TEXT;
```

---

## ✅ Checklist de Deployment

- [x] Migración SQL aplicada (`20260117000000_add_internal_reminders.sql`)
- [x] Edge Function creada (`send-internal-booking-reminders/index.ts`)
- [x] Config.toml actualizado (cron job agregado)
- [x] Variables de entorno configuradas (SENDGRID_API_KEY o GHL_API_KEY)
- [ ] Deploy de edge function: `npx supabase functions deploy send-internal-booking-reminders`
- [ ] Test manual (invocar función, verificar email)
- [ ] Monitorear logs por 7 días
- [ ] Verificar primer reminder automático (próximo 8 AM)

---

## 📞 Soporte

**Si algo no funciona**:
1. Revisar logs en Supabase Dashboard
2. Ejecutar queries de troubleshooting de este doc
3. Verificar variables de entorno
4. Invocar función manualmente para debugging
5. Revisar availability_block_reminders table

**Logs importantes**:
- `[POLICY_SKIP]` = Reminder no enviado por policy (correcto)
- `[SKIP] Already sent` = Idempotencia funcionando (correcto)
- `[SUCCESS] ✅` = Reminder enviado exitosamente
- `[ERROR]` = Fallo al enviar (investigar)

---

**Fecha de implementación**: 2026-01-17  
**Implementado por**: Cursor AI Assistant  
**Estado**: ✅ Listo para deployment
