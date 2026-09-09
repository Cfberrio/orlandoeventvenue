# Referencia: Lógica de Estados de Bookings + UX/UI del Dashboard

> Documento de **referencia** para replicar la lógica de estados de reservas en otro venue.
> Extraído del sistema OEV. Solo lógica — no es guía de implementación literal.
> Fecha de extracción: 2026-06-12

---

## 1. Modelo de Estados: Dos Dimensiones Independientes

El sistema NO usa un solo campo de estado. Usa **tres campos** que avanzan por separado:

| Campo | Tipo | Propósito |
|-------|------|-----------|
| `status` | enum (`booking_status`) | Estado legado/administrativo |
| `lifecycle_status` | TEXT | **Estado operativo principal** (progreso del evento) |
| `payment_status` | enum (`payment_status`) | Estado financiero (independiente del lifecycle) |

**Clave del diseño:** `lifecycle_status` (progreso del evento) y `payment_status` (dinero) avanzan **independientes**. Un booking puede estar `confirmed` con pago solo `deposit_paid`. Esto separa "¿dónde está el evento en el tiempo?" de "¿cuánto pagó el cliente?".

### Valores

**`lifecycle_status`** (TEXT, default `'pending'`) — el eje principal:
```
pending → confirmed → pre_event_ready → in_progress → post_event → closed_review_complete
                                                                  ↘ (en cualquier punto) cancelled
```
- `pending` — recién creado, sin revisar
- `confirmed` — booking confirmado
- `pre_event_ready` — listo, dispara automatización pre-evento
- `in_progress` — evento sucediendo
- `post_event` — evento terminó, falta cierre
- `closed_review_complete` — cerrado final
- `cancelled` — cancelado

**`payment_status`** (enum, default `'pending'`):
```
pending → deposit_paid → fully_paid
       ↘ failed   ↘ refunded   ↘ invoiced
```
- `pending` — sin depósito (= "LEAD")
- `deposit_paid` — depósito pagado (típico 50%)
- `fully_paid` — balance pagado
- `failed` — pago falló
- `refunded` — reembolsado
- `invoiced` — facturado (addons / standalone)

**`status`** (enum legado): `pending_review`, `confirmed`, `cancelled`, `completed`, `needs_info`, `needs_payment`, `declined`

**`booking_type`**: `hourly` | `daily`
**`booking_origin`**: `website` | `internal` | `external`

---

## 2. Transiciones de Estado (qué las dispara)

### Creación → `pending`
Al enviar el formulario público. Estado inicial:
```ts
status: "pending_review", payment_status: "pending", lifecycle_status: "pending"
```
- `payment_status: "pending"` ⇒ es un **LEAD** (sin depósito). No bloquea calendario.

### `pending` → depósito pagado (Stripe webhook)
Cliente paga depósito → webhook `checkout.session.completed`:
```ts
payment_status: "deposit_paid", deposit_paid_at, stripe_session_id, deposit_fee, deposit_total_charged
```
> Importante: el webhook **solo cambia `payment_status`**, NO toca `lifecycle_status`. El avance del lifecycle es manual (admin) o por trigger.

### `confirmed` → `pre_event_ready` (acción admin con guardas)
Admin marca pre-event ready vía checklist o dropdown. Dispara automáticamente (trigger DB → edge function) la creación de jobs programados:
- recordatorios de pago de balance
- host report job

**Guarda (gate):** si hay servicio de bar (`bar_package != 'none'`), NO puede pasar a `pre_event_ready` salvo que vendor asignado + cliente contactado. Patrón de validación condicional antes de permitir la transición.

### → `in_progress` (automático en hora del evento)
Trigger por tiempo. Puede **saltarse** `pre_event_ready` e ir directo a `in_progress` si el pago ocurrió rápido.

### `in_progress` → `post_event`
Cuando `event_date + 24h` pasó.

### `post_event` → `closed_review_complete`
Admin confirma items post-evento (host report, review recibida).

### depósito → balance pagado (`fully_paid`)
Cliente paga balance → webhook:
```ts
payment_status: "fully_paid", balance_paid_at, balance_fee
```
+ cancela jobs pendientes de reintento de balance.

### Cualquier estado → `cancelled`
```ts
status: "cancelled", lifecycle_status: "cancelled", cancelled_at
```
Limpieza en cascada al cancelar:
1. Borra jobs programados `pending`/`failed`
2. Borra bloques de disponibilidad (`availability_blocks`) del booking
3. Crea evento `booking_cancelled` (audit)
4. Sincroniza cancelación a CRM externo (GHL)

**Guarda:** no se puede cancelar un booking `completed`.

---

## 3. Reglas de Validación / Guardas

| Guarda | Regla |
|--------|-------|
| Cancelación | bloqueada si `status === "completed"` |
| Reschedule | deshabilitado si `cancelled` o `completed` |
| Pre-event ready | bloqueado si bar service incompleto (vendor + cliente contactado) |
| Bloqueo de calendario | solo bookings con `payment_status ∈ {deposit_paid, fully_paid, invoiced}` y no `cancelled` bloquean fechas |
| Leads | `payment_status: "pending"` NO bloquea calendario (es solo lead) |

**Política por venue (`booking_policies`):** flags que controlan transiciones automáticas:
`auto_lifecycle_transitions`, `requires_payment`, `requires_staff_assignment`, `send_customer_confirmation`, `send_deposit_emails`, `send_balance_emails`. Ej: si `requires_payment === false`, el webhook salta todo el procesamiento de pago. **Esto hace el sistema configurable por venue** — clave para replicar.

---

## 4. Tipos de Booking y diferencias de estado

| Origen | Cómo se crea | Estado inicial |
|--------|--------------|----------------|
| `website` | formulario público | `pending` / `pending` |
| `internal` | wizard admin | `confirmed` directo (salta pending_review) |
| `external` | wizard admin | `confirmed` directo |

- **Daily vs Hourly:** daily = bloque día completo (01:00–23:00, sin slots); hourly = rango horario, permite múltiples por día.
- **Blocked slots (`availability_blocks`):** se crean al confirmar booking, se borran al cancelar. Tipos `daily`/`hourly`, con `booking_id` dueño.
- **Reschedule:** RPC `reschedule_booking(...)` — actualiza fecha/hora, mueve bloques de disponibilidad, registra evento. Solo en ciertos estados.

---

## 5. Audit Trail (`booking_events`)

Cada cambio relevante registra un evento. Tipos:
`booking_cancelled`, `confirmation_sent`, `reminder_72h`, `reminder_24h`, `reminder_3h`, `post_event_link_sent`, `review_request_sent`.
Metadata guarda estado previo (`previous_status`, `previous_lifecycle`). **Replicar esto** da trazabilidad completa.

---

## 6. Jobs Programados (`scheduled_jobs`)

Automatización ligada a estados:
- `balance_retry_1/2/3` — reintentos recordatorio de balance
- `create_balance_payment_link` — generar link de balance
- `host_report_job` — recordatorio host report
- `guest_feedback_job` — feedback post-evento

Limpieza: se cancelan al pagar balance o al cancelar booking.

---

## 7. UX/UI del Dashboard — Mapeo Visual de Estados

### Mapa estado → color/label (lo más reutilizable)

**`lifecycle_status` (labels con emoji + color):**
```
pending                → ⏳ Pending Review   → amarillo
confirmed              → ✅ Confirmed        → azul
pre_event_ready        → 🎯 Ready for Event  → verde / índigo
in_progress            → 🔴 Event In Progress→ rojo / verde
post_event             → 📋 Post Event       → morado
closed_review_complete → ✔️ Closed           → gris
cancelled              → ❌ Cancelled        → destructive/rojo
```

**`payment_status`:**
```
pending      → "Pending"      → ámbar
deposit_paid → "Deposit Paid" → azul
fully_paid   → "Paid"         → verde
failed       → "Failed"       → rojo
refunded     → "Refunded"     → slate
invoiced     → "Invoiced"     → morado
```

**`booking_origin` (en calendario):**
```
website  → verde  (icono Globe)
internal → ámbar  (icono ClipboardList)
external → morado (icono Download)
```

> Nota: el sistema original tiene leve inconsistencia de colores entre vistas (Dashboard usa tokens `chart-*`, Detail usa Tailwind `*-100/800`). **Al replicar, centraliza el mapa en un solo archivo** para evitar esto.

### Vistas del Dashboard

| Vista | Formato | Cómo muestra estados |
|-------|---------|----------------------|
| **Dashboard** (overview) | cards + stats | upcoming bookings con badge lifecycle; pipeline summary = conteo por estado; secciones de alertas |
| **Bookings List** | tabla agrupada | grupos por `lifecycle_status`; dentro de `pending` sub-divide en **Leads** (sin depósito) vs **Pending Review** (con depósito) |
| **Schedule** | calendario semana/mes | eventos como cajas de color; filtro por `booking_origin` |
| **Booking Detail** | tabs | Review / Checklist (driven por estado) / Staff / Reports |

### Renderizado condicional por estado (patrón central)

- Alerta **"LEAD - No Deposit Received"** → solo si `payment_status === "pending"`
- **Confirmation Checklist** (3 checks: disponibilidad, staff, conflictos) → solo si `lifecycle_status === "pending"`; al completar los 3 ⇒ marca `pre_event_ready` + dispara automatización
- **Post-Event Close** (check "review recibida") → solo si `lifecycle_status === "post_event"` ⇒ pasa a `closed_review_complete`
- Botón **"Mark Deposit Paid"** → solo si `payment_status === "pending"`
- Botón **"Send Balance Payment Link"** → solo si `payment_status === "deposit_paid"`
- Botón **Cancel** → solo si `status` no es `completed`/`cancelled`
- Botón **Reschedule** → deshabilitado si `cancelled`/`completed`

### Filtros (Bookings List)
Dropdown por `lifecycle_status` (7 valores), por `payment_status` (6 valores), rango de fechas, tipo de evento, nombre cliente, orden.

### Alertas operativas (Dashboard)
- Staff sin asignar
- Issues (reportes de staff/guest)
- Operacional: eventos NO listos en próximos 3 días

---

## 8. Checklist para replicar en el nuevo venue

1. [ ] Tabla `bookings` con 3 campos de estado: `status`, `lifecycle_status`, `payment_status` (separar evento vs dinero)
2. [ ] Tabla `booking_policies` con flags configurables por venue (esto te da multi-venue sin recodear)
3. [ ] Tabla `availability_blocks` ligada a `booking_id` (crear al confirmar, borrar al cancelar)
4. [ ] Tabla `scheduled_jobs` para automatización (recordatorios, reportes)
5. [ ] Tabla `booking_events` para audit trail con estado previo
6. [ ] Webhook de pago que SOLO toca `payment_status` (desacoplar de lifecycle)
7. [ ] Trigger DB al entrar a `pre_event_ready`/`in_progress` → dispara automatización
8. [ ] Guardas: cancelación, reschedule, gate de servicios extras (bar)
9. [ ] Mapa único estado→color/label centralizado
10. [ ] UI: agrupar lista por lifecycle, sub-dividir pending en Leads/Pending Review, acciones condicionales por estado

---

## Apéndice: Archivos fuente (sistema OEV)

| Tema | Archivo |
|------|---------|
| Enums/tipos | `src/integrations/supabase/types.ts` (~2561-2731) |
| Schema bookings | `supabase/migrations/20251201025719_*.sql` |
| `lifecycle_status` añadido | `supabase/migrations/20251202232622_*.sql` |
| Creación inicial | `src/hooks/useCreateBooking.ts` (280-287) |
| Pagos (webhook) | `supabase/functions/stripe-webhook/index.ts` (deposit 1030, fully_paid 854) |
| Cancelación | `supabase/functions/cancel-booking/index.ts` |
| Trigger automatización | `supabase/migrations/20260126222111_*.sql`, `20260128000000_*.sql` |
| Reschedule RPC | `supabase/migrations/20260109150633_*.sql` |
| Guarda bar service | `supabase/migrations/20260429154659_*.sql` |
| Dashboard | `src/pages/admin/Dashboard.tsx` (colores 31-39) |
| Bookings List | `src/pages/admin/BookingsList.tsx` (config 68-106) |
| Booking Detail | `src/pages/admin/BookingDetail.tsx` (labels/colores 87-105) |
| Schedule | `src/pages/admin/Schedule.tsx` (30-44) |
| Layout/nav | `src/components/admin/AdminLayout.tsx` |
