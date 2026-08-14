# Arquitectura de Webhooks y Cron Jobs — Cómo funciona la automatización de OEV

Documento de referencia y contexto. Objetivo: que cualquier persona (o cualquier sesión futura de Claude) entienda **cómo entran los eventos externos al sistema** (webhooks de Stripe y GHL), **cómo se programan tareas a futuro** (recordatorios de balance, host reports, feedback, etc.) y **cómo se ejecutan esas tareas** (cron jobs). Sirve como guía para mantener, depurar o replicar el sistema.

Todo el backend de automatización vive en **Supabase Edge Functions** (Deno/TypeScript) en [supabase/functions/](../../supabase/functions/) y en **migraciones SQL** en [supabase/migrations/](../../supabase/migrations/).

---

## 0. Regla de oro que SIEMPRE confunde a todos

**`supabase/config.toml` NO ejecuta crons en este proyecto.**

En `config.toml` verás bloques como:

```toml
[functions.send-internal-booking-reminders]
verify_jwt = false
[functions.send-internal-booking-reminders.cron]
schedule = "0 13 * * *"
```

Esos bloques `[functions.x.cron]` **no corren**. Son decorativos / heredados. La única forma en que algo se ejecuta de forma programada es con **pg_cron**, definido dentro de una **migración SQL** con `cron.schedule(...)`.

> Si quieres agendar una tarea recurrente nueva: créala como `cron.schedule()` en una migración nueva. No la pongas solo en `config.toml` o nunca correrá.

Qué **sí** controla `config.toml`: el flag `verify_jwt` de cada función (si exige o no un JWT de Supabase para invocarla). Eso sí aplica.

---

## 1. Mapa mental: las tres capas

El sistema tiene tres capas que conviene no mezclar:

| Capa | Qué hace | Ejemplos |
|------|----------|----------|
| **1. Webhooks de entrada (inbound)** | Reciben llamadas de servicios externos en tiempo real | `stripe-webhook`, `ghl-appointment-webhook` |
| **2. Productores de jobs (schedulers)** | Calculan *cuándo* debe pasar algo y lo guardan en la tabla `scheduled_jobs` | `schedule-balance-payment`, `schedule-host-report-reminders` |
| **3. Ejecutores / cron** | Corren cada X tiempo y disparan el trabajo que ya tocaba | `process-scheduled-jobs` (cada 5 min), `daily-health-check`, `process-recurring-invoices` |

La idea central: **casi nada se ejecuta directo**. Un evento externo (pago, cambio de estado) **agenda** trabajo futuro en una tabla, y un cron lo va **vaciando** cuando llega la hora. Esto hace el sistema resiliente: si una función falla, el job queda `pending` y se reintenta.

```
Evento externo (Stripe/GHL)
        │
        ▼
  [Webhook inbound]  ──── escribe en `bookings`, dispara emails, etc.
        │
        ▼
  [Trigger DB on bookings]  (cuando lifecycle_status → pre_event_ready)
        │
        ▼
  [trigger-booking-automation]  ── llama en paralelo a 3 schedulers
        │
        ├── schedule-balance-payment        ┐
        ├── schedule-host-report-reminders  ├── INSERT en `scheduled_jobs` (status=pending, run_at=futuro)
        └── schedule-guest-feedback         ┘
                                                  │
                                                  ▼
                                  [pg_cron cada 5 min] → process-scheduled-jobs
                                                  │
                                                  ▼
                          lee jobs con run_at <= now() y los ejecuta
                          (crear link de balance, enviar feedback, cambiar lifecycle...)
```

---

## 2. Capa 1 — Webhooks de entrada (inbound)

Funciones que **reciben** llamadas de afuera. Todas tienen `verify_jwt = false` en `config.toml` porque los servicios externos no mandan un JWT de Supabase; cada una se autentica a su manera.

### 2.1 `stripe-webhook` — el más importante

**Archivo:** [supabase/functions/stripe-webhook/index.ts](../../supabase/functions/stripe-webhook/index.ts)

**Autenticación:** firma criptográfica de Stripe. Lee el header `stripe-signature` y valida con `stripe.webhooks.constructEventAsync()` usando el secreto `STRIPE_WEBHOOK_SECRET`. Si la firma no cuadra, rechaza. (No usa tokens propios; confía en la firma de Stripe.)

**Eventos que escucha:**

| Evento Stripe | Qué hace |
|---------------|----------|
| `checkout.session.completed` | El 95% de la lógica. Procesa un pago completado. |
| `checkout.session.expired` | Marca invoices standalone como `expired`. |

**Tipos de pago (vienen en `metadata.payment_type` de la sesión):**

- `deposit` — depósito del 50%. Marca booking, manda email de confirmación, dispara la automatización.
- `balance` — el 50% restante. Marca booking pagado, manda confirmación de balance con PDF.
- `addon_invoice` — servicios extra post-booking (bar, producción, etc.).
- `standalone_invoice` — factura suelta sin booking.

**Qué escribe en la base de datos:**

- `bookings` — actualiza `payment_status`, montos de depósito/balance, fees.
- `stripe_event_log` — **idempotencia**: registra cada `event.id` ya procesado para no procesar el mismo webhook dos veces (Stripe reintenta).
- `booking_events` — bitácora de auditoría (qué pasó y cuándo).
- `booking_addon_invoices` / `booking_revenue_items` — desglose de ingresos para reportes.
- `invoices` — facturas standalone.
- `scheduled_jobs` — al pagar el balance completo, **cancela** los jobs de reintento de balance que quedaban pendientes.

**Qué dispara hacia afuera (downstream):**

- `send-booking-confirmation` — email de confirmación de depósito al cliente.
- `send-balance-confirmation` — email + PDF de confirmación de balance.
- `sync-to-ghl` — sincroniza el booking con el contacto/oportunidad en GHL.
- `schedule-balance-payment` — agenda los recordatorios del balance.
- Email interno al admin (`orlandoglobalministries@gmail.com`) con detalle del pago y fees.

**Detalles finos importantes:**

- El **fee de procesamiento (3.5%)** se *deriva y persiste* aquí, no lo manda Stripe. Se guarda en el booking para que el PDF del recibo cuadre después.
- Tiene **guards de idempotencia** dobles: revisa `stripe_event_log` *y* campos como `deposit_paid_at` / `balance_paid_at`.
- Respeta políticas: si `booking_policies.requires_payment = false`, salta el procesamiento de pago.

### 2.2 `ghl-appointment-webhook` — citas desde GoHighLevel / Google Calendar

**Archivo:** [supabase/functions/ghl-appointment-webhook/index.ts](../../supabase/functions/ghl-appointment-webhook/index.ts)

**Autenticación:** header `x-ghl-signature` **o** `Authorization: Bearer`, validado contra el secreto `GHL_WEBHOOK_SECRET`.

**Eventos:**

- `appointment.create` — crea un booking nuevo a partir de una cita externa. Genera `reservation_number` tipo `EXT-{timestamp}`, `source = 'google_calendar'`, `payment_status = 'not_required'`. Infiere `booking_type` por duración (≥18h = daily, si no hourly). **Deduplica** por `ghl_appointment_id`.
- `appointment.update` — actualiza fecha/horas/estado. **Salta** bookings que nacieron en el sitio web (para no pisar datos). Si no encuentra el booking, lo crea.
- `appointment.delete` — soft delete: pone `status = 'cancelled'`.

Sirve para que reservas hechas directo en el calendario de GHL/Google aparezcan en el sistema OEV.

### 2.3 `ghl-update-booking-status` — sync de estado GHL → OEV

**Archivo:** [supabase/functions/ghl-update-booking-status/index.ts](../../supabase/functions/ghl-update-booking-status/index.ts)

**Autenticación:** header `x-ghl-backend-token` contra `GHL_BACKEND_TOKEN`.

Permite que GHL empuje cambios de estado de vuelta al booking. Acepta `booking_id` + `new_status` y/o `new_lifecycle_status` (valida contra los enums permitidos). Escribe `bookings.status` / `bookings.lifecycle_status` y deja registro en `booking_events` con `channel = 'ghl'`.

### 2.4 Webhooks de voz y formularios

| Función | Auth | Qué hace |
|---------|------|----------|
| `voice-availability` / `voice-check-availability` | `Authorization: Bearer` vs `VOICE_AGENT_WEBHOOK_SECRET` | Solo **lectura**. Un agente de voz IA consulta disponibilidad. Lee `bookings` + `availability_blocks`. Devuelve texto plano para el agente o JSON. Cero escrituras. |
| `send-contact-form` | Honeypot + validación de campos (sin firma) | Form de contacto del sitio. Manda email al admin + upsert de contacto a GHL. |
| `send-popup-lead` | Validación de campos | Captura de lead del popup. Upsert de contacto a GHL con tags `popup` + `event-type:*`. |

### Resumen de autenticación de inbound

| Función | Mecanismo | Secreto (env var) |
|---------|-----------|-------------------|
| `stripe-webhook` | Firma Stripe | `STRIPE_WEBHOOK_SECRET` |
| `ghl-appointment-webhook` | Header token | `GHL_WEBHOOK_SECRET` |
| `ghl-update-booking-status` | Header token | `GHL_BACKEND_TOKEN` |
| `voice-*` | Bearer token | `VOICE_AGENT_WEBHOOK_SECRET` |
| `send-contact-form` / `send-popup-lead` | Honeypot + validación | — |

---

## 3. Capa 2 — La tabla `scheduled_jobs` y los productores

### 3.1 La tabla `scheduled_jobs`

**Migración:** `supabase/migrations/20251212161809_*.sql`

Es el **corazón** de toda la automatización diferida. Cada fila = "hay que hacer X para el booking Y a la hora Z".

| Columna | Significado |
|---------|-------------|
| `id` | uuid |
| `job_type` | qué tipo de trabajo (ver lista abajo) |
| `booking_id` | a qué booking pertenece |
| `run_at` | **cuándo** se debe ejecutar |
| `status` | `pending` → `completed` \| `failed` \| `cancelled` |
| `attempts` | intentos hechos (máximo 3) |
| `last_error` | error del último intento |
| `completed_at` | cuándo se completó |

Índice clave: `(run_at, status) WHERE status = 'pending'` — para que el ejecutor encuentre rápido lo que toca.

### 3.2 Cómo nacen los jobs: el trigger y el orquestador

1. **Trigger de DB** (migración `20260126222111_auto_trigger_booking_automation.sql`): cuando un booking cambia `lifecycle_status` a `pre_event_ready`, dispara un `net.http_post` hacia `trigger-booking-automation`.

2. **`trigger-booking-automation`** ([archivo](../../supabase/functions/trigger-booking-automation/index.ts)) recibe el `booking_id` y llama **en paralelo** a tres schedulers:
   - `schedule-balance-payment`
   - `schedule-host-report-reminders`
   - `schedule-guest-feedback`

Cada scheduler calcula fechas y hace `INSERT` en `scheduled_jobs` con `status = 'pending'`.

### 3.3 Los productores (schedulers)

| Función | Qué agenda |
|---------|-----------|
| `schedule-balance-payment` | Jobs de reintento del balance + el job `set_lifecycle_in_progress`. (Detalle en §5.) |
| `schedule-host-report-reminders` | `host_report_pre_start`, `host_report_during`, `host_report_post`. |
| `schedule-guest-feedback` | `guest_feedback_post_event`. |
| `backfill-balance-scheduling` | **Manual.** Busca bookings huérfanos (depósito pagado, sin link de balance, sin jobs pendientes, evento futuro) y les llama `schedule-balance-payment`. Red de seguridad. |

---

## 4. Capa 3 — Los cron jobs reales (pg_cron)

Estos son los **únicos** crons que de verdad corren. Definidos con `cron.schedule()` en migraciones.

| Cron (nombre) | Schedule | Llama a | Para qué |
|---------------|----------|---------|----------|
| `process-scheduled-jobs-5min` | `*/5 * * * *` (cada 5 min) | `process-scheduled-jobs` | **El motor.** Vacía la cola de `scheduled_jobs`. |
| `daily-health-check-8am-est` | `0 13 * * *` (8 AM EST) | `daily-health-check` | Detecta jobs vencidos/fallidos y manda alerta por email. |
| `process-recurring-invoices-3pm-et` | `0 19,20 * * *` | `process-recurring-invoices` | Genera facturas hijas de las recurrentes que vencen. |
| `auto-fix-missing-jobs-hourly` | `15 * * * *` (cada hora) | (PL/pgSQL inline) | Auto-repara bookings a los que les faltan jobs de balance o host report. |

> Nota sobre el horario de `process-recurring-invoices`: corre a las **19:00 y 20:00 UTC** para dar las 3 PM de Orlando todo el año (3 PM EDT en verano, 3 PM EST en invierno). La función es idempotente, así que correr dos veces no duplica.

### 4.1 `process-scheduled-jobs` — el dispatcher

**Archivo:** [supabase/functions/process-scheduled-jobs/index.ts](../../supabase/functions/process-scheduled-jobs/index.ts)

Cada 5 minutos:

1. Lee hasta **50** jobs con `status = 'pending'`, `run_at <= now()` y `attempts < 3`.
2. Por cada uno, según su `job_type`, hace lo que toca.
3. Marca el job `completed` (o `failed` y suma `attempts`).

**Tipos de job que maneja:**

| Categoría | `job_type` | Acción |
|-----------|-----------|--------|
| **Balance** | `balance_retry_1/2/3`, `create_balance_payment_link` | Llama `create-balance-payment-link`. Salta si ya está pagado; falla si el depósito no está pagado. |
| **Lifecycle** | `set_lifecycle_in_progress` | `pre_event_ready` → `in_progress` (si pagado + staff asignado). |
| | `set_lifecycle_post_event` | `in_progress` → `post_event` (si pasaron 24h + host report enviado). |
| **Host report** | `host_report_pre_start/during/post` | Actualiza `bookings.host_report_step` y llama `sync-to-ghl`. |
| **Guest feedback** | `guest_feedback_post_event` | Llama `send-guest-feedback`. |
| **Limpieza** | `cleaning_report_reminder` | Llama `send-booking-cleaning-reminder`. |

Además, en línea, dispara `send-standalone-cleaning-reminder` y `process-discount-drip` (los emails 2 y 3 del lead magnet a los popup leads: E02 a las 24h de E01, E03 a las 24h de E02 — o sea 48h de sequence).

> ⚠️ Estas dos llamadas viven **al final** del handler. Hasta agosto 2026 la función retornaba temprano cuando no había jobs pendientes, así que en la práctica casi nunca se ejecutaban (el drip corría solo cuando por casualidad había un job de booking en esa ventana de 15 min). No vuelvas a meter un `return` antes de este bloque.

### 4.2 `daily-health-check` — el vigilante

Corre a las 8 AM EST. Busca jobs vencidos (`pending` con `run_at` muy en el pasado), jobs `failed`, y deadlocks de lifecycle. Si encuentra problemas, manda email de alerta a `orlandoglobalministries@gmail.com`. Es la forma de enterarte si el motor se atascó.

### 4.3 Funciones con cron en `config.toml` que NO corren

Ojo con estas — parecen agendadas pero **no lo están** (su cron solo vive en `config.toml`):

- `auto-generate-payroll` (`"0 * * * *"` en config — inactivo)
- `send-internal-booking-reminders` (`"0 13 * * *"` en config — inactivo)

Si se necesita que corran solas, hay que registrarlas en pg_cron con una migración.

---

## 5. Flujo completo del "remaining balance" (el caso estrella)

Este es el flujo que más se pregunta, trazado de punta a punta.

**Escenario:** cliente paga el depósito → booking pasa a `pre_event_ready` con `payment_status = deposit_paid`.

1. **Pago del depósito** llega a `stripe-webhook`, que marca el booking y dispara la automatización.

2. **Trigger de DB** detecta `lifecycle_status = pre_event_ready` → `net.http_post` a `trigger-booking-automation`.

3. **`trigger-booking-automation`** llama a `schedule-balance-payment`.

4. **`schedule-balance-payment`** ([archivo](../../supabase/functions/schedule-balance-payment/index.ts)) decide según cuántos días faltan al evento:
   - **Corto plazo (≤15 días):** crea el link de balance **de una** (vía `create-balance-payment-link`) + agenda 1 reintento (`balance_retry_2`) a +48h.
   - **Largo plazo (>15 días):** agenda 3 reintentos (`balance_retry_1/2/3`) en T-15 días, +48h, +96h, todos a las 9 AM hora de Orlando.
   - También agenda `set_lifecycle_in_progress` para la hora de inicio del evento.
   - Si la política del booking tiene `requires_payment = false`, **no agenda nada**.

5. Los jobs quedan en **`scheduled_jobs`** con `status = pending` y su `run_at`.

6. **`process-scheduled-jobs`** (cada 5 min) encuentra el job cuando `run_at <= now()`.
   - Si el booking ya está totalmente pagado → marca el job `completed` y no manda nada.
   - Si el depósito no está pagado → `failed`.
   - Si todo OK → llama `create-balance-payment-link`.

7. **`create-balance-payment-link`** crea la sesión de Stripe Checkout, persiste `balance_fee` / `balance_total_charged` / `processing_fee_pct` en el booking (para el PDF), y devuelve el `payment_url`.

8. Cuando el cliente paga, el ciclo se cierra en **`stripe-webhook`** (`payment_type = balance`): marca el booking pagado, manda **`send-balance-confirmation`** (email + PDF de recibo) y **cancela** los jobs de balance restantes en `scheduled_jobs`.

```
Depósito pagado → trigger DB → trigger-booking-automation
   → schedule-balance-payment → INSERT scheduled_jobs (balance_retry_*)
        → [cada 5 min] process-scheduled-jobs → create-balance-payment-link → Stripe link
             → cliente paga → stripe-webhook (balance)
                  → marca pagado + send-balance-confirmation (PDF)
                  → cancela jobs de balance pendientes
```

---

## 6. Cómo depurar / preguntas frecuentes

- **"Agendé un cron en config.toml y no corre."** → Correcto, no corre. Usa `cron.schedule()` en una migración. Ver §0.
- **"Un recordatorio de balance no salió."** → Revisa `scheduled_jobs`: ¿el job está `pending` con `run_at` pasado? Entonces el motor (`process-scheduled-jobs`) se atascó — revisa el email de `daily-health-check`. ¿Está `failed`? Mira `last_error`.
- **"Un booking no tiene jobs de balance."** → El cron `auto-fix-missing-jobs-hourly` debería repararlo en la próxima hora; o corre `backfill-balance-scheduling` a mano.
- **"Stripe procesó el pago dos veces."** → No debería: `stripe_event_log` da idempotencia por `event.id`. Verifica que el evento se esté registrando ahí.
- **"¿Dónde veo qué pasó con un booking?"** → Tabla `booking_events`, es la bitácora de auditoría.

### Ver los crons activos en la base

```sql
SELECT jobid, schedule, jobname, active FROM cron.job ORDER BY jobname;
```

### Ver jobs pendientes / atascados

```sql
SELECT job_type, status, run_at, attempts, last_error
FROM scheduled_jobs
WHERE status = 'pending' AND run_at <= now()
ORDER BY run_at;
```

---

## 7. Para agregar una tarea programada nueva (receta)

1. ¿Es disparada por un evento (pago, cambio de estado)? → engánchala en el webhook o en un trigger de DB que llame a un scheduler, y haz que el scheduler haga `INSERT` en `scheduled_jobs`. Luego agrega el manejo del nuevo `job_type` en `process-scheduled-jobs`.
2. ¿Es puramente periódica (correr todos los días a las X)? → crea una migración con `cron.schedule('nombre', 'cron expr', $$ ... net.http_post(...) $$)` apuntando a tu edge function. **No** confíes en `config.toml`.
3. Recuerda: horas en UTC. Orlando es UTC-4 (verano/EDT) o UTC-5 (invierno/EST). Si la hora local importa, considera agendar en dos horas UTC como hace `process-recurring-invoices`, o ajusta manualmente.
4. Hazlo **idempotente**: que correr dos veces no duplique trabajo.
```
