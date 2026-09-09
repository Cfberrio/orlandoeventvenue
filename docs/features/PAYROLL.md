# Payroll — Cómo funciona

Documento de referencia del sistema de nómina (payroll) de OEV. Objetivo: entender qué es, cómo se ve, qué tan intuitivo es y cómo fluye la información — como **referencia** para construir algo parecido en DSPACE (no para copiar la lógica, que en DSPACE es distinta).

---

## 1. ¿Qué es?

El módulo de pagos al **personal** (staff): cuánto se le debe a cada quien, qué ya se pagó y qué queda pendiente. Tiene **dos lados**, dos vistas distintas para dos audiencias:

| Lado | Quién lo usa | Qué hace |
|------|--------------|----------|
| **Admin — Payroll Reports** | El dueño / gerente | Ve nómina de TODO el staff, marca pagos como pagados, ajusta, exporta. |
| **Staff — My Payments** | Cada miembro del staff | Ve **solo lo suyo**: lo que ganó, lo pagado y lo pendiente. |

La idea central: **el pago no se escribe a mano**. Se *genera* a partir del trabajo (asignaciones de booking o limpiezas standalone). El admin solo revisa y marca "pagado".

---

## 2. El flujo (de dónde sale la plata)

Esta es la parte conceptual más importante para entender el módulo:

```
1. Staff es asignado a un booking (o limpieza standalone)
          │
2. La asignación se completa  →  status = "completed"
          │
3. El sistema GENERA automáticamente "payroll items"
   (un renglón de pago por cada concepto: horas, fee de limpieza, bono…)
          │
4. Cada item nace como "pending" (pendiente de pago)
          │
5. Admin revisa, ajusta (bono/deducción) y marca "paid"
          │
6. Staff ve el item como "Paid" en su vista
```

**Concepto clave:** un *payroll item* es **un renglón de pago**, no un cheque. Una sola noche de trabajo de un mismo empleado puede generar varios items (ej. horas de producción + un bono). Cada item tiene su propio estado pagado/pendiente.

**Categorías de pago** que el sistema reconoce (etiquetas de ejemplo, en OEV):
- Hourly (Production) · Hourly (Bar Vendor) — por horas × tarifa
- Cleaning Fee + Celebration Surcharge — limpieza
- Assistant Fee · Bar Vendor Flat Fee — montos fijos
- Bonus (suma) · Deduction (resta, siempre negativo) — ajustes manuales del admin

> En DSPACE las categorías y la fórmula serán otras. Lo que importa como referencia: **separar el cálculo automático del marcado manual de "pagado"**, y permitir ajustes (bono/deducción) encima del cálculo base.

---

## 3. Vista ADMIN — "Payroll Reports"

Archivo: `src/pages/admin/PayrollReports.tsx`

**Layout de arriba hacia abajo:**

1. **Título** "💰 Payroll" + subtítulo.
2. **Selector de rango de fechas** (por defecto: mes actual). Todo lo de abajo se recalcula al cambiarlo.
3. **4 tarjetas resumen (KPIs):** Total Owed · ✅ Paid · ⏳ Pending · 👥 Staff (cantidad de empleados con pagos en el rango).
4. **Tabs (2):**
   - **📋 All Staff Payroll** — la tabla principal.
   - **🧹 Standalone Cleanings** — limpiezas no ligadas a booking.

### Tabla principal (All Staff Payroll)
Archivo: `src/components/admin/payroll/PayrollOverviewView.tsx`

Una fila por empleado. Columnas: checkbox · nombre · rol (badge) · # asignaciones · **Total Owed** · **Paid** (verde) · **Pending** (naranja). Fila final de **TOTAL**.

**Interacciones:**
- **Fila expandible** (chevron): abre el detalle renglón-por-renglón de ese empleado (cada payroll item con su fecha, concepto, monto, estado). Ahí se editan items, se agregan bonos/deducciones.
- **Selección con checkbox** (solo filas con pendientes) → botón **"Mark Selected as Paid (N)"** → diálogo de confirmación → marca todos los items pendientes de esos empleados como pagados.
- **Export CSV** del rango.

**Patrón visual:** verde = pagado, naranja = pendiente. Consistente con la vista del staff.

---

## 4. Vista STAFF — "My Payments"

Archivo: `src/pages/staff/StaffPayments.tsx`

Lo que ve cada empleado de **sus propios** pagos. De arriba hacia abajo:

1. **Header** "My Payments" con descripción amable ("See what you've earned…").
2. **3 tarjetas resumen:** Total Owed (azul) · Paid (verde) · Pending (naranja). Se calculan sobre lo **filtrado**.
3. **Filtros (4):** Desde · Hasta (date pickers) · **Show** (Todos / Booking / Standalone) · **Status** (Todos / Paid / Pending).
4. **Tabla de detalle** (Payment Details, con contador de items):
   - Columnas: Fecha · Origen (badge Booking + n° reserva, o Standalone) · Categoría (+ badge de tipo) · Descripción (con cálculo "Xh × $Y/hr" si aplica) · Monto · Estado (badge verde/naranja + fecha de pago).
   - **Botón Export CSV.**
5. **Empty state** amable cuando no hay registros ("prueba otro rango / cambia el filtro").

**Responsive:** en desktop es **tabla**; en móvil cada renglón se vuelve una **card** apilada (mismo dato, sin scroll horizontal).

---

## 5. ¿Qué tan intuitivo es? (lo que pidió el cliente)

**Fortalezas — está bien logrado:**
- **Resumen primero, detalle después.** Las 3-4 tarjetas KPI arriba responden la pregunta inmediata ("¿cuánto me deben / cuánto debo?") sin leer la tabla. Buena jerarquía visual.
- **Código de color universal:** verde = pagado, naranja = pendiente, azul = total. Igual en admin y en staff → no hay que reaprender.
- **Lenguaje humano**, no contable. "Total Owed / Paid / Pending" en vez de jerga. La descripción del booking muestra el cálculo legible ("3h × $25/hr") en vez de solo un número.
- **Filtros donde se esperan** (rango de fecha, origen, estado) y resultado inmediato.
- **Acción masiva clara en admin:** seleccionar → "Mark Selected as Paid (N)" → confirmar. El contador en el botón dice exactamente qué va a pasar.
- **Móvil pensado:** tabla → cards. No hay tablas ilegibles en el teléfono.
- **Cada quien ve solo lo suyo** (staff): cero confusión, cero datos de otros.

**Fricciones / a vigilar:**
- El staff **solo lee**: no puede objetar ni reclamar un monto desde la vista. Si algo está mal, es por fuera del sistema.
- "Marcar como pagado" es de un solo clic por lote — rápido, pero el deshacer (marcar unpaid) está más escondido (en el detalle).
- El admin agrupa por empleado y hay que **expandir** para ver el porqué de cada monto — un clic extra para auditar.
- Depende de que las asignaciones se marquen "completed". Si no se cierran, no se genera nómina (el empty state lo explica, pero es un punto de fallo humano).

---

## 6. Para replicarlo en DSPACE (idea, no copia)

Quédate con **los principios**, no con las tablas exactas:

1. **Dos vistas separadas:** una de admin (todo el staff, acciones de pago) y una de cada empleado (solo lo suyo, solo lectura). Reusan el mismo color y vocabulario.
2. **El pago se genera del trabajo, no se teclea.** Defin cuál es tu "evento que dispara el pago" (en OEV: asignación completada) y genera renglones automáticos desde ahí.
3. **Renglones, no totales:** guarda cada concepto como un item con estado pagado/pendiente propio. El total es una suma, no un dato.
4. **Estado de 2 colores** (pagado/pendiente) consistente en todas las pantallas.
5. **Resumen KPI arriba**, detalle abajo, filtros por fecha + origen + estado.
6. **Acción de pago por lote** con confirmación y contador.
7. **Ajustes manuales** (bono/deducción) encima del cálculo base, sin reescribir el cálculo.
8. **Export CSV** en ambas vistas — el contador siempre quiere su Excel.
9. **Seguridad:** el fetch del staff debe filtrar por su `id` **del lado del servidor** (en OEV, un RPC dedicado), no confiar en el filtro del front.

---

## 7. Dónde vive el código (OEV, referencia)

| Pieza | Archivo |
|-------|---------|
| Vista admin (página + tabs + KPIs) | `src/pages/admin/PayrollReports.tsx` |
| Tabla admin por empleado + marcar pagado | `src/components/admin/payroll/PayrollOverviewView.tsx` |
| Edición de items, bono/deducción | `src/components/admin/payroll/PayrollItemEditModal.tsx`, `AssignmentDetailsTable.tsx` |
| Lógica de datos admin (fetch, marcar pagado, bono, export) | `src/hooks/usePayrollData.ts` |
| Vista staff "My Payments" | `src/pages/staff/StaffPayments.tsx` |
| Lógica de datos staff (RPC filtrado por staff_id) | `src/hooks/useStaffPayrollData.ts` |
| Tablas Supabase | `staff_payroll_items`, `booking_staff_assignments` |

---

*Generado a partir del código en `src/pages/admin/`, `src/components/admin/payroll/` y `src/pages/staff/`. Es una referencia conceptual: la lógica de cálculo de DSPACE es distinta y no necesita copiarse.*
