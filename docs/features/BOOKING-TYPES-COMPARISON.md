# 📊 Comparación de Tipos de Bookings

## Tabla Comparativa

| Feature | Website Booking | Internal Booking | External Booking |
|---------|----------------|------------------|------------------|
| **Origen** | Cliente web | Admin dashboard | Admin dashboard |
| **booking_origin** | `website` | `internal` | `external` |
| **Policy** | WEBSITE_FULL_FLOW | INTERNAL_BLOCK_FLOW | EXTERNAL_BLOCK_FLOW |
| **lead_source** | `website` | `internal_admin` | `external_admin` |
| **full_name** | Tal cual | Tal cual | `External - [Nombre]` |
| **payment_status** | `pending` → `deposit_paid` → `fully_paid` | `invoiced` | `invoiced` |
| | | | |
| **💰 Pagos** | | | |
| Requiere pago | ✅ Sí | ❌ No | ❌ No |
| Deposit email | ✅ Sí | ❌ No | ❌ No |
| Balance email | ✅ Sí | ❌ No | ❌ No |
| Stripe checkout | ✅ Sí | ❌ No | ❌ No |
| | | | |
| **📧 Customer Emails** | | | |
| Booking confirmation | ✅ Sí | ❌ No | ❌ No |
| 30-day reminder | ✅ Sí | ❌ No | ❌ No |
| 7-day reminder | ✅ Sí | ❌ No | ❌ No |
| 1-day reminder | ✅ Sí | ✅ Sí | ❌ No |
| | | | |
| **📋 Reports** | | | |
| Host report | ✅ Sí | ✅ Sí | ❌ No |
| Guest report | ✅ Sí | ✅ Sí | ❌ No |
| Cleaning report | ✅ Sí (custodial) | ❌ No | ❌ No |
| | | | |
| **👥 Staff** | | | |
| Asignación | Desde wizard o después | Desde wizard o después | ❌ Solo después |
| "Assigned to booking" email | ✅ Sí | ✅ Sí | ✅ Sí |
| Multi-staff | ✅ Sí | ✅ Sí | ✅ Sí |
| | | | |
| **📅 Calendar** | | | |
| Sync a GHL | ✅ Sí | ✅ Sí | ✅ Sí |
| Availability blocks | ✅ Sí | ✅ Sí | ✅ Sí |
| Aparece en admin schedule | ✅ Sí | ✅ Sí | ✅ Sí |

---

## 🎯 Casos de Uso

### Website Booking
**Cuándo usar**: Cliente normal que reserva desde la web
**Flujo completo**:
1. Cliente llena formulario en website
2. Paga depósito ($200) vía Stripe
3. Recibe confirmation email
4. Recibe reminders (30d, 7d, 1d)
5. Admin asigna staff
6. Staff recibe "assigned to booking" email
7. Evento ocurre
8. Host report enviado
9. Custodial staff recibe cleaning report
10. Balance cobrado automáticamente
11. Booking cerrado

**Automations**: TODAS activas ✅

---

### Internal Booking
**Cuándo usar**: Eventos internos de la empresa, mantenimiento, bloqueos recurrentes
**Ejemplos**:
- Reuniones de staff
- Mantenimiento del venue
- Eventos de la empresa
- Bloqueos para remodelación

**Flujo**:
1. Admin crea desde dashboard
2. **NO se cobra nada** ($0)
3. **NO se envían emails de pago**
4. Sí se envía 1-day reminder
5. Sí se envía host/guest report
6. **NO se envía cleaning report**
7. Staff puede ser asignado (opcional)

**Automations**: Solo reminders y reports básicos

---

### External Booking
**Cuándo usar**: Bookings de partners externos que ya tienen su propio sistema
**Ejemplos**:
- Joel Guerrero (partner externo)
- Antonio Fontanez Diaz
- Jose Rea
- Maria Carolina
- Otros partners que gestionan sus propios clientes

**Flujo**:
1. Admin crea desde dashboard
2. Nombre guardado como "External - [Nombre Real]"
3. **NO se cobra nada** ($0)
4. **NO se envían emails al cliente**
5. **NO se envían reminders**
6. **NO se envían reports**
7. Staff puede ser asignado después (opcional)
8. Si se asigna staff, SÍ recibe "assigned to booking" email

**Automations**: MÍNIMAS (solo staff assignment si aplica)

---

## 🔐 Guard Clauses Implementadas

### Edge Functions con Policy Guards

#### 1. `stripe-webhook`
```typescript
// Verifica requires_payment antes de procesar pagos
if (!policy.requires_payment) {
  console.log("[POLICY_SKIP] Payment not required");
  return 200;
}
```

#### 2. `schedule-balance-payment`
```typescript
// Verifica requires_payment antes de crear link de pago
if (!policy.requires_payment) {
  console.log("[POLICY_SKIP] Balance payment not required");
  return 200;
}
```

#### 3. `send-booking-confirmation`
```typescript
// Verifica send_customer_confirmation antes de enviar email
if (!policy.send_customer_confirmation) {
  console.log("[POLICY_SKIP] Customer confirmation disabled");
  return 200;
}
```

#### 4. `schedule-host-report-reminders`
```typescript
// Verifica cada reminder individualmente
if (!policy.send_pre_event_30d) skip_30d();
if (!policy.send_pre_event_7d) skip_7d();
if (!policy.send_pre_event_1d) skip_1d();
```

#### 5. `useAdminData.ts` (Staff Assignment)
```typescript
// Verifica send_staff_assignment_emails antes de enviar
if (!policy.send_staff_assignment_emails) {
  console.log("[POLICY_SKIP] Staff assignment email disabled");
  // Assignment proceeds, email skipped
}
```

---

## 📝 Campos en Base de Datos

### booking_policies table
```sql
CREATE TABLE booking_policies (
  id UUID PRIMARY KEY,
  policy_name TEXT UNIQUE NOT NULL,
  description TEXT,
  
  -- Payment automation
  requires_payment BOOLEAN DEFAULT TRUE,
  send_deposit_emails BOOLEAN DEFAULT TRUE,
  send_balance_emails BOOLEAN DEFAULT TRUE,
  
  -- Pre-event reminders
  send_pre_event_30d BOOLEAN DEFAULT TRUE,
  send_pre_event_7d BOOLEAN DEFAULT TRUE,
  send_pre_event_1d BOOLEAN DEFAULT TRUE,
  
  -- Reports
  include_host_report BOOLEAN DEFAULT TRUE,
  send_cleaning_report BOOLEAN DEFAULT TRUE,
  
  -- Other
  send_customer_confirmation BOOLEAN DEFAULT TRUE,
  requires_staff_assignment_to_be_ready BOOLEAN DEFAULT FALSE,
  send_staff_assignment_emails BOOLEAN DEFAULT TRUE,
  allow_ghl_sync BOOLEAN DEFAULT TRUE
);
```

### Policies insertadas
```sql
-- Website: Full automation
('WEBSITE_FULL_FLOW', 'Full automation', 
  TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, TRUE)

-- Internal: No payments, basic reports
('INTERNAL_BLOCK_FLOW', 'Internal: no payments', 
  FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE)

-- External: Block only, minimal automation
('EXTERNAL_BLOCK_FLOW', 'External: block only', 
  FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE)
```

---

## 🚨 Casos Edge Importantes

### 1. External booking con staff asignado
- ✅ Staff SÍ recibe "assigned to booking" email
- ❌ Staff NO recibe cleaning report (aunque sea custodial)
- Razón: External partners manejan su propia limpieza

### 2. Internal booking con múltiples staff
- ✅ Todos reciben "assigned to booking" email
- ❌ Ninguno recibe cleaning report
- Razón: Eventos internos no requieren cleaning report formal

### 3. Website booking sin staff asignado
- ⚠️ Warning: Booking puede proceder
- ❌ Cleaning report NO se enviará (no hay custodial)
- Solución: Admin debe asignar custodial antes del evento

### 4. Cambiar booking_origin después de creado
- ⚠️ NO recomendado
- Si es necesario, también cambiar policy_id manualmente
- Automations futuras usarán la nueva policy

---

## 🔍 Cómo Identificar Tipo de Booking

### En la UI (Admin Dashboard)
```typescript
// Badge con color
booking.booking_origin === 'website'  → Badge azul
booking.booking_origin === 'internal' → Badge amarillo
booking.booking_origin === 'external' → Badge gris
```

### En la DB
```sql
-- Por booking_origin
SELECT * FROM bookings WHERE booking_origin = 'external';

-- Por policy
SELECT b.*, p.policy_name 
FROM bookings b
JOIN booking_policies p ON b.policy_id = p.id
WHERE p.policy_name = 'EXTERNAL_BLOCK_FLOW';

-- Por lead_source
SELECT * FROM bookings WHERE lead_source = 'external_admin';

-- Por nombre (external bookings)
SELECT * FROM bookings WHERE full_name LIKE 'External -%';
```

### En los logs
```
[POLICY_SKIP] Payment not required for booking abc123 (policy: EXTERNAL_BLOCK_FLOW)
[POLICY_SKIP] Customer confirmation disabled for booking def456 (policy: INTERNAL_BLOCK_FLOW)
```

---

## ✅ Checklist de Implementación

- [x] Database migration con 3 policies
- [x] booking_origin ENUM
- [x] policy_id FK en bookings
- [x] InternalBookingWizard usa INTERNAL_BLOCK_FLOW
- [x] ExternalBookingWizard usa EXTERNAL_BLOCK_FLOW
- [x] Website bookings usan WEBSITE_FULL_FLOW
- [x] Guard clauses en 5 edge functions críticas
- [x] Idempotency en stripe-webhook
- [x] booking_custodial_staff view
- [x] Staff assignment emails respetan policy
- [x] Backfill de bookings existentes

---

## 🎓 Para el Futuro

### Agregar nueva policy
1. INSERT en `booking_policies` con configuración deseada
2. Crear wizard específico (si aplica)
3. Actualizar guard clauses si hay nuevos campos
4. Documentar en este archivo

### Modificar policy existente
```sql
-- Ejemplo: Habilitar cleaning report para internal bookings
UPDATE booking_policies 
SET send_cleaning_report = TRUE 
WHERE policy_name = 'INTERNAL_BLOCK_FLOW';
```
⚠️ Afecta todos los bookings con esa policy (existentes y futuros)

### Migrar booking de un tipo a otro
```sql
-- Cambiar internal → website
UPDATE bookings 
SET 
  booking_origin = 'website',
  policy_id = (SELECT id FROM booking_policies WHERE policy_name = 'WEBSITE_FULL_FLOW')
WHERE id = 'booking-uuid-here';
```
⚠️ Solo para casos excepcionales
