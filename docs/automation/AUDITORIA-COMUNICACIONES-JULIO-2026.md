# Auditoría de comunicaciones — Bookings julio 2026

**Fecha auditoría:** 2026-08-03 · **ClickUp:** [86e2m17g6](https://app.clickup.com/t/86e2m17g6)
**Alcance:** bookings creados en julio 2026 + bookings con evento en julio 2026 (internos y externos).
**Fuentes:** tablas `bookings`, `scheduled_jobs`, `booking_events` (prod vía Lovable MCP), código edge functions, git history, `cron.job`.

## Resumen ejecutivo

De 14 reservas auditadas, **8 tuvieron cadena rota o degradada**. Tres causas raíz, todas identificadas:

1. **Externos creados antes del 7/28** enviaron mensajes con campos dinámicos vacíos ("Hi External", sin Reservation #) porque el wizard nunca llamaba `sync-to-ghl` (fix `57417f8` + backfill 7/28).
2. **Reagendamientos** perdían los jobs de host report (RPC solo desplaza jobs `pending`), y el cron de auto-reparación nunca existió por bug de `$$` anidado (reparado en migración `20260727000000`; cron activo verificado). **El fix de `reschedule-booking` sigue local, sin commit ni deploy.**
3. **OEV-XB332C quedó atascada en `pending_review`**: nadie completó el checklist admin → `trigger-booking-automation` nunca corrió → cero jobs de comunicación, y el auto-fix no la ve porque solo repara `pre_event_ready`.

## Estado por reserva

### Internas (website)

| Reserva | Cliente | Evento | Estado cadena |
|---|---|---|---|
| OEV-9MUYQS | Saicha Morales | 10/17 | ✅ OK — confirmada 7/3, jobs completos |
| OEV-93UDYH | Ryan Salinas | 8/22 | ✅ OK — confirmada 7/13, sync 30d corrió 7/23 |
| OEV-CYJAHK | D Jerome Garrett | 9/5 | ✅ OK — confirmada 7/27 |
| OEV-2LASUD | DJerome Garrett | 9/4 | ✅ OK — confirmada 7/27 |
| OEV-YCY9FR | F Gilmore Jr | 7/18 | ✅ OK — cadena completa incl. S06 |
| OEV-A8DAK3 | orlandoeventTEST | 7/22 | ⚪ test, cancelada — ignorar |
| **OEV-XB332C** | **Keshie Young** | **8/14** | 🔴 **ROTA** — ver caso 1 |
| **OEV-6RCDMS** | **jayshree kheraj** | **7/10** | 🟡 comms cliente OK; lifecycle atascado — ver caso 3 |
| **OEV-E3G92D** | **Fred Rodriguez** | **7/25** | 🔴 **ROTA** — ver caso 2 |

### Externas (todas creadas ANTES de los fixes 7/28–7/29)

| Reserva | Cliente | Evento | Estado cadena |
|---|---|---|---|
| OEV-0BB240 | Jill J | 9/17 | 🟠 campos rotos hasta backfill 7/28; faltan jobs `one_hour_report` + lifecycle |
| OEV-2D01B6 | Christopher K | 7/16 | 🔴 evento completo pasó con campos vacíos (syncs 7d/1d corrieron SIN reservation_number ni nombre real) |
| OEV-838E92 | Yulieanna H | 7/30 | 🟠 syncs 7d/1d con campos rotos (backfill llegó 7/28, 2 días antes del evento) |
| OEV-F2EB76 | Carla Rivera | 8/3 | 🟠 backfilleada, pero **sin job `one_hour_report`** (evento HOY) |
| OEV-ACE008 | Rodrigo G | 9/13 | 🟠 backfilleada; faltan jobs `one_hour_report` + lifecycle |

## Casos detallados

### Caso 1 — OEV-XB332C (Keshie Young): booking pagada 100% pero nunca confirmada

Timeline: creada 7/27 17:36 → depósito 7/27 18:18 → `balance_retry_1` envió link 7/30 → **balance pagado 7/30 16:04 → `fully_paid`**. Hoy sigue `status=pending_review`, `lifecycle=pending`, 0 staff asignado.

- I02 "Booking Confirmed" **nunca se envió** (se dispara al completar el checklist admin en BookingDetail → `trigger-booking-automation`).
- No existen jobs `host_report_*` (sync 30/7/1), `one_hour_report`, `guest_feedback`, `set_lifecycle` → **S01/S02/S04/S06 no van a salir**.
- `auto_fix_missing_jobs` no la repara: su filtro exige `lifecycle_status='pre_event_ready'`.
- Gap adicional: la cadena de balance corrió y cobró **antes de que nadie aprobara la reserva**.
- I01 y P02 probablemente sí salieron (stripe-webhook llama `sync-to-ghl` en depósito L1124 y balance L971) — confirmar en GHL.

### Caso 2 — OEV-E3G92D (Fred Rodriguez): reagendada, jobs nunca recreados

Reagendada 4/28 (evento nuevo 7/25). El RPC `reschedule_booking` solo desplaza `run_at` de jobs **pending**; los suyos ya habían corrido/no existían → quedó sin `host_report_during/post` ni `guest_feedback` para la fecha nueva. **Sin sync 7d/1d y sin S06.**

Causa raíz doble:
1. Cron `auto-fix-missing-jobs-hourly` **jamás quedó registrado** (bug `$$` anidado en migración `20260126222113`). Reparado en `20260727000000` — verificado activo en `cron.job` (`15 * * * *`).
2. `reschedule-booking/index.ts` ahora recrea host report jobs con `force_reschedule` — **pero ese cambio está uncommitted y sin desplegar** (deploy solo vía Lovable).

### Caso 3 — OEV-6RCDMS (jayshree kheraj): comms cliente OK, lifecycle atascado

Toda la cadena de cliente se ejecutó según DB: sync 30d (6/10), P01 + retries (6/25–27), balance pagada 6/28 → P02 sync, sync 7d (7/3), sync 1d (7/10), S06 email (7/11), 3× `sync_to_ghl_success`.

Problema: `lifecycle_status='in_progress'` desde 7/10 (24 días). `check-post-event-transition` exige **host report enviado + 24h** y el staff asignado (1) nunca lo envió → no transiciona a `post_event`. Impacto interno (reportes/cierre), no de comms cliente. Pendiente confirmar en GHL los SMS (S02/S04/S06-SMS).

### Caso 4 — Externos de julio: campos dinámicos vacíos

Los 5 externos se crearon con el flujo viejo: `full_name='External - X'` (GHL derivaba firstName="External"), sin `reservation_number`, y el wizard **nunca enviaba el snapshot** `sync-to-ghl` → custom fields GHL vacíos. Mensajes automatizados salieron como "Hi External" sin datos. Fix `57417f8` (7/28) + backfill en prod 7/28 ~22:04 (visible como `ghl_appointment_updated` masivo).

- **Christopher (evento 7/16)**: todo el ciclo pasó con campos rotos.
- Los 5 siguen sin jobs `one_hour_report`/`set_lifecycle` (el flujo nuevo `c520f1c` solo aplica a externos creados desde 7/29). **Carla tiene evento hoy 8/3 sin `one_hour_report`.**

## Verificación lado GHL — PENDIENTE

No fue posible leer conversaciones GHL: el token Private Integration vive solo en Supabase secrets; Composio requiere auth config manual para HighLevel. Location ID: `fSCCE6NpjF7cR5GgzIA0`.

Qué verificar cuando haya acceso (API `services.leadconnectorhq.com`, o UI GHL → Conversations):
1. Keshie (`l4ZD1mgw6PKK0kYbOY4T`): ¿salió I01 y P02? ¿algún I02 huérfano?
2. Christopher (`Q36CiGsTX594SQliGBOH`) + externos julio: ¿qué mensajes salieron con campos vacíos y cuáles se dispararon tarde con el backfill 7/28?
3. jayshree (`YiVLraVWJPVDBPAVlywu`): SMS S02 (~7/3) y S04 (~7/9) entregados.

## Soluciones a ejecutar (propuestas)

| # | Acción | Urgencia |
|---|---|---|
| 1 | **Confirmar OEV-XB332C** (checklist en BookingDetail) → dispara `trigger-booking-automation` y crea jobs 30/7/1 + I02. Evento en 11 días | 🔴 HOY |
| 2 | Crear `one_hour_report` para OEV-F2EB76 (evento hoy): invocar `schedule-host-report-reminders` con `force_reschedule` | 🔴 HOY |
| 3 | Commit + deploy (Lovable) del fix en `reschedule-booking` | 🔴 Esta semana |
| 4 | Backfill jobs faltantes (`one_hour_report`, lifecycle) en externos julio: OEV-0BB240, OEV-ACE008 | 🟠 |
| 5 | Ampliar `auto_fix_missing_jobs` o `daily-health-check`: alerta para bookings `pending_review` > 48h y `fully_paid` sin confirmar | 🟠 |
| 6 | Decisión de negocio: ¿bloquear cadena de balance hasta que la reserva esté confirmada? (Keshie pagó 100% sin aprobación) | 🟡 |
| 7 | Staff: enviar host report de OEV-6RCDMS y OEV-E3G92D para destrabar lifecycle | 🟡 |
| 8 | Verificación GHL (sección anterior) para cerrar la auditoría | 🟡 |
