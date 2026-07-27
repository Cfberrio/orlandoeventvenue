# One Hour Report — Guest Report Closeout Trigger

**Date:** 2026-07-27
**Status:** Approved by Cristian

## Purpose

Send the "Thank You for Hosting / Guest Report" email + SMS to the host **1 hour before the booking's end time**, while the host is still on site. The message content and sending live in GoHighLevel (GHL); Supabase only flips a custom field and syncs it. GHL workflow trigger: **Contact Changed** on the new field.

Example: event 3:00–7:00 PM → field flips at 6:00 PM → GHL sends email + SMS.

## Architecture

Follows the exact existing host-report pattern. **No new edge functions.** Three existing functions are modified plus one DB migration:

```
booking confirmed / rescheduled
        │
        ▼
schedule-host-report-reminders  ── creates scheduled_jobs row: job_type=one_hour_report, run_at = end − 1h
        │                          (or fires immediately if that time already passed — smart catch-up)
        ▼
process-scheduled-jobs (cron)   ── at run_at: validate conditions → set bookings.one_hour_report='true'
        │                          → log booking_events → call sync-to-ghl
        ▼
sync-to-ghl                     ── snapshot now includes one_hour_report → POST to GHL webhook
        │
        ▼
GHL: Contact Changed (one_hour_report = "true") → sends Guest Report email + SMS
```

## Naming

- DB column: `bookings.one_hour_report` — TEXT, NOT NULL, DEFAULT `'false'`. Values: `'false'` / `'true'` (text, not boolean — matches `is_deposit_paid`, `pre_event_ready`, etc.).
- Job type: `one_hour_report` in `scheduled_jobs`.
- Webhook snapshot key: `one_hour_report`.
- GHL custom field (created manually by Cristian in GHL): text field mapped from the webhook key.

## Components

### 1. Migration

`ALTER TABLE public.bookings ADD COLUMN one_hour_report TEXT NOT NULL DEFAULT 'false';` plus a `COMMENT ON COLUMN` explaining values and purpose.

### 2. schedule-host-report-reminders (modified)

After the existing host-report step logic:

- Compute event **end** in Orlando time (same `toOrlandoUTC` helper, `ORLANDO_OFFSET_HOURS = -5`):
  - Hourly booking with `end_time` → `event_date + end_time`.
  - Daily booking or missing `end_time` → `event_date + 23:59:59` (same fallback as `check-post-event-transition`). Email would go out at 22:59.
- `t_one_hour = end − 1h`.
- If `t_one_hour` is in the future → insert `scheduled_jobs` row (`job_type='one_hour_report'`, `run_at=t_one_hour`, `status='pending'`), skipping if a pending one already exists (same dedup pattern as host-report jobs).
- If `t_one_hour` already passed (short-notice booking) → **fire immediately** by inserting the job with `run_at = now`; the next cron tick (≤1 min) runs the normal condition checks and flips the field. Single code path — no inline duplication of the condition logic.
- `force_reschedule=true` → cancel pending/failed `one_hour_report` jobs and recreate (reschedule-booking already calls this function with that flag, so date/time changes are covered for free).
- If host report already completed (existing early-return path) → also cancel pending `one_hour_report` jobs alongside the host_report_* jobs.

### 3. process-scheduled-jobs (modified)

New branch for `job_type === 'one_hour_report'`. Conditions checked **at fire time**:

| Condition | If not met |
|---|---|
| Booking exists | cancel job, reason `booking_not_found` |
| `status != 'cancelled'` | cancel job, reason `booking_cancelled` |
| `payment_status` in (`deposit_paid`, `fully_paid`) | cancel job, reason `deposit_not_paid` |
| ≥1 staff assigned (any role, `booking_staff_assignments`) | cancel job, reason `no_staff_assigned` |
| Host report NOT already completed (`booking_host_reports` empty) | cancel job, reason `host_report_already_completed` |
| `one_hour_report != 'true'` (idempotency) | mark completed, no update, no re-sync |

No retries on unmet conditions — at end−1h, an unpaid deposit or missing staff will not fix itself. Cancelled with reason logged; visible in `scheduled_jobs.last_error` and `booking_events`.

On success:
1. `UPDATE bookings SET one_hour_report='true'` (DB update failure → up to 3 attempts, then `failed`, same as host-report jobs).
2. Insert `booking_events` row (`event_type: 'one_hour_report_triggered'`).
3. Call `sync-to-ghl` immediately (critical — GHL only fires on field change). Sync failure logged as `sync_to_ghl_failed` event, job still completes (existing pattern).

### 4. sync-to-ghl (modified)

Add `one_hour_report` to `BookingSnapshot` interface, `BookingRow` interface, and the returned snapshot object (`booking.one_hour_report || 'false'`). No other changes — webhook POST already sends the full snapshot.

### 5. GHL side (manual, Cristian)

1. Create text custom field (e.g. `oev_one_hour_report`).
2. In the inbound-webhook workflow, map snapshot key `one_hour_report` → that field.
3. New workflow: trigger **Contact Changed**, filter field = `"true"` → send Guest Report email + SMS (copy already written).

## Error handling

Identical to existing patterns: critical exceptions in `schedule-host-report-reminders` send the Gmail alert to `orlandoglobalministries@gmail.com` and log `*_critical_failure` in `booking_events`; job-level failures tracked in `scheduled_jobs.status/last_error`.

## Out of scope

- The email/SMS content and sending (lives in GHL).
- Any change to the existing 30d/7d/1d host_report_step flow.
- Resetting `one_hour_report` back to `'false'` (one-shot per booking; reschedule after it fired does not re-send — flag stays `'true'`).

## Testing

- Unit-style: invoke `schedule-host-report-reminders` against a test booking >1h before end → job created with correct `run_at` (verify Orlando offset); booking already past end−1h → immediate fire path.
- Condition matrix in `process-scheduled-jobs`: cancelled booking, pending payment, no staff, host report already submitted → each cancels with correct reason.
- End-to-end on a real short-notice test booking: field flips, GHL contact updates, Contact Changed workflow fires once (and does not re-fire on subsequent syncs since value stays `'true'`).
