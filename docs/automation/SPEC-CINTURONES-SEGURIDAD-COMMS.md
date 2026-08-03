# Spec — Cinturones de seguridad para cadena de comunicaciones

**Fecha:** 2026-08-03 · **Origen:** [Auditoría julio 2026](AUDITORIA-COMUNICACIONES-JULIO-2026.md) · **Estado:** APROBADO (con ajustes)
**Decisiones tomadas:** timeout = 10 días · pagos nunca se bloquean (solo alertar) · sin auto-confirmación de reservas · cambios 2 y 3 fusionados en el health check (stripe-webhook NO se toca) · transición forzada NO sincroniza a GHL (cero riesgo de comunicaciones tardías a reservas viejas).

Principio: todo paso que depende de un humano recibe timeout o alarma. Cero infraestructura nueva — solo se extienden funciones y crons existentes.

---

## Cambio 1 — Timeout 10 días: forzar `post_event` sin host report

**Archivo:** `supabase/functions/check-post-event-transition/index.ts` (corre cada 5 min vía cron `check-post-event-transition-every-5min`)

Hoy la transición `in_progress → post_event` exige **host report submitted + 24h** (líneas 79). Si staff nunca lo llena, la reserva queda atascada para siempre (jayshree: 24 días).

Nuevo comportamiento — se agrega una rama al loop existente:

```
const HOST_REPORT_TIMEOUT_DAYS = 10;

// dentro del for, después del cálculo de eventEndDateTime:
const timeoutAt = eventEndDateTime + 10 días;
const timeoutPassed = now >= timeoutAt;

if (hostReportCompleted && has24hPassed)        → transición normal (sin cambios)
else if (!hostReportCompleted && timeoutPassed) → TRANSICIÓN FORZADA:
    1. UPDATE bookings SET lifecycle_status='post_event'
    2. INSERT booking_events:
         event_type: 'auto_lifecycle_post_event_forced'
         metadata: { reason: 'host_report_timeout_10d',
                     previous_status: 'in_progress',
                     host_report_completed: false }
    3. NO se invoca sync-to-ghl en la transición forzada — decisión explícita:
       cero riesgo de que GHL dispare comunicaciones tardías sobre reservas
       viejas. GHL se actualiza en el siguiente sync natural de esa reserva.
    4. Email de aviso a ALERT_EMAIL (mismo patrón SMTP Gmail de sync-to-ghl):
       asunto "⏰ Host report timeout (10d): OEV-XXXX forzada a post_event"
       cuerpo: reserva, fecha evento, nota "host report queda INCOMPLETO —
       revisar antes de payroll"
```

- El host report NO se inventa ni se marca completo: queda incompleto y visible (payroll/reportes lo ven así).
- Respuesta JSON agrega `forced_timeout: [...]`.
- Reservas con <10 días siguen apareciendo en `pending_host_report` (sin cambios).
- La transición normal (report completo + 24h) queda EXACTAMENTE igual, incluido su sync a GHL.

**Efecto retroactivo:** al desplegar, jayshree (OEV-6RCDMS) y cualquier otra atascada >10 días transiciona en el siguiente ciclo de 5 min — sin sync a GHL, así que ninguna automatización se entera y nadie recibe mensajes.

## Cambio 2 (fusiona el antiguo 2 y 3) — Health check: `pending_review` envejecido o ya pagado

**Archivo:** `supabase/functions/daily-health-check/index.ts` (corre diario 8am EST). `stripe-webhook` NO se toca.

Nuevo check **6c** después del 6b (~línea 350). Un solo query cubre ambos casos:

```
SELECT id, reservation_number, payment_status, created_at, event_date
FROM bookings
WHERE status = 'pending_review'
  AND (created_at < now() - interval '48 hours'
       OR payment_status = 'fully_paid')
```

- severity: **CRITICAL** si `payment_status IN ('deposit_paid','fully_paid')` (caso Keshie: pagó y nadie aprobó), si no **HIGH** (lleva >48h esperando revisión)
- type: `stale_pending_review`
- descripción: reserva, días esperando, estado de pago, fecha evento
- Entra al email de alerta existente (`sendAlertEmail`), sin canal nuevo.
- El cobro NUNCA se frena (decisión: revenue primero, humano decide después).

## Cambio 4 — Commit + deploy del fix de reschedule (ya escrito)

- `supabase/functions/reschedule-booking/index.ts`: cambio local existente (recrea host report jobs con `force_reschedule` tras reagendar). Solo falta commit + deploy.
- Incluir en el commit la migración `20260727000000_fix_auto_fix_missing_jobs_cron.sql` (ya aplicada en prod, sin trackear en git).
- Deploy vía Lovable (push a main NO redespliega functions).

## Cambio 5 — Backfill one-time: externos de julio

Para **OEV-0BB240** (Jill, evento 9/17) y **OEV-ACE008** (Rodrigo, evento 9/13), creados con flujo viejo. Versión MÍNIMA (cero mensajes salientes hoy):

1. Invocar directamente `schedule-host-report-reminders` con `{booking_id, force_reschedule:true}` → recrea jobs host_report (mismas fechas) y agrega el `one_hour_report` faltante. Esta función solo escribe `scheduled_jobs`; su único sync a GHL es para "immediate step change" (short-notice), que NO aplica a eventos de septiembre.
2. NO se toca `payment_status` ni lifecycle (cambiarlos podría disparar automatizaciones GHL — excluido por decisión).
3. Consecuencia aceptada: estas 2 reservas no tienen job `set_lifecycle_in_progress`; al llegar su evento habrá que cerrarlas manual (el health check las va a señalar). Anotado en ClickUp.
4. **OEV-F2EB76** (Carla): evento ya pasó — nada que hacer.
5. **OEV-XB332C** (Keshie): acción manual tuya — completar checklist en BookingDetail (dispara toda la automatización). Ningún cambio de código la arregla.

## Fuera de alcance (explícito)

- NO bloquear cadena de balance ni ningún cobro.
- NO auto-confirmar reservas (checklist sigue siendo control humano).
- NO tocar workflows GHL ni `stripe-webhook`.
- NO sync a GHL desde transiciones forzadas ni backfills (cero comunicaciones no solicitadas).
- NO rediseñar lifecycle ni jobs.

## Tests

- Mirror-logic test para condición de timeout (patrón del commit `4367527`): casos <10d sin report (no transiciona), ≥10d sin report (fuerza), report completo + 24h (normal), daily vs hourly end time.
- Test de la query 6c (48h boundary, severities).

## Orden de ejecución

1. Código (cambios 1–2) + tests en local.
2. SELECT pre-deploy: listar reservas que el timeout moverá retroactivamente.
3. Commit todo (incl. cambio 4) + push.
4. Deploy vía Lovable: `check-post-event-transition`, `daily-health-check`, `reschedule-booking`.
5. Backfill (cambio 5) + verificación SELECT.
6. Tú: confirmar Keshie en dashboard.
