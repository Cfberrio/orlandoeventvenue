# Google Tags — Setup completo de conversiones (GA4 + Google Ads)

> Estado al 2026-07-22. Código listo en el repo; faltan pasos manuales en las
> UIs de Google Ads y GA4 (marcados como ⚠️ PENDIENTE).

---

## 1. Cómo funciona el tracking hoy (arquitectura)

### Flujo de una conversión

```
Usuario hace clic en anuncio de Google
  → llega a orlandoeventvenue.org?gclid=XXXX
  → gtag.js guarda el gclid en cookies (_ga, _gcl_aw)
  → usuario llena el booking form
  → redirect a checkout.stripe.com (paga el depósito)
  → Stripe lo devuelve a /booking-confirmation?session_id=...&booking_id=...
  → la página espera 2s (webhook), carga el booking desde Supabase
  → dispara DOS eventos:
      1. GA4 `purchase`            → propiedad G-8D4SSYMCNP
      2. Google Ads `conversion`   → tag AW-XXXX (cuando esté configurado)
```

### Piezas en el código

| Pieza | Archivo | Qué hace |
|---|---|---|
| Tag base GA4 | `index.html` (`G-8D4SSYMCNP`) | Carga gtag.js, mide pageviews, guarda gclid |
| Config Ads tag | `src/lib/analytics.ts` → `googleAds` + `initGoogleAdsTag()` | Registra el tag AW al arrancar la app (llamado desde `src/main.tsx`) |
| Evento purchase | `src/lib/analytics.ts` → `trackPurchase()` | GA4 `purchase` + Ads `conversion`, valor = depósito |
| Disparo | `src/pages/BookingConfirmation.tsx` | Solo depósito inicial (`session_id` presente, sin `type=balance/addon`, sin `cancelled`) |

### Protecciones ya implementadas

- **Dedupe local**: `localStorage` evita re-disparo al refrescar la página.
- **Dedupe de Google**: `transaction_id` = número de reserva (ej. `OEV-1042`);
  Google descarta duplicados con el mismo id.
- **No cuenta pagos de balance ni addons** como conversiones nuevas.
- **Seguro sin configurar**: mientras `googleAds.id` / `purchaseLabel` estén
  vacíos, solo dispara GA4. Se puede deployar sin riesgo.

---

## 2. ⚠️ PENDIENTE — Pasos manuales (en orden)

### Paso 1 — Crear la acción de conversión en Google Ads

1. Google Ads → **Goals → Conversions → Summary → + New conversion action**.
2. Tipo: **Website** → ingresar `orlandoeventvenue.org`.
3. Si ofrece "crear eventos automáticamente", elegir **agregar manualmente**.
4. Configuración recomendada:
   - **Goal**: Purchase
   - **Conversion name**: `Booking Deposit Paid`
   - **Value**: "Use different values for each conversion" (el código manda el depósito real)
   - **Count**: **One** (una reserva = una conversión, aunque el evento se repita)
   - **Click-through conversion window**: 90 días (bookings se deciden lento)
   - **Attribution model**: Data-driven
5. Al terminar → **Tag setup → "Use Google tag manager / Install the tag yourself"**
   → ahí aparecen los dos valores que necesitamos:
   - **Conversion ID**: `AW-XXXXXXXXX`
   - **Conversion label**: cadena tipo `AbCdEfGh1jKLmN0pQrS`

### Paso 2 — Pegar ID y label en el código

En `src/lib/analytics.ts`:

```ts
export const googleAds = {
  id: "AW-XXXXXXXXX",              // ← Conversion ID
  purchaseLabel: "AbCdEfGh1jKLmN0pQrS", // ← Conversion label
};
```

Commit + deploy. Nada más — el resto del código ya lo usa.

### Paso 3 — Excluir stripe.com como referral en GA4 (crítico)

Sin esto, la sesión que vuelve de Stripe se atribuye a "stripe.com / referral"
y **Google Ads pierde el crédito de la conversión** aunque el evento sí llegue.

1. GA4 → **Admin → Data collection and modification → Data streams** → el stream web.
2. **Configure tag settings → Show all → List unwanted referrals**.
3. Agregar: `stripe.com` (condición "referral domain contains").
4. Guardar.

### Paso 4 — Marcar `purchase` como key event en GA4

1. GA4 → **Admin → Events** → buscar `purchase`.
2. Activar el toggle **"Mark as key event"**.
   (Si no aparece aún, esperar a que registre al menos un evento; `purchase`
   es evento estándar de ecommerce y normalmente ya viene marcado.)

### Paso 5 — Verificar el link GA4 ↔ Google Ads

1. GA4 → **Admin → Product links → Google Ads links** → debe existir el link
   a la cuenta de Ads con "Enable personalized advertising" activo.
2. Si no existe: **Link** → elegir la cuenta → confirmar.

### Paso 6 — Evitar doble conteo (importante si importas de GA4)

Ahora hay dos caminos por los que Ads puede recibir la misma conversión:

- **Tag directo AW** (lo que instalamos) — el recomendado.
- **Import de GA4** (si el key event `purchase` está importado en Ads).

Regla: en Google Ads → Goals → Conversions, deja **solo UNA como "Primary"**:

- `Booking Deposit Paid` (tag AW) → **Primary** (cuenta para bidding y columna "Conversions").
- El import de GA4 `purchase` (si existe) → **Secondary** (solo observación).

Google además dedupea por `transaction_id`, pero primary/secondary es lo que
evita inflar los números del campaign.

---

## 3. Cómo verificar que funciona (sin pagar de verdad)

1. **Tag Assistant** ([tagassistant.google.com](https://tagassistant.google.com)):
   conectar `orlandoeventvenue.org` → debe aparecer el tag `G-8D4SSYMCNP` **y**
   el `AW-XXXXXXXXX` después del deploy del Paso 2.
2. **GA4 DebugView** (Admin → DebugView) con la extensión Google Analytics
   Debugger: navegar el sitio y ver los eventos en vivo.
3. **Prueba real controlada**: hacer un booking de prueba con pago real mínimo
   (luego reembolsar en Stripe). En la página de confirmación, abrir DevTools →
   Network → filtrar `google` → deben salir requests a
   `google-analytics.com/g/collect` (GA4) y `googleadservices.com/pagead/conversion`
   (Ads). El reembolso NO borra la conversión — está bien para probar.
4. **Google Ads → Goals → Conversions**: el status de la acción pasa de
   "Inactive/Unverified" a "Recording conversions" tras la primera conversión
   (puede tardar hasta 24 h en reflejarse).

---

## 4. Contexto global — cosas que hay que saber

### Por qué el tag directo AW y no solo GA4 import

- El import GA4 → Ads depende de 3 configuraciones manuales encadenadas
  (key event + link + import). Si una falla, Ads reporta 0 silenciosamente.
  Eso es exactamente lo que pasó con la campaña de junio 2026.
- El tag directo reporta a Ads sin intermediarios y con menos retraso
  (~3 h vs hasta 24 h del import).

### Limitaciones del tracking client-side (lo que tenemos)

- **Depende del regreso a la página de confirmación**: si el usuario paga en
  Stripe y cierra la pestaña antes del redirect, la conversión se pierde.
- **Ad blockers** (uBlock, Brave) bloquean gtag.js → conversión perdida.
- Pérdida típica: 10–30 % de conversiones reales.
- **Mejora futura (server-side)**: el webhook de Stripe
  (`supabase/functions/stripe-webhook`) sabe con certeza cuándo se pagó.
  Desde ahí se puede mandar la conversión por:
  - GA4 **Measurement Protocol** (API server-to-server), o
  - Google Ads **offline conversion import** (requiere guardar el `gclid`
    en la tabla `bookings` al crear el booking).
  Con el mismo `transaction_id`, Google dedupea contra el evento del navegador —
  se puede tener ambos sin doble conteo.

### Atribución y gclid

- Cuando alguien hace clic en un anuncio, la URL trae `?gclid=...`. gtag.js lo
  guarda en la cookie `_gcl_aw` (90 días). La conversión posterior se une a ese
  clic aunque pasen días.
- Por eso `initGoogleAdsTag()` corre **al arrancar la app** (main.tsx) y no solo
  en la página de confirmación: el tag tiene que estar activo en la landing
  para capturar el gclid.
- La ventana de conversión (Paso 1) define cuántos días después del clic la
  conversión todavía se acredita a la campaña.

### Consent mode

- Aplica a tráfico de EEA/UK (GDPR). El negocio es Orlando/US → no se requiere
  hoy. Si algún día corre ads en Europa, hay que implementar Google Consent
  Mode v2 antes.

### Enhanced conversions (mejora opcional)

- Mandar email/teléfono hasheados junto con la conversión mejora el matching
  cuando las cookies fallan. El booking form ya captura email — se puede
  agregar con `gtag('set', 'user_data', {...})` + activar Enhanced Conversions
  en la acción de conversión de Ads. Recomendado como segundo paso.

### Historial (para no repetir errores)

- **Junio 2026**: campaña corrió SIN ningún evento de conversión funcionando.
- **2026-07-09**: se agregó el evento GA4 `purchase` (client-side).
- **2026-07-22**: se agregó el tag directo de Google Ads en código (este doc);
  pendiente crear la acción en Ads y pegar ID/label (Pasos 1–2).

---

## 5. Checklist rápido

- [ ] Paso 1 — Crear conversion action en Google Ads → obtener `AW-ID` + label
- [ ] Paso 2 — Pegar valores en `src/lib/analytics.ts` → deploy
- [ ] Paso 3 — Excluir `stripe.com` de referrals en GA4
- [ ] Paso 4 — `purchase` marcado como key event en GA4
- [ ] Paso 5 — Link GA4 ↔ Google Ads verificado
- [ ] Paso 6 — Solo el tag AW como conversión Primary
- [ ] Verificación con Tag Assistant + booking de prueba
- [ ] (Futuro) Conversión server-side desde stripe-webhook
- [ ] (Futuro) Enhanced conversions con email hasheado
