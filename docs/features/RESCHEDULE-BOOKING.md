# Reschedule Booking Feature

## Descripción

El feature de **Reschedule Booking** permite a los administradores cambiar la fecha y hora de un booking existente de forma segura, con validación automática de conflictos, reprogramación inteligente de jobs/reminders, auditoría completa y sincronización automática con GHL calendar.

## Arquitectura

```
┌─────────────────┐
│  Admin UI       │
│  BookingDetail  │
└────────┬────────┘
         │ POST /reschedule-booking
         ▼
┌─────────────────────────────────┐
│  Edge Function                  │
│  reschedule-booking/index.ts    │
│  - Auth check (admin only)      │
│  - Call RPC                     │
│  - Recreate jobs if needed      │
└────────┬────────────────────────┘
         │ RPC call
         ▼
┌─────────────────────────────────┐
│  PostgreSQL RPC                 │
│  reschedule_booking()           │
│  - Lock booking (FOR UPDATE)    │
│  - Validate conflicts           │
│  - Update booking               │
│  - Smart job rescheduling       │
│  - Audit trail                  │
└────────┬────────────────────────┘
         │ Auto-trigger
         ▼
┌─────────────────────────────────┐
│  Database Trigger               │
│  bookings_sync_ghl_update       │
│  - Calls sync-ghl-calendar      │
│  - Updates GHL appointment      │
└─────────────────────────────────┘
```

## Componentes

### 1. RPC Function (Database)

**Archivo:** `supabase/migrations/20260109150633_reschedule_booking_rpc.sql`

**Función:** `public.reschedule_booking()`

**Parámetros:**
- `p_booking_id` (uuid, required)
- `p_new_date` (date, required)
- `p_new_start_time` (time, optional)
- `p_new_end_time` (time, optional)
- `p_new_booking_type` (text, optional)
- `p_reason` (text, optional)
- `p_actor_id` (uuid, optional)

**Retorna:** `jsonb`

**Lógica:**
1. **Lock:** `SELECT ... FOR UPDATE` para prevenir race conditions
2. **Validación:** Verifica conflictos con bookings existentes
3. **Update:** Actualiza fecha/hora/tipo del booking
4. **Jobs:** Reprograma jobs pendientes (shift simple o recreación compleja)
5. **Audit:** Registra evento en `booking_events`

### 2. Edge Function

**Archivo:** `supabase/functions/reschedule-booking/index.ts`

**Endpoint:** `POST /functions/v1/reschedule-booking`

**Headers:**
- `Authorization: Bearer <admin_token>`
- `Content-Type: application/json`

**Body:**
```json
{
  "booking_id": "uuid",
  "event_date": "YYYY-MM-DD",
  "start_time": "HH:MM:SS",  // opcional, solo para hourly
  "end_time": "HH:MM:SS",    // opcional, solo para hourly
  "booking_type": "hourly|daily",  // opcional, mantiene actual si no se provee
  "reason": "texto"  // opcional
}
```

**Respuestas:**

**Éxito:**
```json
{
  "ok": true,
  "booking_id": "uuid",
  "updated": true,
  "jobs_updated": 3,
  "jobs_cancelled": 0,
  "needs_job_recreation": false,
  "date_shift_days": 5,
  "jobs_recreated": false
}
```

**Conflicto:**
```json
{
  "ok": false,
  "error": "conflict",
  "message": "That time range overlaps with an existing booking",
  "conflict_booking": {
    "id": "uuid",
    "reservation_number": "OEV-2026-001",
    "event_date": "2026-03-15",
    ...
  }
}
```

**Error de validación:**
```json
{
  "ok": false,
  "error": "validation_failed",
  "message": "Hourly bookings require start_time and end_time"
}
```

### 3. Frontend UI

**Archivo:** `src/pages/admin/BookingDetail.tsx`

**Componentes agregados:**
- Botón "Reschedule" en el header (junto al selector de status)
- Dialog modal con:
  - Calendar picker para nueva fecha
  - Selector de booking type (hourly/daily)
  - Inputs de start_time/end_time (solo para hourly)
  - Textarea para reason
  - Botones Cancel y Confirm

**Estado:**
```typescript
const [rescheduleOpen, setRescheduleOpen] = useState(false);
const [rescheduleData, setRescheduleData] = useState({
  date: booking.event_date,
  booking_type: booking.booking_type,
  start_time: booking.start_time || "",
  end_time: booking.end_time || "",
  reason: "",
});
const [rescheduleLoading, setRescheduleLoading] = useState(false);
```

## Validación de Conflictos

### Reglas de Conflicto

#### Para DAILY bookings:
- **Bloquea:** Cualquier booking en la misma fecha
- **Lógica:** `COUNT(*) WHERE event_date = new_date AND status NOT IN ('cancelled', 'declined') AND payment_status IN ('deposit_paid', 'fully_paid', 'invoiced')`

#### Para HOURLY bookings:
1. **Daily block:** Si existe un daily booking en la fecha, bloquea todas las horas
2. **Hourly overlap:** Detecta overlaps usando minutos desde medianoche
   - **Fórmula:** `new_start < existing_end AND new_end > existing_start`
   - Convierte TIME a minutos: `EXTRACT(HOUR)*60 + EXTRACT(MINUTE)`

#### Exclusión de self:
- Siempre excluye el booking que se está editando: `WHERE id != p_booking_id`

### Estados que bloquean:
- `status NOT IN ('cancelled', 'declined')`
- `payment_status IN ('deposit_paid', 'fully_paid', 'invoiced')`

## Reprogramación de Jobs

### Estrategia Smart

#### Simple (solo cambio de fecha):
```sql
-- Si booking_type no cambia
UPDATE scheduled_jobs
SET run_at = run_at + (date_shift_days || ' days')::interval
WHERE booking_id = p_booking_id
  AND status = 'pending'
  AND run_at > now();
```

**Ejemplo:** Booking se mueve de 2026-03-10 a 2026-03-17 (+7 días)
- Job que iba a correr 2026-03-08 → 2026-03-15
- Job que iba a correr 2026-03-09 → 2026-03-16

#### Compleja (cambio de booking_type):
```sql
-- Si booking_type cambia (hourly ↔ daily)
UPDATE scheduled_jobs
SET status = 'cancelled',
    last_error = 'reschedule_recreation_needed'
WHERE booking_id = p_booking_id
  AND status IN ('pending', 'failed')
  AND run_at > now();
```

Luego, la Edge Function llama:
- `schedule-host-report-reminders` con `force_reschedule: true`
- `schedule-balance-payment`

### Jobs afectados:
- `host_report_pre_start`
- `host_report_during`
- `host_report_post`
- `balance_retry_1`, `balance_retry_2`, `balance_retry_3`
- `create_balance_payment_link`

## Auditoría

Cada reschedule crea un evento en `booking_events`:

```json
{
  "booking_id": "uuid",
  "event_type": "booking_rescheduled",
  "channel": "system",
  "metadata": {
    "old_values": {
      "event_date": "2026-03-10",
      "start_time": "14:00:00",
      "end_time": "18:00:00",
      "booking_type": "hourly"
    },
    "new_values": {
      "event_date": "2026-03-17",
      "start_time": "16:00:00",
      "end_time": "20:00:00",
      "booking_type": "hourly"
    },
    "reason": "Client requested different time",
    "actor_id": "admin-user-uuid",
    "date_shift_days": 7,
    "jobs_updated": 3,
    "jobs_cancelled": 0
  },
  "created_at": "2026-01-09T15:30:00Z"
}
```

## Sincronización con GHL

### Automática via Trigger

El trigger existente `bookings_sync_ghl_update` se dispara automáticamente cuando se actualiza:
- `event_date`
- `start_time`
- `end_time`
- `booking_type`

**No requiere acción manual.** El trigger llama `sync-ghl-calendar` via `pg_net.http_post`.

### Anti-Loop

El trigger **NO** escucha cambios en columnas `ghl_*` para prevenir loops infinitos.

## Testing

### Unit Tests

**Archivo:** `supabase/functions/_tests/reschedule-booking.test.ts`

**Tests implementados:**
1. ✅ Hourly overlap conflict detection
2. ✅ Hourly vs Daily conflict
3. ✅ Daily vs Hourly conflict
4. ✅ Job rescheduling (date shift)
5. ✅ Audit log structure
6. ✅ Complex reschedule (type change)
7. ✅ Past date validation
8. ✅ Self-exclusion from conflicts

**Ejecutar tests:**
```bash
cd supabase/functions/_tests
node reschedule-booking.test.ts
```

**Resultado esperado:** `Overall: ALL PASS ✅`

### Manual Testing

#### Test 1: Reschedule exitoso
```bash
curl -X POST \
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/reschedule-booking' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "booking_id": "YOUR_BOOKING_ID",
    "event_date": "2026-03-15",
    "start_time": "14:00:00",
    "end_time": "18:00:00",
    "booking_type": "hourly",
    "reason": "Client requested different date"
  }'
```

**Esperado:** `{"ok": true, "updated": true, ...}`

#### Test 2: Conflicto detectado
```bash
# Primero, identifica un booking existente en una fecha
# Luego intenta reschedular otro booking a la misma fecha/hora
```

**Esperado:** `{"ok": false, "error": "conflict", "conflict_booking": {...}}`

#### Test 3: Cambio de tipo (hourly → daily)
```bash
curl -X POST \
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/reschedule-booking' \
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{
    "booking_id": "YOUR_BOOKING_ID",
    "event_date": "2026-03-25",
    "booking_type": "daily",
    "reason": "Client wants full day"
  }'
```

**Esperado:** `{"ok": true, "needs_job_recreation": true, "jobs_recreated": true, ...}`

### Verificación End-to-End

1. **Reschedule un booking desde UI:**
   - Ir a `/admin/bookings/:id`
   - Click "Reschedule"
   - Seleccionar nueva fecha
   - Confirmar

2. **Verificar en DB:**
   ```sql
   -- Booking actualizado
   SELECT event_date, start_time, end_time, booking_type, updated_at
   FROM bookings
   WHERE id = 'YOUR_BOOKING_ID';
   
   -- Jobs reprogramados
   SELECT job_type, run_at, status
   FROM scheduled_jobs
   WHERE booking_id = 'YOUR_BOOKING_ID'
   ORDER BY run_at;
   
   -- Audit event
   SELECT event_type, metadata
   FROM booking_events
   WHERE booking_id = 'YOUR_BOOKING_ID'
     AND event_type = 'booking_rescheduled'
   ORDER BY created_at DESC
   LIMIT 1;
   ```

3. **Verificar GHL sync:**
   - Check logs de `sync-ghl-calendar`
   - Verificar que appointment en GHL tiene nueva fecha/hora

## Troubleshooting

### Error: "conflict" pero no hay booking visible

**Causa:** Booking con `status='confirmed'` pero `payment_status='pending'`

**Solución:** Solo bookings con `payment_status IN ('deposit_paid', 'fully_paid', 'invoiced')` bloquean.

### Error: "validation_failed: Hourly bookings require start_time and end_time"

**Causa:** Intentando cambiar a hourly sin proveer times

**Solución:** Incluir `start_time` y `end_time` en el request

### Jobs no se reprograman

**Causa:** Jobs ya ejecutados o con `status='completed'`

**Solución:** Solo jobs con `status='pending'` y `run_at > now()` se reprograman

### GHL appointment no se actualiza

**Causa:** Trigger no se disparó o error en `sync-ghl-calendar`

**Verificación:**
```sql
-- Check trigger logs
SELECT * FROM net._http_response
ORDER BY created DESC
LIMIT 10;
```

**Solución:** Llamar manualmente:
```bash
curl -X POST \
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-ghl-calendar' \
  -H 'Authorization: Bearer SERVICE_ROLE_KEY' \
  -H 'Content-Type: application/json' \
  -d '{"booking_id": "YOUR_BOOKING_ID"}'
```

### Race condition (2 admins editando simultáneamente)

**Protección:** `SELECT ... FOR UPDATE` lock

**Comportamiento:** El segundo admin esperará hasta que el primero termine, luego ejecutará su reschedule (puede fallar por conflicto si el primero ya ocupó la fecha)

## Consideraciones de Seguridad

1. **Admin only:** Edge Function valida rol de admin antes de ejecutar
2. **Lock transaccional:** Previene race conditions
3. **No expone secretos:** Audit log no incluye tokens ni secrets
4. **Validación de entrada:** RPC valida todos los parámetros
5. **Audit trail completo:** Cada cambio queda registrado con actor_id

## Limitaciones

1. **No permite reschedular a fecha pasada:** Validación en frontend (disabled dates) y lógica de negocio
2. **No permite reschedular bookings cancelled/completed:** Validación en frontend (disabled button)
3. **No maneja timezone changes:** Asume America/New_York (Orlando)
4. **Jobs históricos no se modifican:** Solo jobs futuros (`run_at > now()`)

## Roadmap Futuro

- [ ] Notificación automática al cliente cuando se reschedula
- [ ] Sugerencia de fechas alternativas cuando hay conflicto
- [ ] Bulk reschedule (múltiples bookings a la vez)
- [ ] Undo reschedule (revertir a fecha anterior)
- [ ] Reschedule history timeline en UI

## Soporte

Para issues o preguntas:
1. Check logs en Supabase Dashboard → Edge Functions
2. Ejecutar tests: `node _tests/reschedule-booking.test.ts`
3. Verificar audit trail en `booking_events`
4. Check trigger logs en `net._http_response`

---

**Última actualización:** 2026-01-09  
**Versión:** 1.0.0  
**Autor:** Orlando Event Venue Team
