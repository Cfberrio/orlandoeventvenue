# 🚀 Deployment Guide: Blocked Slots Implementation

## ✅ Código Completado y Pusheado

Todos los cambios han sido implementados y pusheados a GitHub. Ahora necesitas deployar manualmente en Supabase.

---

## 📋 PASOS DE DEPLOYMENT (EN ORDEN)

### PASO 1: Aplicar Migration en Database

1. **Ir a Supabase Dashboard**:
   - URL: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi
   - Click en "SQL Editor" (menú lateral izquierdo)

2. **Crear Nueva Query**:
   - Click en "New Query"

3. **Copiar y Ejecutar SQL**:
   ```sql
   -- Add column to track GHL blocked slot ID
   -- This allows voice-check-availability to query blocked slots for availability checking
   -- since GHL appointments are not queryable by date range via API

   ALTER TABLE bookings 
   ADD COLUMN IF NOT EXISTS ghl_blocked_slot_id TEXT;

   -- Add index for lookups
   CREATE INDEX IF NOT EXISTS idx_bookings_ghl_blocked_slot_id 
   ON bookings(ghl_blocked_slot_id);

   -- Add comment
   COMMENT ON COLUMN bookings.ghl_blocked_slot_id IS 
   'GHL blocked slot ID created for this booking to block calendar availability. Used by voice-check-availability to detect conflicts.';
   ```

4. **Ejecutar**:
   - Click en "Run" (o presiona Cmd + Enter)
   - Deberías ver: "Success. No rows returned"

5. **Verificar**:
   ```sql
   SELECT column_name, data_type, is_nullable 
   FROM information_schema.columns 
   WHERE table_name = 'bookings' 
   AND column_name = 'ghl_blocked_slot_id';
   ```
   - Debería retornar 1 fila con la columna

---

### PASO 2: Deploy Edge Functions Modificadas

Tienes 2 opciones:

#### OPCIÓN A: Via Supabase Dashboard (Más Fácil)

1. **Ir a Edge Functions**:
   - https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions
   
2. **Deploy sync-ghl-calendar** (modificada):
   - Click en "sync-ghl-calendar"
   - Click en "Deploy new version"
   - Selecciona el branch "main"
   - Click en "Deploy"
   - Espera confirmación

3. **Deploy sync-blocked-slots-cron** (nueva):
   - Click en "Create a new function"
   - Name: `sync-blocked-slots-cron`
   - Selecciona el código del branch "main"
   - Click en "Deploy"

4. **Deploy backfill-blocked-slots** (nueva):
   - Click en "Create a new function"
   - Name: `backfill-blocked-slots`
   - Selecciona el código del branch "main"
   - Click en "Deploy"

#### OPCIÓN B: Via Supabase CLI (Más Rápido)

```bash
cd /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue

# Deploy todas las funciones de una vez
supabase functions deploy sync-ghl-calendar
supabase functions deploy sync-blocked-slots-cron
supabase functions deploy backfill-blocked-slots
```

---

### PASO 3: Configurar Cron Job

1. **Ir a Cron Jobs**:
   - https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions
   - Click en "Cron Jobs" tab

2. **Crear Nuevo Cron Job**:
   - Click en "Create a new cron job"
   - **Function**: `sync-blocked-slots-cron`
   - **Schedule**: `0 * * * *` (cada hora)
   - **Description**: "Sync blocked slots from Google Calendar appointments"
   - Click en "Create"

3. **Verificar**:
   - Deberías ver el cron job listado
   - Status: "Active"

---

### PASO 4: Ejecutar Backfill (UNA SOLA VEZ)

Este paso crea blocked slots para TODOS los appointments existentes:

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/backfill-blocked-slots" \
  -H "Authorization: Bearer <ADMIN_SECRET>" \
  -H "Content-Type: application/json"
```

**Nota**: Necesitas configurar `ADMIN_SECRET` en Supabase Secrets primero, o usar el `SUPABASE_SERVICE_ROLE_KEY`.

**Respuesta esperada**:
```json
{
  "ok": true,
  "created": 5,
  "skipped": 2,
  "errors": 0,
  "total": 7
}
```

---

### PASO 5: Verificar que Todo Funciona

#### Test 1: Crear Booking de Website

```bash
# 1. Crear booking en website (o usar uno existente)
# 2. Verificar que se creó blocked slot
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-ghl-calendar" \
  -H "Content-Type: application/json" \
  -d '{"booking_id":"<BOOKING_ID>"}'
```

**Respuesta esperada**:
```json
{
  "ok": true,
  "booking_id": "...",
  "appointment_id": "fgWVe1tFEu6RMMWMbXKX",
  "event_type": "ghl_appointment_created",
  "calendar_id": "tCUlP3Dalpf0fnhAPG52",
  "staff_synced": 1
}
```

**Verificar en logs**:
- Buscar: `[BLOCKED_SLOT] Created: <ID>`
- Buscar: `[APPOINTMENT] Created with blocked slot: <appointment_id> -> <blocked_slot_id>`

#### Test 2: Voice Agent Detecta Conflicto

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
  -H "x-voice-agent-secret: oev_live_9fK3Qw7N2mX8VtR1pL6cH0sY4aJ5uE7gD3zB8nC1rT6vP2kM9xW5qS0hL7yU4cA2dF8jG1eH6iK3oP9rN5tV7wX0zY2" \
  -H "Content-Type: application/json" \
  -d '{"booking_type":"daily","date":"2026-01-31"}'
```

**Respuesta esperada** (si hay booking ese día):
```json
{
  "ok": true,
  "available": false,
  "assistant_instruction": "That date is NOT available. A booking already exists.",
  "conflicts": [
    {
      "type": "blocked_slot",
      "title": "Jeannine Shaller - Celebration",
      "start": "2026-01-31T05:00:00.000Z",
      "end": "2026-01-31T21:30:00.000Z"
    }
  ]
}
```

#### Test 3: Cancelar Booking

```bash
# 1. Cancelar booking en website
# 2. Verificar que blocked slot se eliminó
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-ghl-calendar" \
  -H "Content-Type: application/json" \
  -d '{"booking_id":"<BOOKING_ID>"}'
```

**Verificar en logs**:
- Buscar: `[BLOCKED_SLOT] Deleting: <ID>`
- Buscar: `[APPOINTMENT] Deleted blocked slot for cancelled appointment`

#### Test 4: Cron Job (Esperar 1 hora)

Después de 1 hora, verificar logs del cron job:

1. Ir a: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions/sync-blocked-slots-cron/logs
2. Buscar última ejecución
3. Verificar: `[CRON] Completed: X created, Y skipped`

---

## 🔍 Troubleshooting

### Error: "ghl_scope_blocked_slots_write_denied"

**Causa**: El token GHL no tiene permisos para crear blocked slots.

**Solución**:
1. Ir a GHL → Settings → Integrations → Private Integration
2. Verificar que tenga scope: `calendars.write` o `calendars/blocked-slots.write`
3. Si no, agregar scope y regenerar token
4. Actualizar `GHL_PRIVATE_INTEGRATION_TOKEN` en Supabase Secrets

### Error: "Cannot GET /calendars/.../blocked-slots"

**Causa**: Endpoint no disponible con ese token.

**Solución**:
- Usar `GHL_PRIVATE_INTEGRATION_TOKEN` (no `GHL_READONLY_TOKEN`)
- Verificar que el token tenga permisos de escritura

### Blocked Slots No Se Crean

**Debug**:
```bash
# Ver logs de sync-ghl-calendar
https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions/sync-ghl-calendar/logs

# Buscar:
# - [BLOCKED_SLOT] Creating: ...
# - [BLOCKED_SLOT] Created: ...
# - [BLOCKED_SLOT] Create failed: ...
```

### Voice Agent Sigue Retornando "unverified_empty_calendar"

**Causa**: Blocked slots no existen aún.

**Solución**:
1. Ejecutar backfill (Paso 4)
2. Esperar 1 hora para que cron job ejecute
3. Verificar en GHL Calendar que existan blocked slots

---

## 📊 Monitoring

### Logs Importantes

1. **sync-ghl-calendar**:
   - `[BLOCKED_SLOT] Creating: ...`
   - `[BLOCKED_SLOT] Created: <ID>`
   - `[APPOINTMENT] Created with blocked slot: ...`

2. **sync-blocked-slots-cron**:
   - `[CRON] Found X events from GHL`
   - `[CRON] Created blocked slot X for appointment Y`
   - `[CRON] Completed: X created, Y skipped`

3. **voice-check-availability**:
   - `[GHL_BLOCKED] Fetched X blocked slots`
   - `[OVERLAP] Found conflict: ...`

### Queries Útiles

```sql
-- Ver bookings con blocked slots
SELECT 
  id, 
  reservation_number, 
  full_name, 
  ghl_appointment_id, 
  ghl_blocked_slot_id,
  status
FROM bookings 
WHERE ghl_blocked_slot_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 20;

-- Ver bookings sin blocked slot (pero con appointment)
SELECT 
  id, 
  reservation_number, 
  full_name, 
  ghl_appointment_id, 
  status
FROM bookings 
WHERE ghl_appointment_id IS NOT NULL 
  AND ghl_blocked_slot_id IS NULL
  AND status != 'cancelled'
ORDER BY created_at DESC;
```

---

## ✅ Checklist Final

- [ ] Migration aplicada en database
- [ ] `sync-ghl-calendar` deployada
- [ ] `sync-blocked-slots-cron` deployada
- [ ] `backfill-blocked-slots` deployada
- [ ] Cron job configurado (cada hora)
- [ ] Backfill ejecutado una vez
- [ ] Test 1: Website booking crea blocked slot
- [ ] Test 2: Voice agent detecta conflicto
- [ ] Test 3: Cancelación elimina blocked slot
- [ ] Test 4: Cron job ejecuta correctamente
- [ ] Logs monitoreados durante primera hora

---

## 🎉 Resultado Final

Una vez completados todos los pasos:

1. **Website Bookings**: Crean appointment + blocked slot automáticamente
2. **Google Calendar Bookings**: Cron job crea blocked slot cada hora
3. **Voice Agent**: Detecta conflictos consultando blocked slots
4. **Cancelaciones**: Eliminan blocked slot automáticamente
5. **Reschedules**: Actualizan blocked slot automáticamente

**NO MÁS "unverified_empty_calendar"** ✅
