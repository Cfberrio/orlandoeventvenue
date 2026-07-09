# Cómo Obtener y Configurar el SERVICE_ROLE_KEY

## ⚠️ NOTA PARA LOVABLE CLOUD

**Si usas Lovable Cloud: NO NECESITAS este archivo.**

Lovable Cloud maneja automáticamente la autenticación y configuración de Edge Functions. Las migraciones SQL han sido adaptadas para funcionar sin SERVICE_ROLE_KEY hardcodeado.

Solo necesitas hacer `git push` y Lovable desplegará todo automáticamente.

---

## 🔑 Para Supabase Tradicional (No Lovable)

Si NO usas Lovable Cloud y tienes Supabase tradicional, sigue estos pasos:

El SERVICE_ROLE_KEY es una clave especial de Supabase que tiene **permisos completos** sobre tu base de datos. Se usa para:
- Triggers de base de datos que llaman a Edge Functions
- Cron jobs que ejecutan operaciones programadas
- Operaciones administrativas automatizadas

**⚠️ IMPORTANTE:** Esta clave es sensible. NO la compartas públicamente ni la agregues a repositorios Git públicos.

---

## 📋 PASO 1: Obtener el SERVICE_ROLE_KEY

1. Ve a **Supabase Dashboard**: https://supabase.com/dashboard
2. Selecciona tu proyecto: **vsvsgesgqjtwutadcshi**
3. En el menú lateral, ve a **Settings** → **API**
4. Busca la sección **Project API keys**
5. Encontrarás dos claves:
   - `anon` `public` - Esta NO es la que necesitas
   - `service_role` `secret` - **Esta es la que necesitas** ✅
6. Haz clic en **Reveal** o el ícono de ojo para mostrar la clave
7. Copia la clave completa (será un string muy largo que empieza con `eyJhbG...`)

---

## 📝 PASO 2: Reemplazar en los Archivos

Necesitas editar **3 archivos de migración**.

### Archivo 1: `20260126222111_auto_trigger_booking_automation.sql`

**Ubicación:** Línea 23

**Busca:**
```sql
'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzUyNDgwMiwiZXhwIjoyMDQ5MTAwODAyfQ.YOUR_ACTUAL_SERVICE_ROLE_KEY_HERE'
```

**Reemplaza con:**
```sql
'Authorization', 'Bearer TU_SERVICE_ROLE_KEY_COMPLETA_AQUI'
```

---

### Archivo 2: `20260126222113_auto_fix_missing_jobs_cron.sql`

**HAY 2 OCURRENCIAS en este archivo:**

**Ocurrencia 1:** Línea ~35 (dentro del loop de balance jobs)

**Busca:**
```sql
"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzUyNDgwMiwiZXhwIjoyMDQ5MTAwODAyfQ.YOUR_ACTUAL_SERVICE_ROLE_KEY_HERE"
```

**Reemplaza con:**
```sql
"Authorization": "Bearer TU_SERVICE_ROLE_KEY_COMPLETA_AQUI"
```

**Ocurrencia 2:** Línea ~59 (dentro del loop de host report jobs)

**Busca y reemplaza lo mismo que arriba.**

---

### Archivo 3: `20260126222114_daily_health_check_cron.sql`

**Ubicación:** Línea ~13

**Busca:**
```sql
"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTczMzUyNDgwMiwiZXhwIjoyMDQ5MTAwODAyfQ.YOUR_ACTUAL_SERVICE_ROLE_KEY_HERE"
```

**Reemplaza con:**
```sql
"Authorization": "Bearer TU_SERVICE_ROLE_KEY_COMPLETA_AQUI"
```

---

## 🔍 PASO 3: Verificar el Reemplazo

Asegúrate de que:
- ✅ Ya NO aparece el texto `YOUR_ACTUAL_SERVICE_ROLE_KEY_HERE` en ningún archivo
- ✅ La clave empieza con `eyJhbG...` y es muy larga (más de 200 caracteres)
- ✅ NO hay espacios ni saltos de línea dentro de la clave
- ✅ Mantuviste las comillas `'` o `"` según el archivo

---

## 🧪 PASO 4: Probar la Clave

Antes de aplicar las migraciones, prueba que tu SERVICE_ROLE_KEY funciona:

```bash
# Desde terminal, ejecuta:
curl -X POST https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/trigger-booking-automation \
  -H "Authorization: Bearer TU_SERVICE_ROLE_KEY_AQUI" \
  -H "Content-Type: application/json" \
  -d '{"booking_id": "un-booking-id-de-prueba"}'

# Si la clave es correcta, debería responder (aunque el booking no exista):
# - Si booking no existe: {"error": "Booking not found"}
# - Si la clave es incorrecta: {"error": "JWT expired" o "Invalid JWT"}
```

---

## ✅ PASO 5: Aplicar las Migraciones

Una vez verificado que la clave funciona:

```bash
# Opción A: Via CLI
cd /Users/cberrio04/Documents/OEV-PROJECT/orlandoeventvenue
supabase db push

# Opción B: Via Dashboard
# Supabase Dashboard → Database → Migrations → Run migrations
```

---

## 🔐 Seguridad: Proteger tu SERVICE_ROLE_KEY

### ✅ HACER:
- Mantener la clave en las migraciones SQL (están en .gitignore generalmente)
- Usar variables de entorno en Edge Functions
- Compartir solo con administradores de confianza

### ❌ NO HACER:
- NO compartir la clave en chat, email o mensajes públicos
- NO subirla a repositorios públicos de GitHub
- NO exponerla en el frontend (JavaScript del navegador)

---

## 🆘 Si Perdiste o Necesitas Regenerar la Clave

1. Ve a Supabase Dashboard → Settings → API
2. En la sección **service_role key**, haz clic en **Reset**
3. Copia la nueva clave
4. Actualiza TODOS los archivos donde la uses:
   - Las 3 migraciones nuevas
   - Cualquier otro lugar donde la hayas usado

**NOTA:** Regenerar la clave invalidará la anterior - deberás actualizar todos los lugares donde se use.

---

## 📧 Verificar Gmail Credentials

El sistema de health check usa Gmail para enviar alertas. Verifica que estas variables estén configuradas:

1. Ve a Supabase Dashboard → Settings → Edge Functions → Secrets
2. Verifica que existen:
   - `GMAIL_USER` = orlandoglobalministries@gmail.com
   - `GMAIL_APP_PASSWORD` = (tu app password de Gmail)

Si no están configuradas, el health check funcionará pero no enviará emails.

---

## 🎯 Checklist Final

- [ ] SERVICE_ROLE_KEY obtenida de Supabase Dashboard
- [ ] Clave reemplazada en `20260126222111_auto_trigger_booking_automation.sql`
- [ ] Clave reemplazada en `20260126222113_auto_fix_missing_jobs_cron.sql` (2 veces)
- [ ] Clave reemplazada en `20260126222114_daily_health_check_cron.sql`
- [ ] Verificado que `YOUR_ACTUAL_SERVICE_ROLE_KEY_HERE` ya NO aparece
- [ ] Clave probada con curl (funciona correctamente)
- [ ] Gmail credentials verificadas (GMAIL_USER y GMAIL_APP_PASSWORD)
- [ ] Listo para ejecutar `supabase db push`
