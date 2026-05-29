# 🚀 Deployment Completo desde Terminal Mac

## PASO 1: Instalar Supabase CLI (si no lo tienes)

```bash
brew install supabase/tap/supabase
```

Verificar instalación:
```bash
supabase --version
```

---

## PASO 2: Login a Supabase

```bash
cd /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue
supabase login
```

Esto abrirá tu navegador para autenticarte. Sigue las instrucciones.

---

## PASO 3: Link con tu Proyecto Supabase

```bash
supabase link --project-ref vsvsgesgqjtwutadcshi
```

Te pedirá tu database password. Usa la password de tu proyecto Supabase.

---

## PASO 4: Aplicar Migration

```bash
# Esto aplica la migration directamente a la database
supabase db push
```

**Alternativa** (si `db push` no funciona):

```bash
# Ejecutar migration manualmente
supabase db execute --file supabase/migrations/20260111000000_add_ghl_blocked_slot_id.sql
```

**Verificar que se aplicó**:
```bash
supabase db diff
```

Debería decir "No schema changes detected" si todo está sincronizado.

---

## PASO 5: Deploy Edge Functions

```bash
# Deploy las 3 funciones de una vez
supabase functions deploy sync-ghl-calendar
supabase functions deploy sync-blocked-slots-cron
supabase functions deploy backfill-blocked-slots
```

**Verificar deployment**:
```bash
supabase functions list
```

Deberías ver las 3 funciones listadas con status "deployed".

---

## PASO 6: Configurar Secrets (si es necesario)

Verifica que tengas estos secrets configurados:

```bash
supabase secrets list
```

Si falta alguno, agrégalo:

```bash
# Ejemplo (no ejecutar si ya existen)
supabase secrets set GHL_PRIVATE_INTEGRATION_TOKEN="tu_token_aqui"
supabase secrets set GHL_LOCATION_ID="fSCCE6NpjF7cR5GgzIA0"
supabase secrets set GHL_CALENDAR_ID="tCUlP3Dalpf0fnhAPG52"
supabase secrets set GHL_ASSIGNED_USER_ID="l4KMIjO3xQZcKxlJNsc8"
```

---

## PASO 7: Configurar Cron Job

⚠️ **Este paso SÍ requiere el Dashboard** (Supabase CLI no soporta cron jobs aún):

1. Ir a: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions
2. Click en "Cron Jobs" tab
3. Click en "Create a new cron job"
4. **Function**: `sync-blocked-slots-cron`
5. **Schedule**: `0 * * * *` (cada hora)
6. Click en "Create"

**ALTERNATIVA (programática)** - agregar a `supabase/config.toml`:

Esto ya está hecho en el código, pero si el Dashboard no lo reconoce automáticamente, configúralo manualmente.

---

## PASO 8: Ejecutar Backfill

```bash
# Necesitas el SUPABASE_SERVICE_ROLE_KEY de tu proyecto
# Lo encuentras en: https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/settings/api

curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/backfill-blocked-slots" \
  -H "Authorization: Bearer TU_SERVICE_ROLE_KEY_AQUI" \
  -H "Content-Type: application/json"
```

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

## PASO 9: Testing

### Test 1: Sync Manual de Booking Existente

```bash
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/sync-ghl-calendar" \
  -H "Content-Type: application/json" \
  -d '{"booking_id":"e34ed79e-54e8-4e61-9c94-bc7cf1c7ddd6"}'
```

Verifica en los logs que dice:
- `[BLOCKED_SLOT] Creating: ...`
- `[BLOCKED_SLOT] Created: <ID>`
- `[APPOINTMENT] Created with blocked slot: ...`

### Test 2: Voice Agent Detecta Conflicto

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
  "conflicts": [...]
}
```

### Test 3: Ver Logs de Funciones

```bash
# Ver logs de sync-ghl-calendar
supabase functions logs sync-ghl-calendar

# Ver logs de cron job
supabase functions logs sync-blocked-slots-cron

# Ver logs de voice-check-availability
supabase functions logs voice-check-availability
```

---

## 🎯 Resumen de Comandos (Todo de una vez)

```bash
# 1. Instalar CLI (si es necesario)
brew install supabase/tap/supabase

# 2. Login y link
cd /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue
supabase login
supabase link --project-ref vsvsgesgqjtwutadcshi

# 3. Aplicar migration
supabase db push

# 4. Deploy funciones
supabase functions deploy sync-ghl-calendar
supabase functions deploy sync-blocked-slots-cron
supabase functions deploy backfill-blocked-slots

# 5. Verificar
supabase functions list
supabase secrets list

# 6. Ejecutar backfill (reemplazar SERVICE_ROLE_KEY)
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/backfill-blocked-slots" \
  -H "Authorization: Bearer TU_SERVICE_ROLE_KEY_AQUI" \
  -H "Content-Type: application/json"

# 7. Test voice agent
curl -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
  -H "x-voice-agent-secret: oev_live_9fK3Qw7N2mX8VtR1pL6cH0sY4aJ5uE7gD3zB8nC1rT6vP2kM9xW5qS0hL7yU4cA2dF8jG1eH6iK3oP9rN5tV7wX0zY2" \
  -H "Content-Type: application/json" \
  -d '{"booking_type":"daily","date":"2026-01-31"}'
```

---

## ⚠️ Único Paso Manual Requerido

**Solo el Cron Job** necesita configurarse en el Dashboard:
- https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/functions
- Tab "Cron Jobs"
- Crear: `sync-blocked-slots-cron` cada hora (`0 * * * *`)

Todo lo demás se hace desde la terminal ✅

---

## 🔍 Troubleshooting

### Error: "supabase: command not found"
```bash
brew install supabase/tap/supabase
```

### Error: "Project not linked"
```bash
supabase link --project-ref vsvsgesgqjtwutadcshi
```

### Error: "Migration already applied"
Está bien, significa que la migration ya existe. Continúa con el siguiente paso.

### Error: "Function deployment failed"
Verifica que estés en el directorio correcto:
```bash
pwd
# Debería mostrar: /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue
```

### Ver logs en tiempo real
```bash
# Mientras ejecutas tests
supabase functions logs sync-ghl-calendar --follow
```

---

## ✅ Checklist

- [ ] Supabase CLI instalado (`brew install`)
- [ ] Login a Supabase (`supabase login`)
- [ ] Proyecto linked (`supabase link`)
- [ ] Migration aplicada (`supabase db push`)
- [ ] 3 funciones deployadas (`supabase functions deploy`)
- [ ] Cron job configurado (Dashboard manual)
- [ ] Backfill ejecutado (`curl` con service role key)
- [ ] Tests pasados (`curl` a voice-check-availability)
- [ ] Logs verificados (`supabase functions logs`)

🎉 **Listo! Tu voice-check-availability ahora detectará conflictos correctamente.**
