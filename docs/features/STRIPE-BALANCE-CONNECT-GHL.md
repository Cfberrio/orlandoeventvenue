# Remaining Balance — Stripe Checkout + Connect + Webhook + GHL

Guía de **patrón** del flujo de cobro del balance restante. Objetivo: entender las 3 partes "fuzzy" para poder replicar el patrón (no copiar literal):

1. **Construcción del Checkout** de Stripe (líneas, fee, Connect transfer).
2. **Manejo del webhook** que confirma el pago (firma, idempotencia, reconciliación).
3. **Handoff a GoHighLevel** (cómo OEV le pasa la info para que GHL contacte al cliente).

Tres edge functions forman la cadena:

| Función | Rol | Disparada por |
|---------|-----|---------------|
| [create-balance-payment-link](../../supabase/functions/create-balance-payment-link/index.ts) | **Genera** el Checkout y guarda el URL | Los jobs `balance_retry_*` (vía `process-scheduled-jobs`) o un admin |
| [stripe-webhook](../../supabase/functions/stripe-webhook/index.ts) | **Confirma** que el balance se pagó | Stripe (`checkout.session.completed`) |
| [sync-to-ghl](../../supabase/functions/sync-to-ghl/index.ts) | **Empuja** el snapshot del booking a GHL | Las dos anteriores + casi todo el sistema |

> El contexto de *cuándo* se generan los jobs (short/long notice, T-15d, etc.) está en [docs/automation/ARQUITECTURA-WEBHOOKS-Y-CRON.md](../automation/ARQUITECTURA-WEBHOOKS-Y-CRON.md). Este doc solo cubre la mecánica Stripe ↔ webhook ↔ GHL.

---

## Idea central del patrón

**Ninguna edge function le manda el mensaje de pago al cliente.** El patrón es:

```
create-balance-payment-link  → crea Checkout → guarda `balance_payment_url` en el booking → sync-to-ghl
                                                                                                  │
stripe-webhook (al pagar)    → marca fully_paid → cancela retries → sync-to-ghl ─────────────────┤
                                                                                                  ▼
                                              GHL recibe el snapshot del booking (con el URL y los flags)
                                              GHL corre SU workflow → manda el SMS/email al cliente
```

OEV es el **sistema de verdad** (estado del booking + Stripe). GHL es el **canal de mensajería**. El puente es un único POST de snapshot (`sync-to-ghl`). Esto es lo que hay que entender antes de tocar nada.

---

## Parte 1 — Construcción del Checkout (`create-balance-payment-link`)

### 1.1 Auth de entrada (líneas 31-44)

Acepta **dos** formas: header `x-ghl-backend-token === GHL_BACKEND_TOKEN` (llamada de máquina) **o** un `Authorization` header cualquiera (admin desde el frontend). Si no hay ninguno → 401.

### 1.2 Guards de estado (líneas 83-103)

- `fully_paid` → 400 (`already fully paid`).
- `!= deposit_paid` → 400 (`Deposit must be paid before collecting balance`).

Estos strings de error importan: el dispatcher los detecta para marcar el job como `completed` en vez de reintentar (ver Parte 2.4).

### 1.3 El fee dinámico (líneas 119-134)

El fee NO está hardcodeado. Se lee de la tabla `venue_pricing`:

```
feeRow   = venue_pricing where item_key='processing_fee' and is_active=true
FEE_PCT  = feeRow.price ?? 3.5        // fallback 3.5%
balanceAmountCents = balance_amount * 100
feeCents           = round(balanceAmountCents * FEE_PCT/100)
totalChargeCents   = balanceAmountCents + feeCents
```

El fee se cobra al cliente como **línea aparte** (transparencia en el recibo). Cambiar el % = editar una fila en `venue_pricing`, no redeploy.

### 1.4 Cliente Stripe (líneas 146-167)

Busca el customer por email; si no existe lo crea con `metadata.booking_id` + `reservation_number`. Reusar el customer mantiene el historial en Stripe.

### 1.5 La sesión de Checkout (líneas 175-217) — el corazón

```js
stripe.checkout.sessions.create({
  customer: customerId,
  payment_method_types: ["card"],
  line_items: [
    { price_data: { currency:"usd", product_data:{name:`Balance Payment - ${reservation}`, …}, unit_amount: balanceAmountCents }, quantity:1 },
    { price_data: { currency:"usd", product_data:{name:`Processing Fee (${FEE_PCT}%)`},        unit_amount: feeCents },         quantity:1 },
  ],
  mode: "payment",
  success_url: `${origin}/booking-confirmation?session_id={CHECKOUT_SESSION_ID}&booking_id=${id}&type=balance`,
  cancel_url:  `${origin}/booking-confirmation?cancelled=true&booking_id=${id}&type=balance`,
  metadata: { booking_id, reservation_number, payment_type: "balance" },   // ← el webhook lee esto
  ...(connectedAccountId ? {                                                // ← Connect, solo si hay cuenta
    payment_intent_data: {
      transfer_data: {
        destination: connectedAccountId,
        amount: Math.round(balanceAmountCents * 0.20),                      // 20% del balance BASE
      },
    },
  } : {}),
})
```

**Puntos clave del patrón:**

- **`metadata.payment_type: "balance"`** — así el webhook sabe qué rama ejecutar. Sin esto, el webhook no puede distinguir depósito vs balance vs invoice.
- **`{CHECKOUT_SESSION_ID}`** es un placeholder que Stripe rellena en el redirect — no lo construyes tú.
- **`mode: "payment"`** — pago único, no suscripción.

### 1.6 El transfer de Stripe Connect (líneas 209-216)

Patrón = **destination charge** sobre la cuenta de plataforma:

- Solo aplica si `STRIPE_CONNECTED_ACCOUNT_ID` está seteado (si no, charge normal sin transfer).
- `transfer_data.destination` = la cuenta conectada (el socio/venue).
- `transfer_data.amount` = **20% del balance base** (`balanceAmountCents * 0.20`), **NO** del total con fee.
- El cargo entra a la cuenta **de plataforma**; Stripe transfiere automáticamente esos 20% a la conectada. El 80% + el fee se quedan en plataforma.

> Si replicas esto: el `amount` del transfer se calcula sobre la base sin fee a propósito (el socio no participa del processing fee). Ajusta el 0.20 según el rev-share.

### 1.7 Persistencia (líneas 222-255) — crítico para el recibo

Tras crear la sesión, **guarda en el booking**:

```
balance_payment_url      = session.url
balance_link_expires_at  = session.expires_at (default 24h)
balance_fee              = feeCents/100
balance_total_charged    = totalChargeCents/100
```

Por qué importa: el webhook y el PDF del recibo leen `balance_total_charged` / `balance_fee` para mostrar **exactamente** lo que Stripe cobró. Si no persistes esto al crear el link, el recibo no cuadra. Luego loguea `balance_payment_link_created` (channel `ghl`) y **llama `sync-to-ghl`** (1.8 abajo).

### 1.8 Email directo: solo manual

`create-balance-payment-link` arma un email HTML completo (líneas 285-350) pero **solo lo manda si `send_email === true`** en el body. Los retries automáticos NO pasan ese flag → no mandan email; dependen de GHL. El flag `send_email:true` es para el botón "enviar link" del admin.

---

## Parte 2 — El webhook que confirma el pago (`stripe-webhook`)

### 2.1 Verificación de firma (líneas 277-297)

```
signature = req.headers.get("stripe-signature")          // sin esto → 400
event = await stripe.webhooks.constructEventAsync(rawBody, signature, STRIPE_WEBHOOK_SECRET)
```

**Patrón obligatorio:** usar el **raw body** (string sin parsear) + `constructEventAsync` (async porque Deno usa WebCrypto). Si parseas el body a JSON antes, la firma falla. Esto es lo que prueba que el evento viene de Stripe y no de un atacante.

### 2.2 Routing por `payment_type` (línea 308)

```
paymentType = session.metadata?.payment_type || "deposit"
```

Una sola función maneja deposit / balance / addon_invoice / standalone_invoice. La rama balance arranca en la **línea 825**.

### 2.3 La rama balance (líneas 825-968)

En orden:

1. **Idempotencia** (línea 833): si `existingBooking.balance_paid_at` ya existe → no reprocesa. Stripe reintenta webhooks; sin este guard, doble-procesarías.
2. Trae `balance_amount` actual; calcula el fee real con `deriveProcessingFee(amountPaid, balance_amount)`.
3. **Update del booking:**
   ```
   payment_status        = "fully_paid"
   balance_paid_at       = now()
   balance_fee           = derivado
   balance_total_charged = amountPaid          // lo que Stripe realmente cobró
   processing_fee_pct    = derivado (si aplica)
   ```
4. **Reconciliation guard** (línea 875): si `|amountPaid - balance_total_charged| > 0.01` → loguea `RECONCILE_MISMATCH`. No bloquea, pero deja rastro si lo cobrado ≠ lo guardado.
5. **Cancela los retries** (líneas 881-897): pone `cancelled` todos los `balance_retry_1/2/3` y `create_balance_payment_link` pending. Así no se manda otro link tras pagar.
6. Loguea `balance_paid` en `booking_events`.
7. **Emails:** `sendInternalPaymentEmail` (interno al admin) + `send-balance-confirmation` (email + PDF al cliente, con los campos de fee persistidos).

### 2.4 Por qué los guards de error importan aguas arriba

Cuando un job `balance_retry_*` corre y `create-balance-payment-link` responde "already fully paid" / "Deposit must be paid", el dispatcher (`process-scheduled-jobs`) marca el job **`completed`** en vez de fallar y reintentar. Por eso los strings de error de la Parte 1.2 son contrato, no decoración.

---

## Parte 3 — Handoff a GoHighLevel (`sync-to-ghl`)

### 3.1 Qué es (líneas 337-464)

Construye un **snapshot completo** del booking (`buildBookingSnapshot`) y lo hace **POST a `GHL_BOOKING_WEBHOOK_URL`** (un webhook/trigger de workflow del lado de GHL). Eso es todo el "enviar info a GHL": un JSON con el estado entero del booking.

### 3.2 Qué lleva el snapshot (interface `BookingSnapshot`, líneas 62-117)

Incluye, entre otros:

- Identidad: `reservation_number`, `event_date`, `start/end_time`, `booking_type`, `event_type`.
- Dinero: `total_amount`, `deposit_*`, **`balance_amount`, `balance_fee`, `balance_total_charged`, `balance_payment_url`, `balance_link_expires_at`**.
- Flags string ("true"/"false") que GHL usa como condiciones de workflow: `is_deposit_paid`, `is_fully_paid`, `has_staff_assigned`, `host_report_completed`, **`host_report_step`**, `pre_event_ready`, `short_notice_balance`, etc.
- `customer` (nombre/email/phone) y `staff_*` (siempre custodial).

→ GHL recibe esto y **sus** workflows deciden el outreach: si `is_fully_paid=false` y hay `balance_payment_url`, manda el recordatorio de pago; según `host_report_step`, manda el nudge del host report; etc. **La lógica de mensajería vive en GHL, no en el código.**

### 3.3 Guards de envío (líneas 385-413)

- Bookings draft / leads no pagados → **no** se mandan a GHL.
- `internal_admin` → salta el webhook de GHL pero **sí** sincroniza el calendario (`sync-ghl-calendar`).

### 3.4 Resiliencia

Fallo de `sync-to-ghl` = el cliente podría no entrar al workflow → manda alerta crítica por email (`sendCriticalAlert`) y loguea `*_critical_failure` con `requires_manual_intervention`. Las funciones que llaman a sync-to-ghl no fallan si el sync falla (lo loguean y siguen).

---

## El flujo completo en una imagen

```
[job balance_retry_N due]
       │  process-scheduled-jobs
       ▼
create-balance-payment-link
       ├─ lee fee de venue_pricing
       ├─ stripe.checkout.sessions.create (line items: balance + fee; metadata.payment_type=balance)
       │        └─ Connect: transfer 20% del base a STRIPE_CONNECTED_ACCOUNT_ID
       ├─ guarda balance_payment_url + balance_fee + balance_total_charged en booking
       └─ sync-to-ghl  ──► POST snapshot a GHL_BOOKING_WEBHOOK_URL ──► GHL manda SMS/email con el URL
                                                                              │
                                                                   [cliente paga el link]
                                                                              ▼
stripe-webhook (checkout.session.completed, payment_type=balance)
       ├─ verifica firma (STRIPE_WEBHOOK_SECRET, raw body)
       ├─ idempotencia (balance_paid_at)
       ├─ booking → fully_paid + balance_total_charged = amountPaid
       ├─ reconciliation guard (cobrado vs guardado)
       ├─ cancela balance_retry_* pendientes
       ├─ send-balance-confirmation (email + PDF)
       └─ sync-to-ghl ──► GHL actualiza estado (is_fully_paid=true) → corta recordatorios
```

---

## Variables de entorno de este flujo

| Env var | Usada en | Para qué |
|---------|----------|----------|
| `Stripe_Secret_Key` | create-balance-payment-link | API de Stripe (detecta live/test por prefijo `sk_live`) |
| `STRIPE_CONNECTED_ACCOUNT_ID` | create-balance-payment-link | destino del transfer de Connect (si falta → charge sin transfer) |
| `STRIPE_WEBHOOK_SECRET` | stripe-webhook | verificar firma |
| `GHL_BACKEND_TOKEN` | create-balance-payment-link | auth máquina-a-máquina |
| `GHL_BOOKING_WEBHOOK_URL` | sync-to-ghl | endpoint de GHL que recibe el snapshot |
| `FRONTEND_URL` | create-balance-payment-link | base de success/cancel URLs |
| `venue_pricing.processing_fee` (DB) | create-balance-payment-link | % del fee (no es env, es tabla) |

---

## Si vas a replicar el patrón — checklist

1. **`metadata.payment_type`** en la sesión = cómo el webhook rutea. Define uno por tipo de pago.
2. **Persiste el total cobrado** (`*_total_charged`, `*_fee`) al crear el link, no solo al confirmar — el recibo lo necesita.
3. **Webhook:** raw body + `constructEventAsync` + secret. Siempre idempotencia (`*_paid_at`) y siempre reconciliación.
4. **Connect:** `transfer_data.destination` + `amount`. Decide si el transfer va sobre la base o el total (aquí: base, sin fee).
5. **Cancela el trabajo pendiente** (retries) al confirmar pago, para no seguir contactando.
6. **GHL = canal, no cerebro.** Un solo POST de snapshot con flags; la mensajería se decide allá.
7. **Alertas:** fallo de sync a GHL manda email crítico — el cliente quedaría fuera del workflow.
