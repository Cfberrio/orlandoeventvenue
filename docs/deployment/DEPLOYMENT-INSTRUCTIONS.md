# Instrucciones de Deployment - Voice Agent con DB + Webhook

## ✅ CÓDIGO COMPLETADO Y PUSHEADO

Todos los cambios han sido implementados y están en GitHub branch main.

---

## 📋 DEPLOYMENT EN 3 PASOS

### PASO 1: Aplicar Migration en Database

**Opción A - Dashboard (Más Fácil)**:
1. Ir a: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/sql-editor
2. Click "New Query"
3. Copiar y ejecutar:

```sql
-- Add source column to track booking origin
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'website';

-- Add index for queries filtering by date and status
CREATE INDEX IF NOT EXISTS idx_bookings_event_date_status 
ON bookings(event_date, status);

-- Add comment explaining the column
COMMENT ON COLUMN bookings.source IS 
'Origin of booking: website (from OEV website), google_calendar (synced from Google Calendar via GHL), ghl_manual (created manually in GHL), external (other sources)';
```

4. Click "Run" → Deberías ver "Success. No rows returned"

**Opción B - Lovable**:
```
Apply migration file: supabase/migrations/20260111000001_add_source_column.sql
```

---

### PASO 2: Deploy Edge Functions

**Opción A - Lovable (Recomendado)**:
```
Deploy these Edge Functions to Supabase:
1. ghl-appointment-webhook (new)
2. voice-check-availability (modified)
3. sync-ghl-calendar (modified)
```

**Opción B - Supabase Dashboard**:
1. Ir a: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions
2. Para cada función:
   - Click en la función (o "Create" si es nueva)
   - Deploy desde branch main
   - Verificar que status = "deployed"

---

### PASO 3: Configurar Webhook en GHL

1. **Ir a GHL Dashboard**:
   - Settings → Integrations → Webhooks
   
2. **Crear Nuevo Webhook**:
   - Click "Create Webhook" o "Add Webhook"
   
3. **Configurar**:
   - **Name**: OEV Appointment Sync
   - **URL**: `https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/ghl-appointment-webhook`
   - **Events a seleccionar**:
     - ✅ Appointment Created
     - ✅ Appointment Updated  
     - ✅ Appointment Deleted
   
4. **Secret (Opcional pero Recomendado)**:
   - Si GHL permite configurar secret, genera uno y guárdalo como `GHL_WEBHOOK_SECRET` en Supabase Secrets
   - Si no, el webhook funcionará sin secret pero sin validación

5. **Activar y Guardar**

---

## 🧪 TESTING (5 Tests)

### Test 1: Website Booking (Ya Funciona)

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-ghl-calendar" \
  -H "Content-Type: application/json" \
  -d '{"booking_id":"e34ed79e-54e8-4e61-9c94-bc7cf1c7ddd6"}'
```

**Verificar**:
- Respuesta: `ok: true`
- DB: Booking tiene `source='website'`

---

### Test 2: Voice Agent - Detecta Website Booking

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
  -H "x-voice-agent-secret: $VOICE_AGENT_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"booking_type":"daily","date":"2026-01-31"}'
```

**Resultado Esperado**:
```json
{
  "ok": true,
  "available": false,
  "assistant_instruction": "That date is NOT available. A booking already exists.",
  "conflicts": [
    {
      "type": "booking",
      "title": "Jeannine Shaller - Celebration",
      "source": "website"
    }
  ]
}
```

---

### Test 3: Voice Agent - Fecha Libre

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
  -H "x-voice-agent-secret: $VOICE_AGENT_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"booking_type":"daily","date":"2026-06-15"}'
```

**Resultado Esperado**:
```json
{
  "ok": true,
  "available": true,
  "assistant_instruction": "Great news! That date IS available."
}
```

---

### Test 4: Simular Webhook de GHL

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/ghl-appointment-webhook" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "AppointmentCreate",
    "appointment": {
      "id": "test_12345",
      "calendarId": "tCUlP3Dalpf0fnhAPG52",
      "startTime": "2026-02-20T14:00:00.000Z",
      "endTime": "2026-02-20T18:00:00.000Z",
      "title": "Test Google Calendar Event",
      "status": "confirmed",
      "contact": {
        "name": "Test User",
        "email": "test@example.com",
        "phone": "+14075551234"
      }
    }
  }'
```

**Verificar**:
- Respuesta: `ok: true, event_type: "AppointmentCreate"`
- DB: Nuevo booking con `source='google_calendar'`

---

### Test 5: Voice Agent - Detecta Appointment de Google

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
  -H "x-voice-agent-secret: $VOICE_AGENT_WEBHOOK_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"booking_type":"hourly","date":"2026-02-20","start_time":"15:00","end_time":"17:00"}'
```

**Resultado Esperado**:
```json
{
  "ok": true,
  "available": false,
  "conflicts": [
    {
      "type": "booking",
      "source": "google_calendar"
    }
  ]
}
```

---

## 📊 Verificación en Database

```sql
-- Ver bookings con su source
SELECT 
  id,
  reservation_number,
  full_name,
  event_date,
  source,
  status,
  created_at
FROM bookings 
WHERE event_date >= CURRENT_DATE
ORDER BY event_date DESC
LIMIT 20;

-- Contar por source
SELECT 
  source,
  COUNT(*) as total,
  COUNT(CASE WHEN status != 'cancelled' THEN 1 END) as active
FROM bookings 
GROUP BY source;
```

---

## ✅ Checklist Final

- [ ] Migration aplicada en Supabase
- [ ] `ghl-appointment-webhook` deployada
- [ ] `voice-check-availability` deployada
- [ ] `sync-ghl-calendar` deployada
- [ ] Webhook configurado en GHL Dashboard
- [ ] Test 1: Website booking sincroniza ✅
- [ ] Test 2: Voice agent detecta website booking ✅
- [ ] Test 3: Voice agent retorna fecha libre ✅
- [ ] Test 4: Webhook crea booking desde GHL ✅
- [ ] Test 5: Voice agent detecta Google Calendar appointment ✅

---

## 🎉 RESULTADO FINAL

Una vez completados todos los pasos:

1. ✅ **Website Bookings**: Detectados inmediatamente por voice agent
2. ✅ **Google Calendar Bookings**: Sincronizados vía webhook en tiempo real
3. ✅ **Voice Agent**: Siempre retorna respuesta correcta (available: true/false)
4. ✅ **Sin más "unverified_empty_calendar"**
5. ✅ **Arquitectura simple y mantenible** (DB > GHL API)

---

## 🔍 Troubleshooting

### Error: "db_fetch_error"
**Causa**: No puede conectar con Supabase DB

**Solución**:
- Verificar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` en secrets
- Ver logs de función para error específico

### Webhook no se dispara
**Causa**: Configuración incorrecta en GHL

**Verificar**:
- URL correcta del webhook
- Events seleccionados (AppointmentCreate/Update/Delete)
- Webhook activado en GHL

### Voice agent sigue retornando fecha ocupada libre
**Causa**: Bookings duplicados o mal sincronizados

**Solución**:
- Verificar en DB que no haya bookings duplicados para esa fecha
- Revisar columna `status` (debe ser 'cancelled' para ignorar)

---

Para más detalles, ver el plan completo en: `/Users/cberrio04/.cursor/plans/voice_agent_con_db_+_webhook_7fe830c0.plan.md`
