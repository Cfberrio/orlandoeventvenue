# Invoices — Documentación Completa (Frontend → Backend → DB)

> Cómo funciona el apartado de **Invoices** del admin de OEV, de principio a fin: cada pantalla, cada campo, cada botón, cada edge function, cada tabla, cada estado y toda la matemática de fees.

**Última actualización:** 2026-07-21
**Alcance:** `src/pages/admin/Invoices.tsx`, `CreateInvoiceDialog`, `CreateAddonInvoiceDialog`, `InvoiceRevenueView`, 8 edge functions, 2 tablas + 1 columna JSONB.

---

## 0. Panorama — hay TRES sistemas de "invoice"

El nombre "Invoices" cubre tres cosas distintas que no deben confundirse:

| # | Sistema | Tabla | Se crea desde | Edge function | Recurrente |
|---|---------|-------|---------------|---------------|:---:|
| 1 | **Standalone invoices** | `invoices` | Página `/admin/invoices` (botón "Create New Invoice") | `create-invoice` | ✅ Sí |
| 2 | **Add-on invoices** | `booking_addon_invoices` | Detalle de booking `/admin/bookings/:id` | `create-addon-invoice` | ❌ No |
| 3 | **Balance payments** (el 50% restante de un booking) | columnas en `bookings` | Automático tras el depósito + botón manual | `create-balance-payment-link` | ❌ No (pero con reintentos programados) |

Además existe un **estado de booking** `payment_status = "invoiced"` que ponen los wizards de creación de booking — **NO crea ningún registro de invoice**, solo marca el booking con montos en cero.

> ⚠️ **Dato clave:** a pesar del nombre "Invoices", el sistema **nunca** usa objetos `Stripe.Invoice`/`InvoiceItem`. TODO son **Stripe Checkout Sessions** (`mode: "payment"`) con `price_data` inline. No hay `stripe.invoices.create`, `finalize` ni `sendInvoice` en ninguna parte.

---

## 1. Navegación y rutas

- **Ruta principal:** `/admin/invoices` → [App.tsx:97](../../src/App.tsx#L97) (`<Route path="invoices" element={<Invoices />} />`, anidada bajo el layout `/admin`).
- **Nav lateral:** [AdminLayout.tsx:34](../../src/components/admin/AdminLayout.tsx#L34) → `{ to: "/admin/invoices", icon: FileText, label: "Invoices" }`. Icono Lucide **`FileText`**, entre "Discounts" y "Analytics".
- **Invoice Revenue view:** no tiene ruta propia; se renderiza dentro de **Revenue Reports** (`/admin/reports`) en [RevenueReports.tsx:147](../../src/pages/admin/RevenueReports.tsx#L147).
- **Add-on invoices:** sin ruta; se llega desde `/admin/bookings/:id` (card "Add-On Invoices").

**No existe página de detalle por invoice.** La fila de la tabla es la única vista.

---

## 2. Página `Invoices.tsx` (standalone)

Archivo: [src/pages/admin/Invoices.tsx](../../src/pages/admin/Invoices.tsx)

### 2.1 Header
- **H1:** "Invoices". **Subtítulo:** "Create and manage standalone invoices".
- **Botón (arriba-derecha):** "Create New Invoice" (icono `Plus`) → abre `CreateInvoiceDialog`.

### 2.2 Cards de resumen (grid de 4)
| Card | Fuente | Estilo |
|------|--------|--------|
| **Pending** | count `payment_status === "pending"` | icono `FileText` |
| **Paid** | count `payment_status === "paid"` | verde |
| **Revenue** | Σ `total_charged ?? amount` de las pagadas, `$` + `toLocaleString("en-US", {minimumFractionDigits:2})` | verde |
| **Active Recurring** | count `recurring_active` truthy | icono `RefreshCw`, ámbar |

### 2.3 Query de datos
- React Query key `["admin-invoices"]`.
- `supabase.from("invoices").select("*").order("created_at", { ascending: false })`.
- **No hay** paginación, búsqueda, filtros, tabs ni ordenamiento configurable. Una sola tabla, más nuevo primero.

### 2.4 Tabla "All Invoices"
- **Loading:** "Loading...". **Empty:** `No invoices yet. Click "Create New Invoice" to get started.`

Columnas:
1. **Invoice #** — `invoice_number` (`font-mono text-xs`).
2. **Title** — `title`; debajo puede mostrar:
   - `N item(s)` si `line_items.length > 0`.
   - Badge **recurrente** si `is_recurring && !recurring_parent_id`: "Recurring {freq}" (activo, variant `default`) o "Stopped {freq}" (variant `outline`), icono `RefreshCw`. Si activo + `recurring_next_send_at`: `Next: {MMM d, yyyy} 3 PM ET`.
   - Badge **hijo** si `recurring_parent_id`: "Auto-sent" (icono `Zap`, outline).
3. **Customer** — `customer_email` + `customer_name` (sub-línea).
4. **Amount** — `${total_charged ?? amount}`; si `processing_fee > 0`, sub-línea `${amount} + ${processing_fee} fee`.
5. **Status** — Badge (ver §2.6).
6. **Created** — `format(created_at, "MMM d, yyyy")`; si `paid_at`, sub-línea verde `Paid {MMM d}`.
7. **Actions** — ver §2.5.

`frequencyLabel(days)`: 7→"Weekly", 14→"Bi-weekly", 30→"Monthly", otro→"Every {days}d".

### 2.5 Acciones por fila (todas `ghost`, icon, con tooltip)
| Acción | Icono | Condición | Efecto |
|--------|-------|-----------|--------|
| Copiar link | `Copy` | `payment_url && status==="pending"` | `navigator.clipboard.writeText(url)` + toast |
| Abrir link | `ExternalLink` | igual | abre `payment_url` en nueva pestaña |
| Duplicar | `CopyPlus` | siempre | pre-carga el dialog con title/description/line_items/customer (**no** copia settings de recurrencia) |
| Detener recurrencia | `Square` (ámbar) | `recurring_active` | `window.confirm` → `update({ recurring_active: false })` |
| Eliminar | `Trash2` (rojo) | `status !== "paid" && !recurring_active` | `window.confirm` → `delete()` |

> **No existe** botón de "resend" ni de "void/cancel". El estado `cancelled` existe como badge pero no hay UI para asignarlo.

### 2.6 Máquina de estados (`payment_status`)
`statusConfig` en `Invoices.tsx:52-57`:
| Valor | Label | Badge variant |
|-------|-------|---------------|
| `pending` | Pending | `secondary` (gris) |
| `paid` | Paid | `default` (primary) |
| `expired` | Expired | `destructive` (rojo) |
| `cancelled` | Cancelled | `outline` |

Fallback → `pending`. Sin hex explícito (usa variantes del design system).

---

## 3. `CreateInvoiceDialog` (crear standalone)

Archivo: [src/components/admin/CreateInvoiceDialog.tsx](../../src/components/admin/CreateInvoiceDialog.tsx)

Título dinámico: "Duplicate Invoice" (si duplicando) / "Create Recurring Invoice" (si toggle on) / "Create New Invoice".

### 3.1 Campos
| Campo | Label | Tipo | Req | Notas |
|-------|-------|------|:--:|-------|
| Title | "Invoice Title *" | Input text | ✅ | `title.trim()` no vacío |
| Notes | "Notes" | Textarea (2 rows) | ❌ | → `description` o null |
| Items | "Items *" | Filas repetibles | ✅ (≥1 válido) | ver §3.2 |
| Customer Email | "Customer Email *" | Input email | ✅ | incluye `@`; se lowercasea al enviar |
| Customer Name | "Customer Name" | Input text | ❌ | |
| Recurring | "Recurring Invoice" | Switch + `RefreshCw` | ❌ | revela sub-panel §3.4 |

### 3.2 Line items
- Cada fila: Input "Service name" + Input `$` numérico (`step=0.01 min=0`) + botón `X` (deshabilitado si solo queda 1 fila).
- Botón "Add Item" (`Plus`) agrega fila.
- Válido = `label.trim()` y `parseFloat(amount) > 0`. Se requiere ≥1.

### 3.3 Totales (mostrados en el bloque de resumen)
```
total (Subtotal) = Σ parseFloat(amount)          // NaN → 0
RATE             = (usePricing().processing_fee || 3.5) / 100   // default 3.5%
processingFee    = Math.round(total * RATE * 100) / 100
totalWithFee     = total + processingFee          // "Total (client pays)"
```
- "Subtotal" → `${total}`
- "Processing Fee ({rate}%)" → `${processingFee}` (rate = `(RATE*100).toFixed(2)`, ej. "3.50%")
- "Total (client pays)" → `${totalWithFee}` (bold)
- Bloqueo si `total <= 0` → toast "Total must be greater than $0".

### 3.4 Sub-panel recurrente (solo con Switch on)
- Presets: **Weekly** (7d), **Bi-weekly** (14d), **Monthly** (30d, default), **Custom** (null).
- Custom → input "Every [N] days" (`min=1 max=365`).
- `intervalDays` = custom `parseInt(customDays)` o los días del preset.
- Info: "First invoice sent now. Next one on {fecha} at 3:00 PM ET, then every {N} day(s)." (fecha de `computeNextSendUtc`).
- Bloqueo si recurrente pero `intervalDays < 1`.

**`computeNextSendUtc(intervalDays)`**: calcula el próximo envío en UTC anclado a las **3:00 PM America/New_York (Orlando)**, DST-aware. Ese valor se guarda en `recurring_next_send_at`.

### 3.5 Flujo de submit (`handleSubmit`)
1. Validaciones cliente (title, ≥1 item, total>0, email, interval).
2. **INSERT en `invoices`** con:
   ```
   { title, description|null, amount: total, line_items,
     customer_email (lower), customer_name|null, created_by: user?.id,
     // si recurrente:
     is_recurring: true, recurring_interval_days, recurring_active: true,
     recurring_next_send_at: computeNextSendUtc(intervalDays) }
   ```
   `.select().single()` → obtiene `id`.
3. **`supabase.functions.invoke("create-invoice", { invoice_id, customer_email, customer_name? })`** → genera link Stripe + email.
4. Toast "Invoice created & sent" (+ nota recurrente). `resetForm()` + `onSuccess()` (refetch + cierra).

---

## 4. `CreateAddonInvoiceDialog` (add-on sobre un booking)

Archivo: [src/components/admin/CreateAddonInvoiceDialog.tsx](../../src/components/admin/CreateAddonInvoiceDialog.tsx)

Título "Create Add-On Invoice". Se monta desde [BookingDetail.tsx:2442](../../src/pages/admin/BookingDetail.tsx#L2442) con props del booking (`bookingId`, `customerEmail`, `customerName`, `eventDate`, `reservationNumber`, `defaultGuestCount`, `currentBarPackage`).

> A diferencia del standalone: **sin recurrencia** y **sin line items libres**. Es un catálogo fijo.

### 4.1 Sección A — Production Packages (RadioGroup, "per hour")
| value | label | rate default |
|-------|-------|:-----------:|
| `none` | No Package | 0 |
| `basic` | Basic Package — ${rate}/hr | $79 |
| `led` | LED Package — ${rate}/hr | $99 |
| `workshop` | Workshop Package — ${rate}/hr | $149 |

Rates de `usePricing()`. Al elegir ≠ none aparece **Package Time (min 4 hours)** con dos `Input type=time`:
- `packageHours = (end - start)` en horas (0 si inválido).
- Línea viva: "{hours} hours x ${rate}/hr = ${packageCost}", `packageCost = rate * packageHours`.

### 4.2 Sección B — Optional Services (flat-rate)
- **Setup & Breakdown** — `$SETUP` (default $100, de `p.setup_breakdown`).
- **Tablecloth Rental** — `$UNIT each + $CLEANING cleaning fee` (default $5 + $25). Máx 10. Al marcar, aparece "Number of Tablecloths" (`min=1 max=10`, clamp).
- `optionalServicesCost = (setup? cost) + (tablecloths? qty*unit + cleaning)`.

### 4.3 Sección C — Bar Service (RadioGroup, "per guest") — **hardcoded**
| value | label | $/guest |
|-------|-------|:------:|
| `house_beer_wine` | House Beer & Wine | 18.00 |
| `essential_bar` | Essential Bar | 25.63 |
| `signature_bar` | Signature Bar | 32.13 |
| `bespoke_bar` | Bespoke Bar | 39.63 |
| `none` | No Bar Service | — |

- Warning ámbar si el booking ya tiene bar: "⚠️ This booking already has bar service (...). Adding bar via add-on will replace it on payment."
- Al elegir bar aparece "Number of Guests" (`min=1`, default `defaultGuestCount`).
- `barSubtotal = Math.round(rate * guestCount * 100)/100`.

### 4.4 Totales y validación
```
totalAmount   = packageCost + optionalServicesCost + barSubtotal
RATE          = (p.processing_fee || 3.5)/100
processingFee = Math.round(totalAmount * RATE * 100)/100
totalWithFee  = totalAmount + processingFee
```
Errores (`validationError`): nada seleccionado / `packageHours < 4` / bar sin guests / `totalAmount <= 0`.

### 4.5 Submit
1. **INSERT en `booking_addon_invoices`** (package, times, costos, bar_*, `total_amount`, `payment_status: "pending"`), `.select("id").single()`.
2. **`invoke("create-addon-invoice", { invoice_id, customer_email, customer_name, event_date, reservation_number })`**.
3. Toast, `resetForm()`, `onInvoiceCreated()` (refetch).

Botón: "Send Invoice (${totalWithFee})" (deshabilitado con error o enviando).

### 4.6 Estados add-on (en `BookingDetail.tsx:1196`)
`statusColors`: `pending` → `bg-yellow-100 text-yellow-800`; `paid` → `bg-green-100 text-green-800`; `expired` → `bg-gray-100 text-gray-600`. La fila muestra "Payment Link" externo solo si `pending` + `payment_url`.

---

## 5. `InvoiceRevenueView` (reporte de pagadas)

Archivo: [src/components/admin/revenue/InvoiceRevenueView.tsx](../../src/components/admin/revenue/InvoiceRevenueView.tsx). Read-only, recibe `startDate`/`endDate`.

- Datos: `fetchPaidInvoices` ([useRevenueData.ts:283](../../src/hooks/useRevenueData.ts#L283)) — `invoices` where `payment_status="paid"` y `paid_at` en rango.
- Métricas: `totalRevenue = Σ total_charged ?? amount`; `invoiceCount`; `avgPerInvoice`.
- 3 cards: Invoice Revenue / Invoices Paid / Avg per Invoice.
- Tabla: Date Paid · Invoice # · Title (+ "{N} items") · Customer · Amount (+ `${amount} + ${fee} fee`). Footer TOTAL bold.

---

## 6. Hooks relevantes

| Hook | Archivo | Query |
|------|---------|-------|
| `useBookingAddonInvoices(bookingId)` | [useAdminData.ts:705](../../src/hooks/useAdminData.ts#L705) | `booking_addon_invoices` by `booking_id`, desc |
| `fetchPaidInvoices(start,end)` | [useRevenueData.ts:283](../../src/hooks/useRevenueData.ts#L283) | `invoices` pagadas en rango |
| query `["admin-invoices"]` | Invoices.tsx | `invoices.*` desc |

---

## 7. Modelo de fees compartido (TODO el backend)

Todas las funciones de pago usan **exactamente** la misma matemática, en centavos:

```
FEE_PCT  = venue_pricing[item_key='processing_fee', is_active].price   // default 3.5
RATE     = FEE_PCT / 100
baseCents  = Math.round(subtotalDollars * 100)
feeCents   = Math.round(baseCents * RATE)
totalCents = baseCents + feeCents
```

- El fee **siempre** se añade como **line item Stripe separado** llamado `Processing Fee (${FEE_PCT}%)` con `unit_amount = feeCents`. Así `amount_total` de Stripe = subtotal + fee.
- Se persiste: `processing_fee = feeCents/100`, `total_charged = totalCents/100`, `processing_fee_pct = FEE_PCT` (nombres varían por tabla).
- **No hay impuestos Stripe** en ninguna parte (`taxes_fees` es solo display en bookings).
- Ejemplo del test: subtotal $32.57 → 3257c → fee 114c ($1.14) → total 3371c ($33.71).

### Split 80/20 (Stripe Connect)
Si `STRIPE_CONNECTED_ACCOUNT_ID` está seteada: `payment_intent_data.transfer_data.destination = connectedAccountId`, `transfer_data.amount = Math.round(X * 0.20)` (20% al connected, venue queda 80%). **La base del split difiere por función** (intencional y testeado):
| Función | Base del 20% |
|---------|-------------|
| Deposit (`create-checkout`) | `depositAmountCents` (subtotal, sin fee) |
| Balance (`create-balance-payment-link`) | `balanceAmountCents` (subtotal, sin fee) |
| Standalone invoice (`create-invoice`) | `totalWithFeeCents` (**con** fee) |
| Add-on invoice (`create-addon-invoice`) | `totalAmountCentsWithFee` (**con** fee) |

Sin la env → no hay bloque `payment_intent_data` (cargo simple).

**Común a todo:** CORS `*`, Stripe SDK `14.21.0` (API `2023-10-16`), Supabase JS `2.45.0`, email vía denomailer sobre `smtp.gmail.com:465` con `GMAIL_USER`/`GMAIL_APP_PASSWORD`. Origin fallback: `https://vsvsgesgqjtwutadcshi.lovable.app`.

---

## 8. Edge functions

### 8.1 `create-invoice` — standalone
Archivo: [supabase/functions/create-invoice/index.ts](../../supabase/functions/create-invoice/index.ts)
- **Trigger:** POST del frontend + interno desde `process-recurring-invoices` (service-role Bearer). DB con service role.
- **Input:** `{ invoice_id (req), customer_email, customer_name? }`. Falta `invoice_id` → 400.
- **Lógica:**
  1. Fetch `invoices` by id (404 si no).
  2. Resuelve/crea Stripe customer por email.
  3. Fee de `venue_pricing` sobre `invoice.amount`.
  4. Line items: si `line_items` (JSON `{label,amount}[]`) → cada uno; si no, uno solo de `title`/`description`/`amount`. Luego push del **Processing Fee**.
  5. `checkout.sessions.create` (`mode:payment`, card), success `/invoice-paid?...`, cancel `/invoice-cancelled?...`, `metadata: { invoice_id, payment_type:"standalone_invoice", invoice_number }`. Split 80/20 sobre `totalWithFeeCents`.
  6. **UPDATE `invoices`:** `payment_url`, `stripe_session_id`, `processing_fee_pct`, `processing_fee`, `total_charged`.
  7. Email al cliente (subject `Invoice {n} – {total} | Orlando Event Venue`, botón "Pay Now"). Errores de email no fallan la request.
- **Idempotencia:** ninguna al crear; el dedup real ocurre en el webhook (`paid_at`).

### 8.2 `create-addon-invoice`
Archivo: [supabase/functions/create-addon-invoice/index.ts](../../supabase/functions/create-addon-invoice/index.ts)
- **Input:** `{ invoice_id, customer_email, customer_name, event_date, reservation_number }`.
- **Lógica:** carga `venue_pricing` activos → mapa de precios. Fetch `booking_addon_invoices`. Construye line items dinámicos: package (`"{label} ({hours}h)"`), setup, tablecloths (`qty*unit + cleaning`), bar (`"Bar Service — {label}"`). Si no hay items → 400 "No items to charge". Fee sobre suma de items. Session con success `/booking-confirmation?...&type=addon`, `metadata: { booking_id, invoice_id, payment_type:"addon_invoice", reservation_number }`. Split 80/20 sobre total con fee.
- **DB:** UPDATE `booking_addon_invoices` (`payment_url`, `stripe_session_id`, fees). INSERT `booking_events` `addon_invoice_created`.
- Email "Additional Services Invoice – {res#}".

### 8.3 `process-recurring-invoices` — motor recurrente
Archivo: [supabase/functions/process-recurring-invoices/index.ts](../../supabase/functions/process-recurring-invoices/index.ts)
- **Trigger:** **pg_cron** job `process-recurring-invoices-3pm-et`, schedule `0 19,20 * * *` (19:00 y 20:00 UTC = 3 PM Orlando todo el año; la segunda corrida es no-op tras el bump). Migration [20260608120000](../../supabase/migrations/20260608120000_schedule_recurring_invoices_cron.sql). **`config.toml` cron está inactivo aquí** — solo pg_cron corre (ver [[supabase-config-cron-inactive]]).
- **Lógica:**
  1. Query padres due: `recurring_active=true AND recurring_next_send_at <= now()`.
  2. Por cada padre: **clona** en un hijo (copia title/description/amount/line_items/customer, `recurring_parent_id=parent.id`; el hijo NO es recurrente). Llama `create-invoice` para el hijo (service-role Bearer). Avanza el padre con RPC `bump_recurring_next_send` (fallback JS: `+ interval_days*86400000ms`).
  3. Devuelve `{ processed, failed }`.
- **`bump_recurring_next_send(p_invoice_id)`** (SQL `SECURITY DEFINER`): avanza `recurring_interval_days` y re-ancla a **3 PM America/New_York** (DST-safe).
- La frecuencia es solo `recurring_interval_days` (no hay enum de frecuencia en backend).

### 8.4 `create-balance-payment-link` — núcleo del balance
Archivo: [supabase/functions/create-balance-payment-link/index.ts](../../supabase/functions/create-balance-payment-link/index.ts)
- **Trigger:** (a) frontend admin (Authorization header); (b) `schedule-balance-payment` / `process-scheduled-jobs` (header `x-ghl-backend-token`); (c) webhook GHL. **Auth:** `x-ghl-backend-token === GHL_BACKEND_TOKEN` **o** cualquier `authorization` presente; si no → 401. POST only.
- **Input:** `{ booking_id }` (también acepta `customData.booking_id`/`bookingId` de GHL) + `send_email?`.
- **Guards de estado:** `fully_paid` → 400 "already fully paid"; `!= deposit_paid` → 400 "Deposit must be paid before collecting balance". Solo emite cuando el estado es exactamente `deposit_paid`.
- **Lógica:** fee sobre `booking.balance_amount`. `balanceAmountCents <= 0` → 400. Session con 2 line items (Balance Payment + Processing Fee), success `/booking-confirmation?...&type=balance`, `metadata: { booking_id, reservation_number, payment_type:"balance" }`. Split 80/20 sobre `balanceAmountCents` (sin fee).
- **DB:** UPDATE `bookings` (`balance_payment_url`, `balance_link_expires_at`, `balance_fee`, `balance_total_charged`). INSERT `booking_events` `balance_payment_link_created` (channel `admin` si send_email, si no `ghl`).
- **Email:** solo si `send_email === true` (subject `Balance Payment Due – {res#}`). **Los reintentos programados NO mandan este email** — refrescan el link y dependen de GHL.
- **GHL:** siempre `POST /functions/v1/sync-to-ghl { booking_id }` (no fatal).

### 8.5 `schedule-balance-payment` — scheduler de recordatorios
Archivo: [supabase/functions/schedule-balance-payment/index.ts](../../supabase/functions/schedule-balance-payment/index.ts)
- **Trigger:** llamada por `stripe-webhook` tras el depósito (service-role) y por `backfill-balance-scheduling`.
- **Guard de policy:** si `booking_policies.requires_payment === false` → skip.
- **PART 1 (lifecycle):** si `lifecycle_status==="pre_event_ready"` y hay `event_date`, inserta job `set_lifecycle_in_progress` en `scheduled_jobs` (run_at = inicio del evento en Orlando; si no hay `start_time`, 6 AM).
- **PART 2 (balance):** solo si `deposit_paid`. **Dedup:** si ya hay jobs `balance_retry_1|2|3`/`create_balance_payment_link` pending/completed → skip. Calcula `diffDays` (event_date − hoy, Orlando).
  - **Corto plazo (`diffDays <= 15`):** llama `create-balance-payment-link` **de inmediato** (sin send_email → GHL notifica) + programa **1** retry `balance_retry_2` a `now+48h`. Máx 2 links.
  - **Largo plazo (`diffDays > 15`):** programa **3** jobs — `balance_retry_1` en **T-15 días 9 AM Orlando**, `balance_retry_2` = retry1+48h, `balance_retry_3` = retry2+48h.
- **Error:** manda alerta crítica a `orlandoglobalministries@gmail.com` + `booking_events` `schedule_balance_payment_critical_failure`.

**Ejecutor de los jobs:** [process-scheduled-jobs/index.ts](../../supabase/functions/process-scheduled-jobs/index.ts) (cron). Para los tipos de balance: incrementa `attempts`, re-chequea estado — `fully_paid` → job `completed` (skip); `!deposit_paid` → `failed`; si no, llama `create-balance-payment-link` (sin send_email) y marca `completed`.

### 8.6 `send-balance-confirmation` — email "You're Set" + PDF
Archivo: [supabase/functions/send-balance-confirmation/index.ts](../../supabase/functions/send-balance-confirmation/index.ts)
- **Trigger:** POST desde `stripe-webhook` al completarse el balance.
- **Input:** snapshot completo del booking + fees persistidos (`processing_fee_pct`, `balance_fee`, `balance_total_charged`) + breakdown de line items.
- **Lógica:** HTML "You're Set" (Payment Received, resumen 50%+50% "Fully Paid", instrucciones de acceso). **PDF** "BALANCE RECEIPT · Final 50% Payment" (pdf-lib, A4) itemizando cada rubro a Full Price y "50% Paid". Fee usa valores persistidos primero: `feeAmt = balance_fee ?? round(balance_amount*pct/100)`; `totalCharged = balance_total_charged ?? round(balance_amount+feeAmt)`. Si el PDF falla, el email igual se manda sin adjunto + alerta crítica.
- Subject **ASCII puro** (evita corrupción de header denomailer): `You're Set - Access Instructions for Event Day | Orlando Event Venue`.

### 8.7 `backfill-balance-scheduling` — recuperación
Archivo: [supabase/functions/backfill-balance-scheduling/index.ts](../../supabase/functions/backfill-balance-scheduling/index.ts)
- **Barrido de mantenimiento:** bookings en `deposit_paid`, `event_date >= hoy`, sin `balance_payment_url` y sin jobs de balance → llama `schedule-balance-payment { booking_id }`. Devuelve tally `{ total_found, processed, scheduled, skipped, errors, details[] }`. Sin Stripe/email/GHL directo.

### 8.8 `stripe-webhook` — handlers de pago
Archivo: [supabase/functions/stripe-webhook/index.ts](../../supabase/functions/stripe-webhook/index.ts)
- **Auth:** header `stripe-signature` + `STRIPE_WEBHOOK_SECRET`, verifica con `constructEventAsync`. Maneja `checkout.session.completed` y `checkout.session.expired`.
- **Routing** por `metadata.payment_type`. Helper `deriveProcessingFee(amountPaid, base)`: `fee = round(max(0, amountPaid-base))`, `pct = base>0 ? round(fee/base*100) : null`.

| `payment_type` | Qué hace |
|----------------|----------|
| `standalone_invoice` | dedup `invoices.paid_at` → UPDATE `paid`, `paid_at`, `stripe_payment_intent_id`. **2 emails**: interno "INVOICE PAID" + cliente "Payment Confirmation" (usa `total_charged ?? amountPaid`, añade fila `Processing Fee`). INSERT `stripe_event_log`. |
| `addon_invoice` | dedup `booking_addon_invoices.paid_at` → UPDATE `paid`. Propaga a `booking_revenue_items` (`split:"80_20"`): bar (+ campos a `bookings`), production, setup ($75), tablecloths (`qty*5`), misc. `booking_events` `addon_invoice_paid`. Email interno. |
| `balance` | dedup `balance_paid_at` → UPDATE `fully_paid`, `balance_paid_at`, `balance_fee`, `balance_total_charged`. Cancela jobs de balance pending (`payment_completed_before_job_run`). `booking_events` `balance_paid`. Email interno + **`send-balance-confirmation`** al cliente. `sync-to-ghl`. RPC `populate_booking_revenue_items`. |
| `deposit` (else) | dedup `deposit_paid_at` → UPDATE `deposit_paid`, fees. Email interno + confirmación cliente (si policy lo permite). `sync-to-ghl` → **dispara `schedule-balance-payment`** (aquí arranca la cadencia del balance). |
| `session.expired` | solo `standalone_invoice`: UPDATE `invoices` `expired` **where `pending`** (no pisa las pagadas). |

- **Guard de idempotencia:** `stripe_event_log` por `event_id` (rutas de booking) + `paid_at`/`deposit_paid_at`/`balance_paid_at` por registro.
- **Guard de reconciliación:** si `|amountPaid − *_total_charged| > 0.01` → `console.warn("RECONCILE_MISMATCH ...")`.

---

## 9. Base de datos

### 9.1 Tabla `public.invoices`
Migrations: create [20260225191255](../../supabase/migrations/20260225191255_6d996d97-4d7e-432b-8228-1ee1e16b7315.sql) (lineage hash = **la que corre en vivo**), line items [20260226000000](../../supabase/migrations/20260226000000_add_invoice_line_items.sql), recurring [20260227000000](../../supabase/migrations/20260227000000_add_recurring_invoice_columns.sql), fees [20260603172758](../../supabase/migrations/20260603172758_2d093e01-c77e-4522-9e18-f16baac333c4.sql).

| Columna | Tipo | Null | Default | Notas |
|---------|------|:----:|---------|-------|
| `id` | uuid | NO | `gen_random_uuid()` | **PK** |
| `invoice_number` | text | NO | `'INV-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6))` | (lineage manual: trigger `INV-YYYYMMDD-0001`) |
| `title` | text | NO | | |
| `description` | text | SÍ | | |
| `amount` | numeric(10,2) | NO | | subtotal (sin fee) |
| `customer_email` | text | NO | | |
| `customer_name` | text | SÍ | | |
| `payment_status` | text | NO | `'pending'` | **sin CHECK en vivo** (texto libre); valores usados: pending/paid/expired/cancelled |
| `payment_url` | text | SÍ | | link Stripe |
| `stripe_session_id` | text | SÍ | | |
| `stripe_payment_intent_id` | text | SÍ | | |
| `paid_at` | timestamptz | SÍ | | |
| `created_by` | uuid | SÍ | | (sin FK en vivo) |
| `created_at` | timestamptz | NO | `now()` | |
| `updated_at` | timestamptz | NO | `now()` | trigger `update_invoices_updated_at` |
| `line_items` | jsonb | SÍ | | `[{label,amount}]` |
| `is_recurring` | boolean | NO | `false` | |
| `recurring_interval_days` | integer | SÍ | | cadencia en días |
| `recurring_active` | boolean | NO | `false` | el cron lo levanta |
| `recurring_next_send_at` | timestamptz | SÍ | | próximo envío (3 PM ET) |
| `recurring_parent_id` | uuid | SÍ | | self-FK → `invoices(id)` (hijos) |
| `processing_fee_pct` | decimal(5,2) | SÍ | `3.5` | |
| `processing_fee` | decimal(10,2) | SÍ | `0` | |
| `total_charged` | decimal(10,2) | SÍ | | backfill `amount + ROUND(amount*0.035,2)` |

- **FK:** `recurring_parent_id → invoices(id)`.
- **Índices:** `idx_invoices_recurring_due (recurring_next_send_at) WHERE recurring_active`, `idx_invoices_recurring_parent (recurring_parent_id) WHERE recurring_parent_id IS NOT NULL`.
- **RLS (en vivo):** `Admin can manage invoices` (ALL, `has_role(uid,'admin')`) + `Admin and staff can view invoices` (SELECT, `is_admin_or_staff(uid)`).
- **Triggers:** `update_invoices_updated_at` → `update_updated_at_column()`. Helper SQL `bump_recurring_next_send(uuid)` (SECURITY DEFINER, re-ancla 3 PM ET).

### 9.2 Tabla `public.booking_addon_invoices`
Migrations: create [20260219000000](../../supabase/migrations/20260219000000_create_booking_addon_invoices.sql), bar [20260511154723](../../supabase/migrations/20260511154723_2d4e87d4-c0f1-4fc6-845e-4e569548e4e3.sql), fees 20260603*.

| Columna | Tipo | Null | Default | Notas |
|---------|------|:----:|---------|-------|
| `id` | uuid | NO | `gen_random_uuid()` | **PK** |
| `booking_id` | uuid | NO | | **FK → `bookings(id)` ON DELETE CASCADE** |
| `package` | text | NO | `'none'` | |
| `package_start_time` / `package_end_time` | text | SÍ | | |
| `package_cost` | numeric | NO | `0` | |
| `setup_breakdown` | boolean | NO | `false` | |
| `tablecloths` | boolean | NO | `false` | |
| `tablecloth_quantity` | integer | NO | `0` | |
| `optional_services_cost` | numeric | NO | `0` | |
| `total_amount` | numeric | NO | | subtotal |
| `payment_status` | text | NO | `'pending'` | **CHECK `valid_payment_status IN ('pending','paid','expired')`** (sin `cancelled`) |
| `payment_url` / `stripe_session_id` / `stripe_payment_intent_id` | text | SÍ | | |
| `paid_at` | timestamptz | SÍ | | |
| `created_at` | timestamptz | NO | `now()` | |
| `created_by` | uuid | SÍ | | sin FK |
| `bar_package` | text | NO | `'none'` | |
| `bar_package_label` | text | SÍ | | |
| `bar_guest_count` | integer | SÍ | | |
| `bar_rate_per_guest` | numeric | NO | `0` | |
| `bar_subtotal` | numeric | NO | `0` | |
| `processing_fee_pct` | decimal(5,2) | SÍ | `3.5` | |
| `processing_fee` | decimal(10,2) | SÍ | `0` | |
| `total_charged` | decimal(10,2) | SÍ | | backfill `total_amount + ROUND(total_amount*0.035,2)` |

- **Índice:** `idx_addon_invoices_booking_id (booking_id)`.
- **RLS:** `Admin can manage addon invoices` (ALL, role `authenticated`, `is_admin_or_staff(uid)`).
- **Sin triggers propios.**

### 9.3 Line items
**No existe tabla `invoice_line_items`.** Los line items viven en la columna JSONB `invoices.line_items` (nullable, sin default), formato `[{"label":"Venue Rental","amount":1500}, ...]`. Sin FK ni constraints por item.

### 9.4 ⚠️ Migraciones divergentes (Lovable dual-lineage)
Existen dos linajes de migración para `invoices`: los archivos "manuales" (`...000000`) y los hash-named de Lovable. **El schema en vivo sigue el linaje HASH** (confirmado por `types.ts`: tiene `updated_at`, RLS `has_role`/`is_admin_or_staff`, `invoice_number` random MD5, sin CHECK de `payment_status`). El linaje manual (`20260225000000`) tiene trigger de secuencia diaria, RLS `authenticated`, `CHECK(amount>0)`, FK `created_by→auth.users` y **no** está reflejado en vivo. Ambos están commiteados. Tenerlo presente al leer las migraciones.

---

## 10. Flujos end-to-end (resumen)

**Standalone invoice:**
```
Admin → CreateInvoiceDialog → INSERT invoices → invoke create-invoice
     → Stripe Checkout Session + email "Pay Now"
Cliente paga → stripe-webhook (standalone_invoice) → invoices.paid + 2 emails
Expira sin pagar → session.expired → invoices.expired (si pending)
```

**Recurring invoice:**
```
INSERT invoices (is_recurring, recurring_active, recurring_next_send_at=3PM ET)
pg_cron 0 19,20 * * * → process-recurring-invoices
     → clona hijo (recurring_parent_id) → create-invoice (hijo) → bump padre
Detener: botón Square → recurring_active=false
```

**Add-on invoice:**
```
Admin en booking → CreateAddonInvoiceDialog → INSERT booking_addon_invoices
     → invoke create-addon-invoice → Session + email
Cliente paga → stripe-webhook (addon_invoice) → paid + booking_revenue_items
```

**Balance (50% restante):**
```
Depósito pagado → stripe-webhook (deposit) → schedule-balance-payment
     ├─ diffDays<=15: link inmediato + 1 retry (+48h)
     └─ diffDays>15 : retry_1 (T-15d 9AM) + retry_2 (+48h) + retry_3 (+48h)
process-scheduled-jobs ejecuta cada retry → create-balance-payment-link (sin email, GHL notifica)
Cliente paga balance → stripe-webhook (balance) → fully_paid
     → cancela retries pending → send-balance-confirmation ("You're Set" + PDF) → sync-to-ghl
Recuperación: backfill-balance-scheduling re-programa bookings deposit_paid sin link
```

---

## 11. Gotchas / notas cruzadas

- **"Invoices" no usa Stripe Invoices.** Todo son Checkout Sessions con `price_data` inline.
- **El fee siempre es line item visible** → `amount_total` = subtotal + fee. La DB persiste `*_fee`/`*_total_charged` al crear el link; el webhook re-deriva y reconcilia al pagar.
- **Los reintentos de balance no mandan email directo** — refrescan el link y dependen de GHL. Solo `send_email:true` (envío manual admin) o la confirmación de fully-paid emailan al cliente.
- **Cron real:** recurring via pg_cron (`0 19,20 * * *`), no `config.toml` ([[supabase-config-cron-inactive]]). Los jobs de balance corren via tabla `scheduled_jobs` + `process-scheduled-jobs`.
- **Sin impuestos Stripe** en ningún path.
- **Revenue prefiere `total_charged ?? amount`** en frontend (Invoices list, InvoiceRevenueView, useRevenueData).
- Estados: `invoices` acepta `cancelled` (sin UI para setearlo); `booking_addon_invoices` **no** acepta `cancelled` (CHECK).

---

## 12. Índice de archivos

**Frontend**
- [src/pages/admin/Invoices.tsx](../../src/pages/admin/Invoices.tsx)
- [src/components/admin/CreateInvoiceDialog.tsx](../../src/components/admin/CreateInvoiceDialog.tsx)
- [src/components/admin/CreateAddonInvoiceDialog.tsx](../../src/components/admin/CreateAddonInvoiceDialog.tsx)
- [src/components/admin/revenue/InvoiceRevenueView.tsx](../../src/components/admin/revenue/InvoiceRevenueView.tsx)
- [src/pages/admin/BookingDetail.tsx](../../src/pages/admin/BookingDetail.tsx) (add-on ~1169-1248, dialog ~2442)
- [src/hooks/useAdminData.ts](../../src/hooks/useAdminData.ts) · [src/hooks/useRevenueData.ts](../../src/hooks/useRevenueData.ts) · [src/hooks/usePricing.ts](../../src/hooks/usePricing.ts)

**Edge functions**
- [create-invoice](../../supabase/functions/create-invoice/index.ts) · [create-addon-invoice](../../supabase/functions/create-addon-invoice/index.ts) · [process-recurring-invoices](../../supabase/functions/process-recurring-invoices/index.ts)
- [create-balance-payment-link](../../supabase/functions/create-balance-payment-link/index.ts) · [schedule-balance-payment](../../supabase/functions/schedule-balance-payment/index.ts) · [process-scheduled-jobs](../../supabase/functions/process-scheduled-jobs/index.ts)
- [send-balance-confirmation](../../supabase/functions/send-balance-confirmation/index.ts) · [backfill-balance-scheduling](../../supabase/functions/backfill-balance-scheduling/index.ts) · [stripe-webhook](../../supabase/functions/stripe-webhook/index.ts)

**DB**
- [create_invoices_table (hash)](../../supabase/migrations/20260225191255_6d996d97-4d7e-432b-8228-1ee1e16b7315.sql) · [add_invoice_line_items](../../supabase/migrations/20260226000000_add_invoice_line_items.sql) · [add_recurring_invoice_columns](../../supabase/migrations/20260227000000_add_recurring_invoice_columns.sql)
- [create_booking_addon_invoices](../../supabase/migrations/20260219000000_create_booking_addon_invoices.sql) · [bar service](../../supabase/migrations/20260511154723_2d4e87d4-c0f1-4fc6-845e-4e569548e4e3.sql) · [processing fee](../../supabase/migrations/20260603172758_2d093e01-c77e-4522-9e18-f16baac333c4.sql) · [recurring cron](../../supabase/migrations/20260608120000_schedule_recurring_invoices_cron.sql)

**Tests**
- [invoice-fee-integrity.test.ts](../../supabase/functions/_tests/invoice-fee-integrity.test.ts) · [split-payment.test.ts](../../supabase/functions/_tests/split-payment.test.ts)
