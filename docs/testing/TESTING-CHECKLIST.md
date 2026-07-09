# ✅ External Booking Wizard - Testing Checklist

## 🎯 Objetivo
Verificar que el External Booking Wizard funciona correctamente en producción.

---

## 📋 Pre-requisitos

- [ ] Código desplegado en producción
- [ ] Acceso al admin dashboard (`/admin/schedule`)
- [ ] Acceso a Supabase Dashboard (para verificar DB)
- [ ] Acceso a GHL Calendar (para verificar sync)

---

## 🧪 Tests Manuales (Ejecutar en orden)

### TEST 1: Verificar que el botón existe
**Tiempo estimado**: 30 segundos

1. [ ] Ir a `/admin/schedule`
2. [ ] Verificar que existe botón **"External Booking"** (gris/secondary)
3. [ ] Verificar que está junto al botón "Internal Booking"

**✅ Resultado esperado**: Botón visible y accesible

---

### TEST 2: Abrir el wizard
**Tiempo estimado**: 30 segundos

1. [ ] Click en "External Booking"
2. [ ] Verificar que se abre un dialog/modal
3. [ ] Verificar título: "Create External Booking"
4. [ ] Verificar descripción menciona "external partner events"

**✅ Resultado esperado**: Dialog se abre correctamente

---

### TEST 3: Verificar campos del formulario
**Tiempo estimado**: 1 minuto

Verificar que existen estos campos:
- [ ] Booking Type (Daily / Hourly)
- [ ] Event Date (calendar)
- [ ] Duration (dropdown)
- [ ] Event Type (dropdown)
- [ ] Number of Guests (input)
- [ ] Client Name (input con *)
- [ ] Email (input con *)
- [ ] Phone (input con *)
- [ ] Notes (textarea opcional)

**✅ Resultado esperado**: Todos los campos presentes

---

### TEST 4: Probar validaciones
**Tiempo estimado**: 2 minutos

1. [ ] Click "Create External Booking" sin llenar nada
2. [ ] Verificar que aparece error: "Please select a date"
3. [ ] Seleccionar fecha
4. [ ] Click "Create" de nuevo
5. [ ] Verificar error: "Please select an event type"
6. [ ] Continuar llenando campos uno por uno
7. [ ] Verificar que cada campo requerido muestra error si está vacío

**✅ Resultado esperado**: Validaciones funcionan correctamente

---

### TEST 5: Preview del nombre "External - "
**Tiempo estimado**: 30 segundos

1. [ ] En campo "Client Name", escribir: "John Doe"
2. [ ] Verificar que debajo aparece: "Will be saved as: External - John Doe"
3. [ ] Cambiar nombre a "Jane Smith"
4. [ ] Verificar que preview actualiza: "External - Jane Smith"

**✅ Resultado esperado**: Preview dinámico funciona

---

### TEST 6: Crear External Booking (Daily)
**Tiempo estimado**: 3 minutos

1. [ ] Llenar formulario:
   - Booking Type: **Daily**
   - Date: [Seleccionar fecha futura disponible, ej: 7 días adelante]
   - Duration: **1 Day**
   - Event Type: **Corporate Event**
   - Number of Guests: **50**
   - Client Name: **"Test External Client"**
   - Email: **"test@external-partner.com"**
   - Phone: **"(555) 123-4567"**
   - Notes: **"External partner test booking"**

2. [ ] Click "Create External Booking"
3. [ ] Verificar que aparece toast de éxito
4. [ ] Verificar que dialog se cierra
5. [ ] Verificar que booking aparece en el calendario

**✅ Resultado esperado**: Booking creado exitosamente

---

### TEST 7: Verificar en Supabase Database
**Tiempo estimado**: 2 minutos

1. [ ] Ir a Supabase Dashboard → SQL Editor
2. [ ] Ejecutar query:
```sql
SELECT 
  id,
  full_name,
  email,
  booking_origin,
  payment_status,
  lead_source,
  policy_id
FROM bookings 
WHERE email = 'test@external-partner.com';
```

3. [ ] Verificar resultados:
   - [ ] `full_name` = **"External - Test External Client"**
   - [ ] `booking_origin` = **'external'**
   - [ ] `payment_status` = **'invoiced'**
   - [ ] `lead_source` = **'external_admin'**
   - [ ] `policy_id` existe (UUID)

**✅ Resultado esperado**: Datos correctos en DB

---

### TEST 8: Verificar policy correcta
**Tiempo estimado**: 1 minuto

1. [ ] En Supabase SQL Editor, ejecutar:
```sql
SELECT b.full_name, p.policy_name
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
WHERE b.email = 'test@external-partner.com';
```

2. [ ] Verificar que `policy_name` = **'EXTERNAL_BLOCK_FLOW'**

**✅ Resultado esperado**: Policy correcta asignada

---

### TEST 9: Verificar sincronización con GHL Calendar
**Tiempo estimado**: 2 minutos

1. [ ] Ir a Supabase Dashboard → Edge Functions → `sync-ghl-calendar` → Logs
2. [ ] Buscar logs recientes del booking creado
3. [ ] Verificar que no hay errores
4. [ ] Ir a GHL Calendar
5. [ ] Buscar el appointment para la fecha seleccionada
6. [ ] Verificar que existe el appointment
7. [ ] Verificar título: "External - Test External Client Corporate Event - Orlando Event Venue"

**✅ Resultado esperado**: Synced correctamente a GHL

---

### TEST 10: Verificar que NO se envían emails incorrectos
**Tiempo estimado**: 5 minutos (esperar)

1. [ ] Esperar 5 minutos después de crear el booking
2. [ ] Verificar email: **test@external-partner.com**
3. [ ] Confirmar que NO recibió:
   - [ ] Booking confirmation email
   - [ ] Deposit payment email
   - [ ] Balance payment email

4. [ ] Ir a Supabase → Edge Functions → Logs
5. [ ] Buscar logs de:
   - `send-booking-confirmation`
   - `stripe-webhook`
   - `schedule-balance-payment`
6. [ ] Verificar que aparecen `[POLICY_SKIP]` para este booking

**✅ Resultado esperado**: NO se enviaron emails (correcto)

---

### TEST 11: Asignar staff al external booking
**Tiempo estimado**: 3 minutos

1. [ ] Ir a `/admin/bookings`
2. [ ] Buscar el booking "External - Test External Client"
3. [ ] Click para abrir booking detail
4. [ ] Ir a sección de Staff Assignment
5. [ ] Asignar un staff (cualquier rol, ej: Production)
6. [ ] Verificar que aparece toast de éxito
7. [ ] Verificar que el staff recibió email "You have been assigned to a booking"

**✅ Resultado esperado**: Staff asignado correctamente, email recibido

---

### TEST 12: Crear External Booking (Hourly)
**Tiempo estimado**: 3 minutos

1. [ ] Ir a `/admin/schedule`
2. [ ] Click "External Booking"
3. [ ] Llenar formulario:
   - Booking Type: **Hourly**
   - Date: [Fecha futura diferente]
   - Start Time: **10:00**
   - End Time: **14:00**
   - Duration: **Single Occurrence**
   - Event Type: **Birthday Party**
   - Client Name: **"Test Hourly External"**
   - Email: **"hourly@external-partner.com"**
   - Phone: **"(555) 987-6543"**

4. [ ] Click "Create External Booking"
5. [ ] Verificar toast de éxito
6. [ ] Verificar que aparece en calendario con horario correcto

**✅ Resultado esperado**: Hourly booking creado correctamente

---

### TEST 13: Verificar availability blocks
**Tiempo estimado**: 2 minutos

1. [ ] Intentar crear otro booking (website o internal) para la misma fecha/hora
2. [ ] Verificar que muestra "not available"

**✅ Resultado esperado**: Availability blocks funcionan

---

### TEST 14: Verificar en Admin Bookings List
**Tiempo estimado**: 1 minuto

1. [ ] Ir a `/admin/bookings`
2. [ ] Buscar los 2 external bookings creados
3. [ ] Verificar que:
   - [ ] Nombres empiezan con "External - "
   - [ ] Payment status = "invoiced"
   - [ ] Aparecen en la lista correctamente

**✅ Resultado esperado**: Bookings visibles en lista

---

### TEST 15: Cleanup (Opcional)
**Tiempo estimado**: 2 minutos

Si quieres limpiar los bookings de prueba:

```sql
-- En Supabase SQL Editor
DELETE FROM bookings 
WHERE email IN (
  'test@external-partner.com',
  'hourly@external-partner.com'
);
```

---

## 📊 Resumen de Resultados

### Tests Completados
- [ ] TEST 1: Botón existe ✅
- [ ] TEST 2: Dialog abre ✅
- [ ] TEST 3: Campos presentes ✅
- [ ] TEST 4: Validaciones funcionan ✅
- [ ] TEST 5: Preview funciona ✅
- [ ] TEST 6: Daily booking creado ✅
- [ ] TEST 7: DB verificada ✅
- [ ] TEST 8: Policy correcta ✅
- [ ] TEST 9: GHL sync ✅
- [ ] TEST 10: NO emails incorrectos ✅
- [ ] TEST 11: Staff assignment ✅
- [ ] TEST 12: Hourly booking ✅
- [ ] TEST 13: Availability blocks ✅
- [ ] TEST 14: Bookings list ✅
- [ ] TEST 15: Cleanup (opcional) ✅

### Tiempo Total Estimado
**~30 minutos** (incluyendo esperas)

---

## 🚨 Qué hacer si algo falla

### Problema: Botón no aparece
**Solución**:
1. Verificar que estás en `/admin/schedule` (no `/staff/schedule`)
2. Hacer hard refresh (Cmd+Shift+R en Mac, Ctrl+Shift+R en Windows)
3. Verificar que el código está desplegado en producción

### Problema: Validaciones no funcionan
**Solución**:
1. Abrir DevTools Console (F12)
2. Buscar errores de JavaScript
3. Reportar errores encontrados

### Problema: Booking no se crea
**Solución**:
1. Abrir DevTools Network tab
2. Buscar request a `/rest/v1/bookings`
3. Ver el error en la respuesta
4. Verificar que la policy EXTERNAL_BLOCK_FLOW existe en DB

### Problema: NO aparece en GHL Calendar
**Solución**:
1. Ir a Supabase → Edge Functions → `sync-ghl-calendar` → Logs
2. Buscar errores en los logs
3. Verificar que GHL API credentials están configuradas
4. Intentar re-sync manual desde booking detail

### Problema: SÍ se enviaron emails (incorrecto)
**Solución**:
1. Verificar en Supabase logs qué función envió el email
2. Verificar que la función tiene guard clause implementado
3. Verificar que `policy_id` es correcto en el booking
4. Reportar el problema para investigación

---

## ✅ Criterios de Éxito

Para considerar el External Booking Wizard como **APROBADO**, todos estos deben cumplirse:

- [x] Botón aparece en Schedule dashboard
- [x] Dialog se abre y cierra correctamente
- [x] Validaciones previenen creación incompleta
- [x] Nombre se guarda con prefijo "External - "
- [x] `booking_origin` = 'external' en DB
- [x] `policy_id` = EXTERNAL_BLOCK_FLOW
- [x] Booking aparece en calendario
- [x] Sync con GHL funciona
- [x] NO se envían emails de pago/confirmación
- [x] Staff puede ser asignado después
- [x] "Assigned to booking" email SÍ se envía
- [x] Availability blocks funcionan
- [x] Daily y Hourly bookings funcionan

---

## 📝 Notas Finales

- Este checklist debe ejecutarse en **producción** después del deploy
- Guardar screenshots de cada paso si es necesario documentar
- Reportar cualquier comportamiento inesperado
- Los bookings de prueba pueden ser eliminados después

**Fecha de testing**: ___________  
**Testeado por**: ___________  
**Resultado**: ✅ APROBADO / ❌ FALLÓ  
**Notas adicionales**: ___________

---

**¿Todo funcionó correctamente? ¡Felicidades! 🎉**  
El External Booking Wizard está listo para uso en producción.
