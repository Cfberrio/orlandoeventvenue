# Staff Dashboard — Cómo funciona

Documento de referencia del panel de personal (staff) de OEV. Objetivo: entender qué es, cómo se ve, qué hace y cómo está construido — suficiente para duplicarlo en otra venue.

---

## 1. ¿Qué es lo que tenemos?

Un **panel web para el personal** del venue (no para clientes ni admin). Cada miembro del staff inicia sesión y ve **solo lo suyo**: sus bookings asignados, su calendario, sus pagos y, según su rol, tareas extra (limpieza, inventario, contacto con cliente).

Es un dashboard **role-based**: lo que ves cambia según tu rol. Cuatro roles:

| Rol | Para qué |
|-----|----------|
| **Production** | Operar A/V durante las horas del paquete |
| **Assistant** | Tareas asignadas durante el evento |
| **Custodial** | Limpieza, reportes de limpieza, inventario |
| **Bar Vendor** | Servicio de bar, contactar al cliente |

### Stack técnico
- **React 18** + **TypeScript** + **Vite**
- **React Router v6** (rutas)
- **shadcn/ui** (Radix UI) + **Tailwind CSS** — librería de componentes y estilos
- **TanStack React Query** — fetch de datos
- **Supabase** — backend, base de datos y storage de fotos
- **Recharts** (gráficas), **Lucide** (iconos), **Sonner** (notificaciones toast)

### Dónde vive el código
- `src/pages/staff/` — todas las vistas
- `src/components/staff/` — layout y protección de rutas
- `src/hooks/` — `useStaffSession`, `useStaffData`, `useStaffPayrollData`, etc.

---

## 2. UI / UX

**Patrón de layout:** *sidebar + header* (app shell clásico).
Archivo: `src/components/staff/StaffLayout.tsx`

- **Sidebar izquierdo** (fijo en desktop, drawer deslizante en móvil): navegación filtrada por rol.
- **Header superior:** logo "OEV Staff", nombre + rol del usuario, botón "Sign Out", hamburguesa en móvil.
- **Contenido principal:** mayormente **tarjetas (cards)**; tablas en pagos e inventario; grid en calendario.

**Diseño:** mobile-first, responsivo (breakpoints sm / md / lg). Tablas → cards apiladas en móvil. Sidebar colapsa en móvil.

**Color de estado (lifecycle del booking):** código de color consistente en todas las vistas:
- Pending → amarillo · Confirmed → azul · Pre-event ready → índigo · In progress → verde · Post event → morado · Closed → gris · Cancelled → rojo

**Acentos por rol:** Production borde morado · Bar Vendor borde ámbar · Assistant naranja · Custodial neutro.

**Feedback:** spinners al cargar, toasts (verde éxito / rojo error), diálogos de confirmación para acciones destructivas (unassign, delete).

---

## 3. ¿Qué puedes ver? (por rol)

| Vista | Production | Assistant | Custodial | Bar Vendor |
|-------|:---:|:---:|:---:|:---:|
| My Bookings | ✓ | ✓ | ✓ | ✓ |
| Calendar | ✓ | ✓ | ✓ | ✓ |
| My Payments | ✓ | ✓ | ✓ | ✓ |
| Standalone Assignments | — | — | ✓ | — |
| Inventory | — | — | ✓ | — |
| Cleaning Reports | — | — | ✓ | — |
| Contacto del cliente | limitado | no | no | ✓ (completo) |

El sidebar **oculta** lo que tu rol no puede usar. Inventario y Standalone solo aparecen para Custodial.

---

## 4. Las vistas

Rutas (de `App.tsx`):

```
/staff/login                                     → StaffLogin (pública)
/staff                                           → StaffBookingsList (home)
/staff/bookings/:id                              → StaffBookingDetail
/staff/bookings/:id/cleaning-report              → CleaningReportForm
/staff/schedule                                  → StaffSchedule
/staff/payments                                  → StaffPayments
/staff/standalone                                → StaffStandaloneList
/staff/standalone/:id/cleaning-report            → StandaloneCleaningReportForm
/staff/inventory                                 → StaffInventory
```

### 4.1 My Bookings (home) — `StaffBookingsList.tsx`
Lista de bookings asignados al usuario. Dos secciones: **Upcoming/Current** y **Past** (últimos 10).
Cada card: estado (badge de color), rol de asignación, número de reserva, nombre del cliente, fecha y tipo de evento, # de invitados, hora de inicio.
**Acciones:** abrir detalle · "Unassign" (con confirmación) para quitarse del booking.

### 4.2 Booking Detail — `StaffBookingDetail.tsx`
Detalle completo del evento + **sección específica según rol**:
- **Production + paquete A/V:** card "Your Production Hours" (horas del paquete).
- **Assistant:** card "Your Assigned Tasks" (lista numerada de tareas).
- **Bar Vendor:** card de servicio de bar — contacto del cliente (teléfono/email clickeables), botón "Mark Customer Contacted", dirección del venue, notas internas.
- **Custodial:** card "Cleaning Report" — estado + botón para llenar/editar el reporte.
**Acciones:** Unassign · Mark Contacted (bar) · llenar Cleaning Report (custodial).

### 4.3 Calendar — `StaffSchedule.tsx`
Calendario en grid con sus eventos. Toggle **Semana / Mes**, navegación prev/next.
Cada celda: número de día + cards de evento (máx 3, "+N more"), coloreadas por estado. Hoy resaltado.
**Acciones:** click en evento → detalle del booking. Leyenda de colores incluida.

### 4.4 My Payments — `StaffPayments.tsx`
Historial de pagos del usuario. **3 tarjetas resumen:** Total Owed / Paid / Pending.
**Filtros:** rango de fechas, origen (Booking vs Standalone), estado (Paid/Pending).
**Tabla** (cards en móvil): fecha, origen, categoría de pago (Hourly, Cleaning Fee, Assistant Fee, Bar Flat Fee, Bonus, Deduction…), descripción, cálculo ("X horas × $Y/hr"), monto, estado.
**Acciones:** filtrar · exportar CSV.

### 4.5 Standalone Assignments — `StaffStandaloneList.tsx` *(solo Custodial)*
Tareas de limpieza/prep **no ligadas a un booking**.
Cada card: tipo y precio (Touch-Up $40 / Regular $80 / Deep $150), estado (Assigned/In Progress/Completed), fecha, horario, notas.

### 4.6 Cleaning Report Form — `CleaningReportForm.tsx` *(solo Custodial)*
Formulario post-evento. Bloqueado para Production/Assistant.
Secciones: info del limpiador · issues/daño (checkbox + notas) · **fotos** (6 zonas: puerta, área principal, rack, baños, cocina, deep clean) · **checklist** de 10 ítems · uso de **inventario** · creación de **maintenance tickets**.
**Acciones:** subir fotos a Supabase storage · guardar/enviar · crear ticket.

### 4.7 Standalone Cleaning Report — `StandaloneCleaningReportForm.tsx` *(solo Custodial)*
Igual al anterior pero para tareas standalone (sin booking). Más simple, sin maintenance tickets.

### 4.8 Inventory & Storage — `StaffInventory.tsx` *(solo Custodial)*
Gestión de stock del venue. Otros roles ven "access denied".
**KPIs/chips de estado:** All / Out of Stock (rojo) / Low Stock (amarillo) / Stocked (verde).
**Filtros:** por ubicación · vista Simple/Detallada.
Stock agrupado por **ubicación** (cards colapsables). Por ítem: producto, nivel actual (botones −/+), estado con badge. Vista detallada añade unidad, nivel mínimo, etiqueta de estante, notas, eliminar.
**Diálogos:** gestionar productos, gestionar ubicaciones, agregar stock/producto.
**Acciones:** ajustar niveles, editar inline, eliminar.

---

## 5. Autenticación

Archivo: `src/pages/staff/StaffLogin.tsx` + `useStaffSession.tsx` + `StaffProtectedRoute.tsx`

- **Login por email**, sin contraseña.
- Sesión guardada en **localStorage** (`staff_session`): id, nombre, email, rol, timestamp.
- Al cargar la app, se valida contra Supabase que el staff exista y esté activo.
- Rutas protegidas: si no hay sesión válida → redirige a `/staff/login`.

> ⚠️ Nota de seguridad: la auth es solo localStorage (sin password). Conocido en el roadmap de seguridad — ver `docs/security/`.

---

## 6. ¿Es intuitivo?

**Sí, en general.** Fortalezas:
- **Filtrado por rol:** cada quien ve solo lo relevante → poca carga cognitiva.
- **Código de color consistente** de estados en todas las vistas.
- **Patrón familiar** sidebar + cards, responsivo, mobile-first.
- Acciones destructivas siempre con confirmación.

**Fricciones / a vigilar:**
- Login sin password puede confundir ("¿no necesito clave?") y es débil en seguridad.
- "Unassign" es destructivo y está muy a la mano — depende de la confirmación.
- Formularios de limpieza son largos (fotos + checklist + inventario + tickets) — pueden cansar en móvil.

---

## 7. Para duplicarlo (checklist mínimo)

1. **Base de datos (Supabase):** tablas `staff_members`, `bookings`, `staff_assignments`, `cleaning_reports`, `standalone_cleaning_assignments`, `payroll_items`, `inventory_products`, `inventory_locations`, `inventory_stock`, `maintenance_tickets`.
2. **Auth:** login por email + sesión en localStorage validada contra `staff_members.is_active`. *(Recomendado: reforzar con password/OTP al duplicar.)*
3. **App shell:** `StaffLayout` (sidebar filtrado por rol + header).
4. **8 vistas** de la sección 4, reutilizando shadcn/ui + Tailwind.
5. **Lógica por rol:** mostrar/ocultar sidebar items y secciones del detalle según `role` / `assignment_role`.
6. **Storage:** bucket de Supabase para fotos de reportes de limpieza.

---

*Generado a partir del código en `src/pages/staff/` y `src/components/staff/`. Para detalle exacto de campos/queries, revisar los archivos citados.*
