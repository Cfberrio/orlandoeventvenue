# Post-mortem: Campaña Google Ads — Junio 2026

**Fecha del análisis:** 9 de julio de 2026
**Campaña:** "Event Venue Orlando" (Performance Max)
**Pregunta central:** entraron muchos leads durante la campaña y no cerraron. ¿Cuántos, dónde se perdieron y qué aprendemos?

---

## 1. Resumen ejecutivo

1. **El popup de descuento estuvo 100% roto durante toda la campaña.** Desde el 29 de mayo (rebrand a HOST100), cada persona que llenó el popup recibió "Something went wrong. Please try again." — el lead no se guardaba, no entraba a GHL y no recibía emails. Causa: la migración que agregaba la columna `event_type` a `popup_leads` nunca se aplicó en producción. Último lead capturado: 28 de mayo. Leads de junio: **cero**. **Corregido y verificado el 9-jul.**
2. **La campaña corrió ciega.** Los dos eventos de conversión configurados en Google Ads (`purchase` y `booking_deposit_paid`) **nunca existieron en el código del sitio**. Google Ads no recibió ni una conversión real en todo el periodo. Smart Bidding optimizó sin señal.
3. **Junio fue el peor mes del año en reservas web** (2 reservas web, y una es una prueba interna de $15), contra un promedio de 10–13/mes entre enero y mayo. Con el canal principal de captura roto y el algoritmo sin datos, era el resultado esperable.
4. **La disponibilidad de fechas es un cuello de botella real:** de 149 leads de 2026 que indicaron fecha preferida, **73 (49%) querían una fecha que terminó reservada por otro cliente**. La mitad de los leads compite por las mismas fechas — la velocidad de seguimiento decide quién cierra.
5. **No podemos atribuir nada a la campaña** porque el sitio no captura UTM ni `gclid`, y **no registramos motivo de pérdida** en ningún punto del funnel (16 cancelaciones del año: cero motivos anotados).
6. El tracking de conversiones ya se **arregló en código** (evento `purchase` implementado el 9-jul, pendiente de deploy). La próxima campaña sí va a medir.

---

## 2. Datos duros (base de datos, tabla `bookings`)

### Reservas por mes — 2026

| Mes | Total | Web | Canceladas | Con cupón |
|---|---|---|---|---|
| Enero | 7 | 7 | 1 | 3 |
| Febrero | 11 | 11 | 5 | 5 |
| Marzo | 12 | 12 | 4 | 8 |
| Abril | 13 | 13 | 4 | 9 |
| Mayo | 13 | 10 | 3 | 8 |
| **Junio (campaña)** | **3** | **2** | **0** | **2** |
| Julio (al día 9) | 5 | 2 | 0 | 0 |

Detalle de junio: 1 reserva externa ($0, Corporate Event), 1 prueba interna ($15, cupón TREL), **1 sola reserva web real** (birthday party, $1,011, cupón SAVE100).

### Funnel web acumulado 2026

- 57 reservas web creadas → 41 activas/confirmadas → 16 canceladas (**28% de cancelación post-depósito**)
- Revenue confirmado: ~$38,700
- **Ninguna cancelación tiene motivo registrado** — el campo de notas internas está vacío en las 16.

### Leads del popup por mes — 2026 (tabla `popup_leads`)

| Mes | Leads | Convertidos | % conversión |
|---|---|---|---|
| Febrero | 24 | 1 | 4.2% |
| Marzo | 58 | 1 | 1.7% |
| Abril | 45 | 3 | 6.7% |
| Mayo | 33 | 5 | 15.2% |
| **Junio (campaña)** | **0** | — | — |

- **Último lead: 28 de mayo, 11 PM.** El 29 de mayo se deployó el rebrand del popup (SAVE100 → HOST100) que empezó a insertar la columna `event_type`; en producción esa columna no existía → todo envío falló desde entonces. Ver sección 3-bis.
- 160 leads en 2026; 9 con reserva real no cancelada (≈6% de conversión lead→reserva).
- De 149 leads con fecha preferida, **73 (49%) pedían una fecha que otro cliente terminó reservando**.

### Señal de cómo se cierra en realidad

35 de 57 reservas web usaron cupón, y la mayoría son **códigos personalizados creados a mano** (BABY, MARI, ISAAC, CAREACCESS, SAVE100…). Traducción: los cierres pasan por **conversación directa con el dueño + cupón a medida**. El cupón automático del popup (SAVE50) solo cerró **2 reservas en el año** — el drip automático casi no convierte solo.

### Lo que la base de datos NO tiene (y dónde está)

| Dato faltante | Dónde vive | Cómo obtenerlo |
|---|---|---|
| Llamadas generadas por la campaña | Google Ads → conversion action "Phone call leads" | Ads UI, filtrar junio |
| Tours / contactos / seguimiento | GoHighLevel (CRM) | Revisar pipeline de junio en GHL |
| Formulario de contacto | Solo se envía por email (no se guarda en DB) | Bandeja de entrada |

(Los leads del popup ya se analizaron el 9-jul vía acceso directo a la DB; queries reutilizables en [ANALISIS-LEADS-CAMPANA-JUNIO.sql](../../scripts/sql/diagnostics/ANALISIS-LEADS-CAMPANA-JUNIO.sql).)

---

## 3. Causa raíz: por qué "no se veían conversiones"

Verificado en el código el 9 de julio:

1. **El evento `purchase` no existía.** El único tag en el sitio era el snippet base de GA4 (`G-8D4SSYMCNP` en `index.html`) que solo manda page views. Cero llamadas `gtag()` de eventos en todo el código.
2. **`booking_deposit_paid` tampoco existe** ni en el sitio ni en el backend. La conversion action de Ads que apunta a ese evento nunca pudo recibir datos.
3. **Stripe rompe la atribución.** El cliente sale a `checkout.stripe.com` a pagar y vuelve; sin `stripe.com` en "unwanted referrals" de GA4, la sesión de regreso se atribuye a Stripe y no al anuncio.
4. **Dominio `.lovable.app` sin declarar** en configuración cross-domain del tag (aviso "Needs Attention" en Tag Quality).

> Nota sobre la llamada con el rep: su hipótesis fue que el aviso salía "por inactividad / falta de conversiones recientes". La causa real es que el evento jamás se implementó — no es inactividad, es ausencia. Llevar este dato a la reunión técnica del lunes ahorra la mitad de esa reunión.

**Estado del fix (9-jul):** evento `purchase` implementado en `src/lib/analytics.ts` + `BookingConfirmation.tsx`. Valor = depósito cobrado, `transaction_id` = número de reserva (deduplica), solo dispara en el checkout inicial (no en pagos de balance ni addons). **Pendiente: deploy.**

## 3-bis. Causa raíz #2: el popup roto (el hallazgo más grave)

**Qué pasó:** el 29 de mayo se deployó el rebrand del popup de descuento (commit `f6eb822`, SAVE100 → HOST100). El nuevo código inserta el campo `event_type` en la tabla `popup_leads`. La migración que agrega esa columna existía en el repo (`20260529160000_add_event_type_to_popup_leads.sql`) pero **nunca se aplicó en la base de producción** — las migraciones escritas a mano no se aplican solas en este proyecto (mismo patrón del pg_cron de facturas recurrentes que hubo que registrar manual en junio).

**Efecto:** todo INSERT del popup falló ("column does not exist") desde el 29 de mayo hasta el 9 de julio. El visitante veía "Something went wrong. Please try again.". Además, por el orden del código, al fallar el insert **tampoco** se sincronizaba el contacto a GHL ni se enviaba el email con el cupón. Pérdida total y silenciosa del canal, durante las 6 semanas que incluyeron toda la campaña de Ads.

**Dimensión:** a ritmo de marzo–mayo (33–58 leads/mes), se perdieron estimados **40–90 leads** — y esos eran precisamente los visitantes que la campaña pagó por traer.

**Fix (9-jul):** columna `event_type` agregada en producción vía SQL. Verificado end-to-end simulando el envío exacto del popup (HTTP 201, fila de prueba borrada). El popup captura leads de nuevo desde ya — no requiere deploy.

**Prevención:** después de cada deploy que incluya migración escrita a mano, aplicarla en Supabase Dashboard → SQL Editor y verificar. Mejor aún: probar el popup en producción (modo incógnito) después de cualquier cambio que lo toque.

---

## 4. ¿En qué punto del funnel se perdieron los leads?

Funnel completo y qué sabemos de cada etapa:

```
Click en anuncio → Visita al sitio → Lead (popup / llamada / form / tour GHL)
    → Conversación → Selección de fecha → Checkout Stripe → Depósito → Evento
```

| Etapa | ¿Medible hoy? | Qué sabemos |
|---|---|---|
| Click → visita | Sí (Ads/GA4) | Revisar en Ads: clicks e impresiones de junio |
| Visita → lead popup | Sí (DB) | **Junio: 0 leads — el popup estuvo roto todo el mes** (sección 3-bis). Feb–may: 24–58 leads/mes |
| Lead → conversación | **No** | GHL/email — sin registro estructurado de respuesta |
| Conversación → fecha | Parcial | **49% de los leads del año pedían fecha que otro cliente terminó tomando** — la disponibilidad y la velocidad de respuesta pesan mucho |
| Fecha → checkout | **No** | No hay evento `begin_checkout`; reservas abandonadas antes de pagar no dejan fila |
| Checkout → depósito | Sí (DB) | Junio: 1 reserva web real |
| Depósito → evento | Sí (DB) | 28% cancela después de pagar depósito, sin motivo registrado |

**Respuesta a "¿dónde se perdieron los leads de junio?":** en la primera etapa del funnel. El canal de captura estaba caído — quien intentó dejar sus datos recibió un error. Los leads que sí llegaron por otros canales (llamadas de Ads, formulario de contacto por email, GHL) no quedaron registrados con motivo de cierre/pérdida, así que ahí el análisis depende de revisar GHL y la bandeja de entrada de junio uno a uno, marcando: `no respondió / fecha ocupada / precio / otro`.

**Sobre las hipótesis originales:** el dato del 49% de fechas tomadas (año completo) sugiere que "no tenían fecha disponible" es un motivo real y grande de no-cierre en general — pero para junio específicamente el problema fue anterior: los leads ni siquiera entraron al sistema.

---

## 5. Conclusiones de la llamada con Google Ads (9-jul-2026)

**Verificado en la llamada:** data de GA4 fluye; "user-provided data collection" quedó activado; conversion sources (Purchase, Phone calls, Contact) conectados pero sin datos.

**Compromisos y fechas:**

| Qué | Cuándo |
|---|---|
| Reunión con equipo técnico de conversiones (confirmar asistencia en el email de invitación — click "Yes") | **Lunes 14-jul, 3:30–4:00 PM** |
| Follow-up con el rep y su manager ("Bond") | **Lunes 20-jul, misma hora** |
| Rep monitorea la campaña reactivada 1–2 días; si `purchase` no registra, escala | Esta semana |

**Recomendaciones del rep (en orden de valor real):**

1. **Campaña Search con keywords** además de la PMax — más directa, se controla el intent exacto de búsqueda. Introducirla con presupuesto propio cuando haya data.
2. **Signals de la PMax:** en Asset groups → Signals → añadir in-market segments y sitios web de 1–2 competidores ("people who browse types of websites").
3. **Asset group pausado por imágenes religiosas:** despausar; si el sistema vuelve a flaggear, el rep abre caso de revisión manual (las políticas no prohíben el negocio — es falso positivo del filtro automático). Alternativa rápida: reemplazar la imagen flaggeada.
4. Estrategia de puja futura (tCPA / tROAS) se decide en el follow-up **cuando ya haya conversiones reales fluyendo**.

---

## 6. Aprendizajes y plan para la próxima campaña

### Antes de gastar $1 más en Ads (bloqueantes)

- [x] **Popup reparado** (columna `event_type` aplicada en prod y verificada, 9-jul) — vuelve a capturar leads
- [ ] Probar el popup en producción en modo incógnito (confirmación visual de 2 minutos)
- [ ] **Deploy del evento `purchase`** (código listo, falta push)
- [ ] Verificar con una reserva de prueba en GA4 → Realtime/DebugView que `purchase` llega con valor
- [ ] GA4: marcar `purchase` como **key event**
- [ ] GA4: borrar reglas "Create event" fantasma si existen (Admin → Events → Create event)
- [ ] GA4: `stripe.com` en **unwanted referrals**
- [ ] GA4: dominios cross-domain (`Ends with orlandoeventvenue.org` + `Exactly matches orlandoeventvenue.lovable.app`)
- [ ] Ads: dejar **una sola** conversion action Primary (`Purchase`); `booking_deposit_paid` → Secondary o eliminar

### Para poder responder "por qué no cierran" la próxima vez (instrumentación)

- [ ] **Capturar UTM + `gclid`** en `popup_leads` y `bookings` — sin esto nunca sabremos qué lead vino de Ads (implementable en el código del sitio)
- [ ] Añadir evento `generate_lead` (popup) y `begin_checkout` (inicio de pago) para ver el funnel completo en GA4
- [ ] Campo `cancellation_reason` obligatorio al cancelar una reserva (hoy: 16 cancelaciones, 0 motivos)
- [ ] Disciplina en GHL: todo lead de campaña se marca con resultado — `no respondió / fecha ocupada / precio / cerró / otro`
- [ ] **Proceso post-deploy:** toda migración escrita a mano se aplica en Supabase SQL Editor y se verifica (dos incidentes ya por esto: pg_cron de facturas en junio, popup roto 6 semanas)
- [ ] Alerta de canal caído: si `popup_leads` pasa X días sin filas nuevas, avisar (se puede añadir al health check diario existente)

### Sobre la estrategia de campaña

- **PMax sin conversiones = tirar presupuesto.** El algoritmo necesita la señal de `purchase` para aprender. Con volumen bajo (~10 reservas/mes), considerar arrancar la próxima con Search + keywords exactas (más control) y dejar PMax cuando haya ≥15–30 conversiones/mes de historial.
- **El cierre real es humano.** Los datos muestran que el sitio cierra vía conversación + cupón personalizado. La campaña debe medirse también por leads (llamadas + popup + form), no solo por compra online — pero cada lead necesita seguimiento con resultado registrado.
- **El drip del popup (SAVE50) casi no convierte solo** (2 reservas/año). Revisar copy/oferta o tratarlo como generador de lista para seguimiento manual, no como máquina de cierre.
- **Estacionalidad:** comparar junio 2026 contra junio 2025 antes de culpar solo a la campaña — puede haber componente estacional. (Dato no disponible en este análisis.)

---

## Anexo: queries de leads

Los números de este documento salen de la base de producción (9-jul-2026). Para re-correr o profundizar (detalle lead a lead, cruce de fechas): Supabase Dashboard → SQL Editor → [`scripts/sql/diagnostics/ANALISIS-LEADS-CAMPANA-JUNIO.sql`](../../scripts/sql/diagnostics/ANALISIS-LEADS-CAMPANA-JUNIO.sql)
