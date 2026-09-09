# Guía de Features — OEV (para replicar a otro venue)

Inventario funcional completo del sistema actual. **Solo funcionalidad, sin código.** Sirve de checklist para duplicar el sistema a otro venue. Al final, sección de **puntos de adaptación** donde el otro venue difiere (4 espacios en vez de 1, cleaning view distinto, etc.).

Leyenda: **[P]** = feature principal · **[S]** = feature secundario/acción dentro de otro · **[A]** = automático/no visible (corre solo en backend).

---

## PARTE A — DASHBOARD DE ADMINISTRADOR

Sidebar con **12 secciones**. Detalle por sección:

### 1. Dashboard (overview) **[P]**
Pantalla de inicio operativa, en tiempo real.
- Cards arriba: bookings de hoy, revenue de la semana, total del pipeline, contador de alertas.
- **[S]** Card de código de acceso del venue (gestionar el código de entrada).
- **[S]** Alertas de staff que se desasignó solo de un booking (+ botón "marcar resuelto").
- **[S]** Alertas de issues (reportes de limpieza o de invitados que requieren atención).
- **[S]** Próximos 5 bookings con link al detalle.
- **[S]** Resumen del pipeline por estado de ciclo de vida.
- **[S]** "Eventos no listos" — bookings en los próximos 3 días sin marcar como listos.

### 2. Bookings (lista) **[P]**
Gestión y filtrado de todas las reservas.
- **[S]** Filtros: rango de fecha de reserva, estado de ciclo de vida, estado de pago, tipo de evento, nombre de cliente, orden (por fecha/nombre, asc/desc), botón limpiar filtros.
- **[S]** Agrupado por estado de ciclo de vida con conteos. Subgrupo "Leads" (pending sin depósito) resaltado en rojo. Sección aparte para bookings internos y para invoices recurrentes/internas.
- Columnas: reservado el, fecha del evento, cliente, evento, # invitados, estado de pago, total, fecha depósito pagado, fecha balance pagado, botón ver.
- **[S]** Tabla aparte de invoices recurrentes (número, cliente, título, monto, frecuencia, próximo envío, activo/pausado).

### 3. Detalle de Booking **[P]**
Gestión completa de una reserva. **4 pestañas**:

**Pestaña Review:**
- Card de contacto (nombre, email, teléfono, empresa).
- Card de detalles del evento (fecha, hora, tipo, # invitados, tipo de booking: por hora / día completo).
- Card de servicios y add-ons (paquete, horas, setup & breakdown, manteles, servicio de cerveza/vino, notas del cliente).
- **[S]** Card de configuración de producción (solo bookings externos): paquete de producción, horas, botón para editar/configurar (con validación de mínimo 4 horas).
- Card de resumen de pago: desglose (renta base, paquete, fee de limpieza, servicios opcionales, bar, descuento, processing fee, total, depósito, balance), badge de estado de pago.
  - **[S]** Botón de override manual de depósito (si está pending).
  - **[S]** **Botón "enviar link de pago del balance"** (si depósito ya pagado) ← *balance manual*.
- Card de servicio de bar (paquete, # invitados, tarifa por invitado, subtotal).
- **[S]** Card de **add-on invoices**: lista de invoices por servicios extra sobre el booking, con estado y link de pago + **botón "crear invoice"**.

**Pestaña Checklist:**
- **[S]** Checklist de confirmación (si pending): disponibilidad de horario, de staff, sin conflictos → auto-confirma al marcar todo.
- **[S]** Cierre post-evento (si post_event): checkbox de "review recibido" → auto-cierra.
- **[S]** Card de estado pre-evento + botón "marcar listo para el evento".

**Pestaña Staff:**
- Tabla de asignaciones (miembro, rol, horario, detalles de limpieza, tareas de asistente, botón borrar).
- **[S]** Formulario para agregar asignación:
  - Custodial: tipo de limpieza (Touch-Up $40 / Regular $80 / Deep $150) + surcharge de celebración ($20–$70) + preview de payroll.
  - Asistente: panel de tareas (default "montar/desmontar mesas y sillas", agregar/quitar) + payroll estimado.
  - Producción/otro: agregar directo.

**Pestaña Reports:**
- **[S]** Card de estado de sincronización (reporte de invitado, reporte de limpieza, estado de ciclo de vida, botón "forzar sync").
- **[S]** Sección expandible de reporte de invitado.
- **[S]** Sección expandible de reporte de limpieza (checklist + fotos antes/después).

**Acciones de header (sobre el booking):**
- **[S]** **Reschedule** — diálogo con fecha, hora inicio/fin, motivo, validación de conflictos.
- **[S]** **Cancelar booking** — diálogo de confirmación (campos opcionales de Stripe, muestra jobs que se eliminan).
- **[S]** Selector de estado para cambiar el ciclo de vida manualmente.

### 4. Schedule (calendario) **[P]**
Gestión visual de reservas y disponibilidad.
- Toggle vista semana/mes, navegación prev/next.
- **[S]** Toggles de visibilidad: bookings, limpieza, bloqueos, bookings de web, internos, externos.
- Eventos con código de color por origen y por estado; click → detalle.
- **[S]** **Crear booking interno** y **crear booking externo** (wizards): tipo (hora/día), fecha con chequeo de disponibilidad, horas, duración (para recurrentes: 1 día / 1 semana / 2 semanas / 1 mes), # invitados, tipo de evento, datos del cliente, notas. Valida conflictos, solapamientos, fechas bloqueadas y llenas.

### 5. Staff **[P]**
Directorio y gestión de personal.
- Filtros por rol y estado (activo/inactivo/todos).
- Tabla: nombre, rol, email, teléfono, estado, editar/borrar.
- **[S]** Alta/edición de staff (nombre, email, teléfono, rol, activo).
- Roles: Custodial, Producción, Asistente, Bar Vendor.

### 6. Reports (revenue) **[P]**
Análisis financiero/de ingresos.
- Date range picker + **[S]** export CSV.
- **[S]** Pestañas: revenue diario, totales diarios, revenue mensual, breakdown por categoría, análisis por segmento, **revenue de invoices** (standalone).

### 7. Payroll **[P]**
Seguimiento de pagos a staff.
- Date range picker.
- Cards resumen: total adeudado, pagado, pendiente, # staff.
- **[S]** Pestañas: overview, asignaciones standalone (no ligadas a booking).
- Línea por staff (nombre, rol, monto, estado pagado/pendiente, marcar pagado).
- **[S]** Export CSV.

### 8. Cleaning (limpieza) **[P]**
Reportes y documentación de limpieza post-evento.
- Filtros: rango de fecha, estado, cleaner.
- Tabla: booking, estado, staff, fecha, ver.
- **[S]** Modal de detalle: **checklist de 10 ítems** (pisos, baños, cocina, basura, equipo guardado, mesas/sillas, luces, puerta oficina, puerta frente con llave, deep cleaning) + **6 categorías de fotos** (puerta frente, área principal, rack mesas/sillas, baños, cocina, deep cleaning).
> ⚠️ El otro venue maneja el cleaning view **distinto** — ver Parte C.

### 9. Inventory **[P]**
Equipo y suministros del venue.
- Filtros por ubicación, estado (todo/stock/bajo/agotado), vista detallada/simple.
- KPIs: total ítems, bajo stock, agotados.
- Inventario por ubicación (secciones colapsables).
- Tabla: producto, cantidad, min/max, estado, editar/borrar.
- **[S]** Diálogos: agregar/editar stock, gestionar productos, gestionar ubicaciones, export.

### 10. Discounts (cupones) **[P]**
Gestión de códigos de descuento.
- Tabla: código, tipo (% o monto fijo), valor, aplica a (hora/día/todos), activo, editar/borrar.
- **[S]** Alta/edición de cupón (código, tipo, valor, aplica a, activo).
- Hay cupones de referencia hardcodeados (ej. CHRIS 40% hora, NANO 50% hora+día, 199 = $199 off fee de limpieza).

### 11. Invoices (standalone) **[P]**
Crear y gestionar invoices **no ligadas a un booking**.
- Cards: pending, pagadas, revenue de pagadas, recurrentes activas.
- Tabla: número, título, cliente, monto (con desglose de fee), estado, fecha creada/pagada.
- **[S]** Acciones por invoice: copiar link de pago, abrir link, **duplicar**, **detener recurrente**, borrar.
- **[S]** **Invoice recurrente**: toggle, frecuencia (semanal / quincenal / mensual / días custom), badge con próximo envío, auto-envío.
- **[S]** **Crear invoice**: título, descripción, line items (agregar/quitar label+monto), email y nombre del cliente, toggle recurrente + frecuencia, cálculo de total. Manda link de pago por email.

### 12. Analytics **[P]**
Tracking de leads y conversión.
- Stats: total leads, leads del mes, tasa de conversión, revenue de leads convertidos.
- Charts: leads en el tiempo (6 meses), fuentes de leads, agregación semanal.
- Tabla de leads (email, fuente, fecha, estado de conversión, link a booking si convirtió), paginada.
- Funnel: leads → enviados → bookings → revenue.

### 13. Pricing (config de precios) **[P]**
Gestión de servicios y fees del venue. **Todo editable sin redeploy.**
- Categorías: renta del venue, paquetes de producción, servicios opcionales, fees & porcentajes.
- Tabla: label, categoría, descripción, precio, unidad (hora/unidad/flat/%), fee extra, activo, orden, editar/borrar.
- **[S]** Alta/edición de ítem de precio.
- Ítems gestionados: tarifa por hora, tarifa por día, fee de limpieza, paquetes (Basic/LED/Workshop), setup & breakdown, manteles, bar, **processing fee %**, add-ons.

### Features transversales del admin
- **Pagos/invoices**: invoices one-time, recurrentes, add-on (sobre booking existente); mandar/copiar links; estados de pago; override manual de depósito; **generación y envío del link de balance**.
- **Ciclo de vida del booking**: crear (interno/externo/web), reschedule con chequeo de conflictos, cancelar (borra jobs + notifica), 7 estados, checklist pre-evento, cierre post-evento.
- **Staff & payroll**: asignar por rol, tipo de limpieza + surcharges, tareas de asistente, estimados de payroll, estado pagado/pendiente, alertas de desasignación, notificación al staff.
- **Reportes/alertas**: alertas en dashboard (desasignación, issues, eventos no listos), revenue (diario/mensual/categoría/segmento), payroll, limpieza con fotos, reportes de invitado, sync de host report con GHL.
- **Export CSV**: revenue, payroll, inventario.

---

## PARTE B — FRONTEND PÚBLICO (cliente)

### Visibles (UI que ve el cliente)

**Homepage**
- Hero con CTA "Book Now" + stats clave.
- Highlights del espacio (parking, prep kitchen, ubicación, reviews) + amenidades incluidas.
- Pricing: card por hora (mín 4 h) y card por día (24 h, "más popular").
- Add-ons: paquetes de producción (Basic/LED/Workshop), opciones de bar, extras (setup, manteles).
- Galería, "cómo funciona" (4 pasos), FAQ, CTA agendar tour, formulario de contacto, footer legal.

**Popup de lead (DiscountPopup)** **[P]** — *ya lo tienen*
- Modal auto-dispara a los 5 s. Oferta "$100 off" con código HOST100.
- Captura: nombre, email, teléfono (validación US), tipo de evento, consentimiento SMS/email.
- Estado de éxito + siguientes pasos (book now / book tour).

**Agendar tour (ScheduleTour)** **[P]**
- Calendario embebido de GoHighLevel (iframe).

**Formulario de contacto (ContactForm)** **[P]** — *falta crear en el otro venue*
- Campos: nombre, email, teléfono, asunto (dropdown), fecha del evento, mensaje, 2 consentimientos (SMS transaccional + marketing).
- Honeypot anti-spam, estados de envío, mensaje de éxito, links legales.

**Flujo de booking (/book) — 6 pasos** **[P]**
1. **Tipo de booking**: por hora (mín 4 h) o por día (24 h). Date picker (deshabilita pasadas y llenas). Horas inicio/fin si es por hora. Aviso de conflicto de horario. Barra de progreso. Soporta `?type=hourly|daily`.
2. **Invitados y evento**: # invitados (1–90), tipo de evento (dropdown + "otro" custom), descripción (10–1000 chars con contador).
3. **Add-ons y paquetes**: paquete de producción (No/Basic/LED/Workshop), horas del paquete (mín 4 h, no excede la renta), setup & breakdown, manteles (cantidad + fee), servicio de bar (4 opciones, precio por invitado), # invitados del bar.
4. **Resumen y precio**: desglose completo (renta base, fee limpieza, paquete, servicios, bar, descuento, subtotal, processing fee, **depósito 50%**, **balance 50%** con "vence 15 días antes"). **[S]** Campo de código de descuento + validación. Botones para volver a editar pasos.
5. **Contacto y políticas**: datos del cliente; reglas del venue & fee schedule (con checkbox obligatorio); consentimiento SMS; checkbox de cerveza/vino; **firma**: iniciales, nombre del firmante, fecha, canvas de firma (dibujo + limpiar), texto legal.
6. **Pago**: resumen del depósito a pagar hoy + balance futuro; banner "pago seguro vía Stripe"; botón "pagar $X". Tras pago: estado de éxito con # de reserva, desglose, "qué sigue" (4 pasos), volver al home.

**Página de confirmación (/booking-confirmation)** **[P]**
- Loading → éxito (# reserva con copiar, detalles, resumen de pago, "qué sigue") / cancelado / fallido (reintentar / volver).

**Página de access code / reporte post-evento del invitado (/accesscode)** **[P]**
- Lookup por # reserva o email.
- Formulario de reporte del invitado: info del invitado, **uploads de fotos** (puerta frente ≥1, área principal ≥1, rack ≥1, baños ≥2, cocina/basura ≥1, daños opcional), checkboxes de confirmación (limpio, basura lista, baños ok, puerta con llave), descripción de issues, submit con validación.
- Estado de éxito.

**Páginas legales**: privacy policy, terms of use, SMS terms. **Stripe Connect callback** (OAuth para cuenta conectada).

### No visibles (corren solas en backend) **[A]**

**Emails/automatización**
- Lead del popup: email #1 inmediato con cupón + drip posterior; se corta al convertir.
- Contacto: email a venue + GHL.
- Confirmación de booking tras depósito.
- Recordatorio de limpieza al staff antes del evento.
- Feedback/reporte post-evento (agenda + envío).
- Recordatorios de host report al staff.
- **Balance**: agenda + genera link 15 días antes; confirmación al pagar.
- Alerta de rating bajo al staff.
- Recordatorios de bookings internos.

**Pagos**
- Webhook de Stripe (éxito/fallo → actualiza estado → dispara confirmaciones).
- Generación del link de pago del balance (con processing fee).

**Calendario/sync**
- Sync de bookings a calendario de GHL.

**Ciclo de vida**
- Disparador de automatización del booking, transición a post-evento, drip de descuento.

**Salud del sistema**: health checks varios, métricas.

**Staff/payroll**: auto-generación de payroll, proceso de invoices recurrentes, notificación de asignación a staff.

### Modelo de pago (clave para replicar)
- **50/50**: depósito hoy + balance después (15 días antes del evento).
- Processing fee se suma a depósito y a balance.
- Stripe para tarjeta; tarjeta guardada para el balance.
- Soporte de cupones; link de balance auto-generado; full refund si no se confirma.

---

## PARTE C — PUNTOS DE ADAPTACIÓN para el otro venue

Lo similar-pero-distinto. Donde hay que **moldear** la lógica, no copiarla literal:

1. **4 espacios en vez de 1.** Esto toca casi todo:
   - Disponibilidad/conflictos: ya no es "el venue está libre", es "¿qué espacio está libre?". Date picker, chequeo de conflictos, calendario y bloqueos pasan a ser **por espacio**.
   - Booking flow: agregar paso/selector de **espacio** (probablemente entre paso 1 y 2).
   - Schedule (admin): el calendario necesita carril/columna por espacio o filtro por espacio.
   - Pricing: ¿tarifas por espacio o iguales? Definir si `venue_pricing` se vuelve por-espacio.
   - Reports/analytics: segmentar revenue y ocupación por espacio.

2. **Cleaning view distinto.** El checklist de 10 ítems y las 6 categorías de fotos son específicos de OEV. El otro venue maneja limpieza de otra forma → re-definir checklist, categorías de fotos, tipos de limpieza/surcharges y cómo se asigna por espacio.

3. **Falta crear el formulario de contacto** en el otro frontend (el popup de lead ya lo tienen).

4. **Revisar qué es por-venue vs global**: cupones hardcodeados (CHRIS/NANO/199), código de acceso del venue, reglas & fee schedule, paquetes de bar/producción — todo eso es contenido de OEV y debe re-parametrizarse.

5. **Integraciones externas (GHL, Stripe Connect)**: confirmar cuenta de GHL, webhook URL, y la cuenta conectada de Stripe del otro venue / rev-share del transfer (ver doc de Stripe-Connect).

---

### Preguntas abiertas para vos
- ¿Las tarifas y fees son iguales para los 4 espacios o cambian por espacio?
- ¿El otro venue usa el mismo modelo 50/50 (depósito + balance) o cambia?
- Cleaning del otro venue: ¿cómo es exactamente? (define el nuevo cleaning view)
- ¿Mismo set de roles de staff (Custodial/Producción/Asistente/Bar)?
- ¿Reusan GHL como canal de mensajería o es otro proveedor?
