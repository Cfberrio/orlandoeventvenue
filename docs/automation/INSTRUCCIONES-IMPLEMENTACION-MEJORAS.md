# Instrucciones de Implementación - Sistema de Automatización Completo

## 📦 Archivos Creados

Se han creado los siguientes archivos:

### Migraciones SQL (4 archivos):
1. `supabase/migrations/20260126222111_auto_trigger_booking_automation.sql`
2. `supabase/migrations/20260126222112_health_check_functions.sql`
3. `supabase/migrations/20260126222113_auto_fix_missing_jobs_cron.sql`
4. `supabase/migrations/20260126222114_daily_health_check_cron.sql`

### Edge Function (1 carpeta):
5. `supabase/functions/daily-health-check/index.ts`

---

## ✨ CONFIGURACIÓN PARA LOVABLE CLOUD

**Este proyecto está configurado para Lovable Cloud - NO necesitas configurar SERVICE_ROLE_KEY manualmente.**

Lovable Cloud maneja automáticamente:
- ✅ Autenticación de Edge Functions (todas tienen `verify_jwt = false`)
- ✅ Deployment de funciones al hacer push
- ✅ Ejecución de migraciones SQL
- ✅ Configuración de cron jobs

**Las migraciones SQL ya están adaptadas para funcionar sin SERVICE_ROLE_KEY hardcodeado.**

---

## 🔧 PASO ÚNICO: Push a GitHub

Todo lo que necesitas hacer:

```bash
cd /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue

# Lovable desplegará automáticamente Edge Functions y ejecutará migraciones
git push origin main
```

**Eso es todo.** Lovable Cloud detectará los cambios y:
1. ✅ Desplegará la Edge Function `daily-health-check`
2. ✅ Ejecutará las 4 migraciones SQL automáticamente
3. ✅ Configurará el cron job para health check diario
4. ✅ Activará el trigger automático en la base de datos

---

## 🔍 Qué Pasa Después del Push

Lovable Cloud automáticamente:

1. **Detecta los cambios** en `supabase/migrations/` y `supabase/functions/`
2. **Despliega `daily-health-check`** con la configuración en `config.toml`
3. **Ejecuta las migraciones** en orden cronológico
4. **Configura el cron job** para ejecutarse diariamente a las 8 AM EST

**No necesitas hacer nada más.**

---

## ✅ PASO 5: Verificar que Todo Funciona

### 5.1. Verificar el Trigger Automático

Ejecuta este SQL para probar el trigger:

```sql
-- 1. Ver un booking actual
SELECT id, reservation_number, lifecycle_status 
FROM bookings 
WHERE status != 'cancelled' 
LIMIT 1;

-- 2. Simular cambio a pre_event_ready (CUIDADO: solo para test)
-- (NO ejecutes esto en producción con bookings reales)
-- UPDATE bookings 
-- SET lifecycle_status = 'pending' 
-- WHERE id = 'TU_BOOKING_ID';

-- UPDATE bookings 
-- SET lifecycle_status = 'pre_event_ready' 
-- WHERE id = 'TU_BOOKING_ID';

-- 3. Verificar que se crearon los jobs automáticamente
SELECT * FROM scheduled_jobs 
WHERE booking_id = 'TU_BOOKING_ID' 
ORDER BY created_at DESC;

-- 4. Verificar en los logs de pg_net
SELECT * FROM net._http_response 
WHERE request->>'url' LIKE '%trigger-booking-automation%'
ORDER BY created_at DESC 
LIMIT 5;
```

### 5.2. Verificar el Cron Job de Auto-Reparación

```sql
-- Ver que el cron job está activo
SELECT 
  jobname,
  schedule,
  active,
  jobid
FROM cron.job
WHERE jobname = 'auto-fix-missing-jobs-hourly';

-- Debería mostrar:
-- jobname: auto-fix-missing-jobs-hourly
-- schedule: 15 * * * *
-- active: true
```

### 5.3. Verificar el Cron Job de Health Check

```sql
-- Ver que el cron job está activo
SELECT 
  jobname,
  schedule,
  active,
  jobid
FROM cron.job
WHERE jobname = 'daily-health-check-8am-est';

-- Debería mostrar:
-- jobname: daily-health-check-8am-est
-- schedule: 0 13 * * *
-- active: true
```

### 5.4. Probar el Health Check Manualmente

Desde Supabase Dashboard → Edge Functions → daily-health-check → **Invoke**

O desde terminal:
```bash
curl -X POST https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/daily-health-check \
  -H "Authorization: Bearer TU_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Deberías recibir:
- Si todo está bien: `{"ok": true, "alert_sent": false, "message": "Sistema funcionando correctamente"}`
- Si hay problemas: `{"ok": true, "alert_sent": true, "issues_count": N}` + email a orlandoglobalministries@gmail.com

---

## 🔍 PASO 6: Monitorear los Logs

### Ver logs del trigger automático:

```sql
-- Ver últimas ejecuciones del trigger
SELECT 
  created_at,
  request->>'url' as url,
  response->>'status' as status,
  response->>'body' as response_body
FROM net._http_response
WHERE request->>'url' LIKE '%trigger-booking-automation%'
ORDER BY created_at DESC
LIMIT 10;
```

### Ver logs del cron de auto-reparación:

```sql
-- Verificar que se está ejecutando
SELECT 
  jobid,
  jobname,
  last_run,
  next_run
FROM cron.job_run_details
WHERE jobname = 'auto-fix-missing-jobs-hourly'
ORDER BY run_start DESC
LIMIT 5;
```

### Ver logs de Edge Functions (Supabase Dashboard):

1. Ve a **Edge Functions** → **Logs**
2. Filtra por función: `daily-health-check`
3. Busca mensajes como:
   - `[SUCCESS] No issues found, system is healthy`
   - `[ALERT] Found N issues, sending email alert...`

---

## 🛡️ Seguridad y Rollback

### Si algo falla, puedes revertir fácilmente:

```sql
-- Desactivar el trigger
DROP TRIGGER IF EXISTS bookings_auto_trigger_automation ON public.bookings;
DROP FUNCTION IF EXISTS public.auto_trigger_booking_automation();

-- Desactivar el cron de auto-reparación
SELECT cron.unschedule('auto-fix-missing-jobs-hourly');

-- Desactivar el cron de health check
SELECT cron.unschedule('daily-health-check-8am-est');

-- Eliminar funciones de health check
DROP FUNCTION IF EXISTS public.count_bookings_without_balance_jobs();
DROP FUNCTION IF EXISTS public.count_bookings_without_host_jobs();
```

### Para reactivar después de corregir:

Simplemente vuelve a ejecutar las migraciones en orden.

---

## 📊 Qué Esperar Después de Implementar

### Comportamiento Normal:

1. **Cuando creas un booking y lo marcas como Pre-Event Ready:**
   - ✅ El trigger automático ejecuta `trigger-booking-automation`
   - ✅ Se crean balance payment jobs (2 o 3 según sea short/long notice)
   - ✅ Se crean host report jobs (3: pre_start, during, post)
   - ✅ Todo sin necesidad de hacer clic en nada adicional

2. **Cada hora (a los :15 minutos):**
   - 🔧 El sistema verifica si hay bookings sin jobs
   - 🔧 Si encuentra alguno, lo repara automáticamente
   - 🔧 Logs visibles en `net._http_response`

3. **Cada día a las 8:00 AM EST:**
   - 🏥 El sistema revisa la salud general
   - 📧 Solo si hay problemas, envía email a orlandoglobalministries@gmail.com
   - ✅ Si todo está bien, no molesta

### Email que recibirás (solo si hay problemas):

```
Asunto: 🚨 CRÍTICO: Sistema OEV tiene 2 problema(s) crítico(s)

Contenido:
- Lista de problemas con iconos de severidad
- Conteo de cada problema
- Descripción clara de cada issue
- Acciones recomendadas
- Enlaces rápidos a Supabase Dashboard
```

---

## 🎯 Checklist Final

- [ ] SERVICE_ROLE_KEY reemplazado en los 3 archivos
- [ ] Migraciones ejecutadas (4 migraciones)
- [ ] Edge Function desplegada (`daily-health-check`)
- [ ] Trigger verificado (cambiar booking a pre_event_ready y ver jobs)
- [ ] Cron jobs verificados (query `SELECT * FROM cron.job`)
- [ ] Health check probado manualmente
- [ ] Email recibido correctamente en orlandoglobalministries@gmail.com

---

## 📞 Solución de Problemas

### Problema: El trigger no se ejecuta

**Causa**: SERVICE_ROLE_KEY incorrecto o trigger no creado

**Solución**:
```sql
-- Verificar que el trigger existe
SELECT * FROM pg_trigger WHERE tgname = 'bookings_auto_trigger_automation';

-- Ver logs de pg_net
SELECT * FROM net._http_response 
WHERE request->>'url' LIKE '%trigger-booking-automation%'
ORDER BY created_at DESC;
```

### Problema: No recibo emails

**Causa**: Gmail credentials no configurados o incorrectos

**Solución**:
1. Verifica variables de entorno: `GMAIL_USER` y `GMAIL_APP_PASSWORD`
2. Prueba manualmente el health check
3. Revisa logs de Edge Functions

### Problema: Cron jobs no se ejecutan

**Causa**: pg_cron extension no habilitada o cron inactivo

**Solución**:
```sql
-- Verificar que pg_cron está habilitado
SELECT * FROM pg_extension WHERE extname = 'pg_cron';

-- Verificar que los crons están activos
SELECT jobname, active FROM cron.job;

-- Si están inactivos, activarlos:
SELECT cron.alter_job(jobid, is_active := true) 
FROM cron.job 
WHERE jobname IN ('auto-fix-missing-jobs-hourly', 'daily-health-check-8am-est');
```

---

## 🎉 Resultado Final

Después de implementar todo:

- ✅ **100% Automático**: Los jobs se crean sin intervención manual
- ✅ **Auto-Reparación**: Problemas se corrigen solos en máximo 1 hora
- ✅ **Monitoreo Proactivo**: Email diario solo si hay problemas
- ✅ **Cero Mantenimiento**: El sistema se mantiene solo
- ✅ **Alertas Inteligentes**: Solo recibes emails cuando realmente hay algo que atender

**Ya no necesitas revisar manualmente - el sistema te avisará si algo falla.**
