# Diseño: Addons visibles para staff (#7) + Edición de horas de staff (#1)

Fecha: 2026-07-14
Fuente: ClickUp task "OEV To-Dos: Correcciones y mejoras del dashboard" (86e2a4e96), puntos #1 y #7.
Stack: Vite + React + TS + shadcn/ui + Supabase + TanStack Query + react-router.

## Alcance de esta tanda

- **Incluye:** #7 (addons visibles para staff) y #1 (editar horas de staff desde el booking, modo "ambos": global + override por persona).
- **Excluido / cerrado:**
  - **#4 (botón duplicar facturas):** YA existe y funciona en código — [`Invoices.tsx:330-337`](../../../src/pages/admin/Invoices.tsx) (botón `CopyPlus` → `duplicateInvoice` en `133-142` → prefill de `CreateInvoiceDialog`). No requiere trabajo.
  - **#2 (aceptación de reservas por staff):** aplazado. Es un feature grande (migración de estado, política RLS anon para el portal, hook accept/reject, badges, deadline/cron, email al admin). Se fragmentará en su propio spec.

## Contexto del código relevante

- **Addons** viven en la tabla `bookings`: columnas típadas (`tablecloths` bool + `tablecloth_quantity`, `setup_breakdown`, `package` + `package_start_time`/`package_end_time`, bar package) y el jsonb `addons_detail` (`[{type, quantity, amount}]`, sin tipar en TS).
- **Asignaciones staff**: tabla `booking_staff_assignments`. Ya tiene columnas `scheduled_start_time`, `scheduled_end_time`, `scheduled_date`, `status` — pero para asignaciones de booking **nunca se escriben ni se muestran** (solo las usa el flujo standalone-cleaning).
- **Hooks admin** (`src/hooks/useAdminData.ts`): `useBookingStaffAssignments` (~601), `useCreateStaffAssignment` (~847), `useDeleteStaffAssignment` (~1000). **No existe `useUpdateStaffAssignment`.** Precedente de update: `usePayrollData.updateAssignment` (`src/hooks/usePayrollData.ts:155-158`) ya hace `booking_staff_assignments.update(...)` para `hours_worked`.
- **Portal staff** (auth localStorage/email, rol `anon`): `src/pages/staff/StaffBookingDetail.tsx`, datos por `useStaffData.ts` (`useStaffBookingDetail` ~123-165, `select` de asignación en ~144). `useStaffData` hace `select("*")` de `bookings` → los campos de addons ya llegan al runtime.
- **RLS**: admin es Supabase Auth (`authenticated`). Política `"Admin and staff can manage assignments" FOR ALL USING (is_admin_or_staff(auth.uid()))` ([migración `20251202232622...sql:100-101`](../../../supabase/migrations/20251202232622_3eb946d9-91aa-4456-8dc6-955133b40c81.sql)) → el admin puede UPDATE sin bloqueo. (La política UPDATE anon "solo bar" afecta al portal staff, o sea a #2, no a #1.)
- **Sin realtime ni polling** en el repo. Único mecanismo de refresco: react-query `invalidateQueries` + refetch on window-focus.

---

## Feature #7 — Addons visibles para el staff asignado

### Objetivo
El staff asignado a un booking ve SOLO los addons que el cliente pidió + sus horas. Nada más. Si el cliente no pidió nada, no aparece nada.

### Decisiones
- **Visibilidad:** todo staff asignado al booking (sin filtrar por rol).
- **Sin precios/$**: se muestra qué montar y cantidades, no montos.
- **Panel oculto si no hay addons**: si ninguna condición es truthy, no se renderiza el panel.
- `celebration_surcharge` **excluido** (cargo interno, no ítem de montaje).

### UI
- Panel nuevo en `StaffBookingDetail.tsx`, insertado tras la card de "Event Information" (~línea 207), antes de las cards por rol.
- Título tipo "Add-ons del cliente" / "Lo que pidió el cliente".
- Ítems (cada uno se renderiza solo si aplica):
  - Manteles: `Manteles: {tablecloth_quantity}` (si `tablecloths === true` o `tablecloth_quantity > 0`).
  - Montaje y desmontaje: badge (si `setup_breakdown === true`).
  - Paquete AV: nombre del `package` + horas `package_start_time–package_end_time` (si `package`).
  - Bar package: nombre (si presente).
  - Extras de `addons_detail`: por cada `{type, quantity}`, línea `"{type}: {quantity}"` (ignorar `amount`).
- (Opcional, nice-to-have) indicador compacto en `StaffBookingsList.tsx` si el booking tiene addons. No prioritario.

### Datos
- Solo lectura de campos que ya llegan en el objeto `booking` de `useStaffBookingDetail`. `addons_detail` está sin tipar: acceder de forma defensiva (`(booking as any).addons_detail ?? []`) o extender el tipo local.

### Sin backend
No hay migración, ni cambios de RLS, ni nuevos hooks. Solo render en el frontend.

---

## Feature #1 — Editar horas de staff desde el booking (global + override por persona)

### Objetivo
Poder cambiar las horas de trabajo del staff asignado cuando el cliente pide cambio de horario, desde el booking. Dos niveles:
- **A. Global:** cambiar el horario del evento → afecta las horas derivadas de todo el staff.
- **B. Override por persona:** dar a un staff asignado un horario propio distinto al del evento.

### A. Editor de horas del evento (global)
- En `BookingDetail.tsx`, agregar un editor de `bookings.start_time` / `bookings.end_time` (inputs de hora + guardar), reutilizando el patrón de `handleSaveProduction` (`661-749`) que ya hace update de `bookings`.
- El editor de horas de **producción/paquete** (`package_start_time/end_time`) ya existe y se mantiene aparte.
- Al guardar → `invalidateQueries` de `["booking", id]` y `["booking-staff-assignments", id]`.

### B. Override por persona
- En la tabla "Staff Assignments" (`BookingDetail.tsx:1402-1499`), la columna "Working Hours" (celda `1448-1458`) pasa de solo-lectura a editable: inputs de `scheduled_start_time`/`scheduled_end_time` por fila + guardar, y un botón "reset" que limpia el override (setea ambos a `null`).
- **Hook nuevo `useUpdateStaffAssignment`** en `useAdminData.ts`: `update` de `booking_staff_assignments` por `id`, escribiendo `scheduled_start_time`/`scheduled_end_time`. Modelar sobre `usePayrollData.updateAssignment`. Invalida `["booking-staff-assignments", bookingId]`.

### Precedencia de horas (helper compartido)
Centralizar la lógica en un helper puro `getAssignmentHours(assignment, booking)` que devuelva `{ start, end, source: 'override' | 'package' | 'booking' }`:
1. Si `scheduled_start_time` y `scheduled_end_time` están seteados → override.
2. Si no, y es rol producción con `package_*` → horas de paquete.
3. Si no → `booking.start_time`–`end_time`.

Usar este helper en:
- la celda "Working Hours" del admin (`BookingDetail.tsx:1448-1458`),
- el lado staff (`StaffBookingDetail.tsx`), para que el staff vea SUS horas custom.

### Lado staff
- `useStaffBookingDetail` (`useStaffData.ts:~144`): agregar `scheduled_start_time`, `scheduled_end_time` al `select` de la asignación.
- `StaffBookingDetail.tsx`: usar `getAssignmentHours` para las cards de horas (Production/Assistant), prefiriendo el override.

### "Tiempo real"
- react-query `invalidateQueries` tras guardar (admin). El portal staff refresca on window-focus / remount (patrón ya usado, ej. `useStaffData.ts:321-322`). Es *casi* tiempo real; sin push.
- Push real (Supabase realtime) queda fuera de alcance.

### RLS
- Admin `authenticated` cubierto por `"Admin and staff can manage assignments" FOR ALL`. Sin migración de RLS.

### Notas de integración / riesgos
- Existen triggers `AFTER UPDATE ON booking_staff_assignments` que sincronizan con GHL calendar (`20260110000000_auto_sync_ghl_calendar.sql`, `20260114202320...sql`). Escribir `scheduled_*` puede disparar re-sync GHL. Verificar en implementación que el payload de sync tolera estos campos y no rompe.
- Cambiar `bookings.start_time/end_time` puede tener efectos downstream (lifecycle, sync GHL, horas derivadas). Alcance MVP: actualizar horas + invalidar. Verificar que no haya lógica que asuma inmutabilidad de esos campos.
- Validación: `end > start`. Manejar zona horaria/formato `TIME` consistentemente con el resto (`date-fns`).

---

## Archivos a tocar (resumen)

**#7**
- `src/pages/staff/StaffBookingDetail.tsx` — panel de addons.
- (opcional) `src/pages/staff/StaffBookingsList.tsx` — indicador.

**#1**
- `src/hooks/useAdminData.ts` — `useUpdateStaffAssignment` nuevo.
- `src/pages/admin/BookingDetail.tsx` — editor horas evento (A) + celda editable + reset (B).
- `src/hooks/useStaffData.ts` — `select` de `scheduled_*`.
- `src/pages/staff/StaffBookingDetail.tsx` — usar horas override.
- Nuevo helper compartido `getAssignmentHours` (p.ej. `src/lib/assignmentHours.ts`), consumido por admin y staff.

## Testing
- Unit del helper `getAssignmentHours`: los 3 casos de precedencia + validación end>start.
- (Si hay setup de test de componentes) render del panel de addons: con addons / sin addons (no renderiza) / sin precios.
- Verificación manual end-to-end: editar horas evento → staff ve cambio al refocar; setear override → admin y staff muestran horas custom; reset → vuelve a heredar.

## Fuera de alcance
- #2 (aceptación por staff) — spec aparte.
- #4 — ya resuelto.
- Push realtime.
- Filtrado de addons por rol (se muestra a todo staff asignado).
