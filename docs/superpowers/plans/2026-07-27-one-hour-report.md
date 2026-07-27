# One Hour Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip a new `bookings.one_hour_report` text field to `"true"` exactly 1 hour before a booking's end time and sync it to GHL, so GHL's Contact Changed workflow sends the Guest Report closeout email + SMS.

**Architecture:** No new edge functions. `schedule-host-report-reminders` gains job creation for a new `one_hour_report` job type; `process-scheduled-jobs` gains an execution branch that validates conditions, flips the field, and calls `sync-to-ghl`; `sync-to-ghl` adds the field to the snapshot POSTed to the GHL inbound webhook. One DB migration adds the column.

**Tech Stack:** Supabase edge functions (Deno/TypeScript), Postgres migration (SQL), `Deno.test` mirror-logic tests in `supabase/functions/_tests/`.

## Global Constraints

- Field values are TEXT `'false'` / `'true'` — never boolean (GHL custom fields are text; matches `is_deposit_paid` etc.).
- Names everywhere: column `one_hour_report`, job_type `one_hour_report`, snapshot key `one_hour_report`.
- Orlando timezone handling uses the existing `toOrlandoUTC()` helper with fixed `ORLANDO_OFFSET_HOURS = -5` — do not introduce a new timezone approach.
- Daily bookings / missing `end_time` fall back to end = `23:59:59` (same as `check-post-event-transition`).
- One-shot: once `one_hour_report='true'`, never reset, never re-fire (even on reschedule).
- Edge functions in this repo are standalone files; they do not import shared modules. Tests mirror logic as pure functions inside the test file (see `_tests/balance-payment.test.ts` for the established pattern).
- Commit messages end with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: DB migration — `one_hour_report` column

**Files:**
- Create: `supabase/migrations/20260728000000_add_one_hour_report.sql`

**Interfaces:**
- Produces: column `public.bookings.one_hour_report TEXT NOT NULL DEFAULT 'false'` — read/written by Tasks 3, 4, 5.

- [ ] **Step 1: Write the migration**

```sql
-- Add one_hour_report field to bookings.
-- Flipped to 'true' by process-scheduled-jobs exactly 1 hour before the
-- booking's end time (job scheduled by schedule-host-report-reminders).
-- Synced to GHL as a text custom field; GHL's Contact Changed workflow
-- sends the Guest Report closeout email + SMS when it changes to 'true'.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS one_hour_report TEXT NOT NULL DEFAULT 'false';

COMMENT ON COLUMN public.bookings.one_hour_report IS
  'Text flag (''false''/''true''). Set to ''true'' 1 hour before booking end time to trigger the GHL Guest Report closeout email/SMS via Contact Changed. One-shot: never reset.';
```

- [ ] **Step 2: Sanity-check the SQL parses**

Run: `psql --version >/dev/null 2>&1 && echo ok || echo "skip local parse"` then visually confirm the file has no unbalanced quotes (note the doubled `''` inside the COMMENT string).
Expected: file saved, quoting correct.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260728000000_add_one_hour_report.sql
git commit -m "feat(db): add bookings.one_hour_report text flag

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: sync-to-ghl — include `one_hour_report` in snapshot

**Files:**
- Modify: `supabase/functions/sync-to-ghl/index.ts` (three spots: `BookingSnapshot` interface ~line 62-108, `BookingRow` interface ~line 111-138, snapshot return object ~line 288-333)

**Interfaces:**
- Consumes: `bookings.one_hour_report` column from Task 1.
- Produces: snapshot JSON key `one_hour_report: string` (`"false"`/`"true"`) POSTed to `GHL_BOOKING_WEBHOOK_URL`. Task 6 (GHL manual setup) maps this key.

- [ ] **Step 1: Add to `BookingSnapshot` interface**

In the `BookingSnapshot` interface, directly after the line `host_report_step: string | null;`, add:

```typescript
  one_hour_report: string;
```

- [ ] **Step 2: Add to `BookingRow` interface**

In the `BookingRow` interface, directly after the line `host_report_step: string | null;`, add:

```typescript
  one_hour_report: string | null;
```

- [ ] **Step 3: Add to the returned snapshot**

In the `return {...}` of `buildBookingSnapshot`, directly after the line `host_report_step: booking.host_report_step,`, add:

```typescript
    one_hour_report: booking.one_hour_report || "false",
```

(The booking query is `select("*")` so no query change is needed.)

- [ ] **Step 4: Type-check**

Run: `deno check supabase/functions/sync-to-ghl/index.ts`
Expected: no errors (remote-import warnings are fine if they appear for other files too).

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sync-to-ghl/index.ts
git commit -m "feat(ghl): add one_hour_report to booking snapshot

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Mirror-logic tests for scheduling math

**Files:**
- Create: `supabase/functions/_tests/one-hour-report.test.ts`

**Interfaces:**
- Produces: pure functions `computeEventEndOrlandoUTC(eventDate, bookingType, endTime)` and `computeOneHourReportRunAt(eventEndUtcMs, nowMs)` mirrored by Task 4's production code, plus `shouldFireOneHourReport(booking, staffCount, hostReportCount)` mirrored by Task 5. Tests define the expected behavior; production code in Tasks 4-5 must match it.

- [ ] **Step 1: Write the test file (failing is N/A — mirror pattern, tests carry the logic)**

```typescript
/**
 * Tests for the one_hour_report feature.
 *
 * Mirror-logic pattern (same as balance-payment.test.ts): edge functions are
 * standalone and can't be imported, so the scheduling/condition logic is
 * replicated here as pure functions and the production code must match.
 *
 * Production locations:
 * - scheduling math: supabase/functions/schedule-host-report-reminders/index.ts
 * - fire conditions: supabase/functions/process-scheduled-jobs/index.ts
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const ORLANDO_OFFSET_HOURS = -5;

function toOrlandoUTC(dateStr: string, timeStr: string): Date {
  const localDate = new Date(`${dateStr}T${timeStr}`);
  return new Date(localDate.getTime() - ORLANDO_OFFSET_HOURS * 60 * 60 * 1000);
}

/** End of the event in UTC ms. Daily or missing end_time → 23:59:59 Orlando. */
function computeEventEndOrlandoUTC(
  eventDate: string,
  bookingType: string | null,
  endTime: string | null,
): Date {
  if (bookingType === "daily" || !endTime) {
    return toOrlandoUTC(eventDate, "23:59:59");
  }
  return toOrlandoUTC(eventDate, endTime);
}

/** run_at = end - 1h, clamped to now (smart catch-up for short notice). */
function computeOneHourReportRunAt(eventEndUtcMs: number, nowMs: number): number {
  const t = eventEndUtcMs - 60 * 60 * 1000;
  return Math.max(t, nowMs);
}

interface FireCheckBooking {
  status: string;
  payment_status: string;
  one_hour_report: string | null;
}

/** Returns "fire" | cancel/skip reason. Mirrors process-scheduled-jobs branch. */
function shouldFireOneHourReport(
  booking: FireCheckBooking | null,
  staffCount: number,
  hostReportCount: number,
): string {
  if (!booking) return "booking_not_found_for_one_hour_report";
  if (booking.status === "cancelled") return "booking_cancelled_before_one_hour_report";
  if (booking.payment_status !== "deposit_paid" && booking.payment_status !== "fully_paid") {
    return "deposit_not_paid";
  }
  if (staffCount < 1) return "no_staff_assigned";
  if (hostReportCount > 0) return "host_report_already_completed";
  if (booking.one_hour_report === "true") return "already_fired";
  return "fire";
}

// ==================== Scheduling math ====================

Deno.test("one_hour_report: hourly 3-7pm Orlando fires at 6pm Orlando (23:00 UTC)", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "hourly", "19:00:00");
  const runAt = computeOneHourReportRunAt(end.getTime(), Date.parse("2026-08-01T00:00:00Z"));
  assertEquals(new Date(runAt).toISOString(), "2026-08-15T23:00:00.000Z"); // 18:00 Orlando
});

Deno.test("one_hour_report: daily booking falls back to 23:59:59 → fires 22:59:59 Orlando", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "daily", null);
  const runAt = computeOneHourReportRunAt(end.getTime(), Date.parse("2026-08-01T00:00:00Z"));
  assertEquals(new Date(runAt).toISOString(), "2026-08-16T03:59:59.000Z"); // 22:59:59 Orlando
});

Deno.test("one_hour_report: hourly booking missing end_time uses same 23:59:59 fallback", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "hourly", null);
  assertEquals(end.toISOString(), "2026-08-16T04:59:59.000Z"); // 23:59:59 Orlando
});

Deno.test("one_hour_report: short-notice booking (end-1h already passed) clamps run_at to now", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "hourly", "19:00:00");
  const now = Date.parse("2026-08-15T23:30:00Z"); // 6:30pm Orlando, past the 6pm mark
  const runAt = computeOneHourReportRunAt(end.getTime(), now);
  assertEquals(runAt, now);
});

// ==================== Fire conditions ====================

const baseBooking: FireCheckBooking = {
  status: "confirmed",
  payment_status: "deposit_paid",
  one_hour_report: "false",
};

Deno.test("one_hour_report: fires with deposit paid + staff + no host report", () => {
  assertEquals(shouldFireOneHourReport(baseBooking, 1, 0), "fire");
});

Deno.test("one_hour_report: fires when fully paid", () => {
  assertEquals(
    shouldFireOneHourReport({ ...baseBooking, payment_status: "fully_paid" }, 2, 0),
    "fire",
  );
});

Deno.test("one_hour_report: missing booking cancels", () => {
  assertEquals(shouldFireOneHourReport(null, 1, 0), "booking_not_found_for_one_hour_report");
});

Deno.test("one_hour_report: cancelled booking cancels", () => {
  assertEquals(
    shouldFireOneHourReport({ ...baseBooking, status: "cancelled" }, 1, 0),
    "booking_cancelled_before_one_hour_report",
  );
});

Deno.test("one_hour_report: pending payment cancels", () => {
  assertEquals(
    shouldFireOneHourReport({ ...baseBooking, payment_status: "pending" }, 1, 0),
    "deposit_not_paid",
  );
});

Deno.test("one_hour_report: no staff assigned cancels", () => {
  assertEquals(shouldFireOneHourReport(baseBooking, 0, 0), "no_staff_assigned");
});

Deno.test("one_hour_report: host report already completed cancels", () => {
  assertEquals(shouldFireOneHourReport(baseBooking, 1, 1), "host_report_already_completed");
});

Deno.test("one_hour_report: already fired is idempotent (no re-fire)", () => {
  assertEquals(
    shouldFireOneHourReport({ ...baseBooking, one_hour_report: "true" }, 1, 0),
    "already_fired",
  );
});
```

- [ ] **Step 2: Run the tests**

Run: `deno test supabase/functions/_tests/one-hour-report.test.ts`
Expected: 12 tests PASS (the mirror functions are self-contained; these tests lock in the behavior Tasks 4-5 must reproduce).

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/_tests/one-hour-report.test.ts
git commit -m "test: mirror-logic tests for one_hour_report scheduling and conditions

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: schedule-host-report-reminders — create the `one_hour_report` job

**Files:**
- Modify: `supabase/functions/schedule-host-report-reminders/index.ts`

**Interfaces:**
- Consumes: `bookings.one_hour_report` (Task 1); `toOrlandoUTC()` helper already in the file.
- Produces: `scheduled_jobs` rows with `job_type='one_hour_report'`, `run_at = max(end - 1h, now)`, `status='pending'` — consumed by Task 5. Must match `computeEventEndOrlandoUTC` / `computeOneHourReportRunAt` semantics from Task 3.

- [ ] **Step 1: Extend the host-report-completed early-return to also cancel `one_hour_report` jobs**

At ~line 164, the cancellation list currently reads:

```typescript
        .in("job_type", ["host_report_pre_start", "host_report_during", "host_report_post"])
```

Change it to:

```typescript
        .in("job_type", ["host_report_pre_start", "host_report_during", "host_report_post", "one_hour_report"])
```

(Spec: host report already completed → no closeout email; the early return previously skipped scheduling anyway, this also kills an already-pending job.)

- [ ] **Step 2: Extend the `force_reschedule` cancellation the same way**

At ~line 376 (inside the `if (force_reschedule)` block), apply the identical change:

```typescript
        .in("job_type", ["host_report_pre_start", "host_report_during", "host_report_post", "one_hour_report"])
```

- [ ] **Step 3: Add the one-hour-report scheduling block**

Directly AFTER the closing brace of the smart catch-up `if/else` chain (the `else` block ending with `jobsToCreate.push({ job_type: "host_report_post", ... });` and its closing `}` at ~line 295), and BEFORE the `// If there's an immediate step to set` comment, insert:

```typescript
    // ===============================
    // ONE HOUR REPORT (guest report closeout trigger)
    // ===============================
    // Fires 1 hour before the event END so GHL sends the Guest Report
    // email/SMS while the host is still on site. One-shot: never re-fires.
    if (booking.one_hour_report !== "true") {
      let eventEndOrlando: Date;
      if (booking.booking_type === "daily" || !booking.end_time) {
        // Daily or missing end_time: end of day Orlando (same fallback as
        // check-post-event-transition) → email at 22:59:59
        eventEndOrlando = toOrlandoUTC(booking.event_date, "23:59:59");
      } else {
        eventEndOrlando = toOrlandoUTC(booking.event_date, booking.end_time);
      }

      const t_one_hour_ms = eventEndOrlando.getTime() - 60 * 60 * 1000;
      // Smart catch-up: if end-1h already passed, run on the next cron tick
      const runAtMs = Math.max(t_one_hour_ms, nowMs);

      jobsToCreate.push({
        job_type: "one_hour_report",
        run_at: new Date(runAtMs).toISOString(),
      });
      console.log(
        `one_hour_report job queued: run_at=${new Date(runAtMs).toISOString()} ` +
        `(event end ${eventEndOrlando.toISOString()}, catch_up=${runAtMs !== t_one_hour_ms})`
      );
    } else {
      console.log("one_hour_report already 'true' - not scheduling (one-shot)");
    }
```

Notes for the implementer:
- `nowMs` already exists in scope (~line 217).
- The existing job-insertion block below (~line 388-441) dedups against pending jobs of the same `job_type` and inserts — the new job type flows through it with zero changes.

- [ ] **Step 4: Type-check**

Run: `deno check supabase/functions/schedule-host-report-reminders/index.ts`
Expected: no errors.

- [ ] **Step 5: Re-run mirror tests (guard against drift)**

Run: `deno test supabase/functions/_tests/one-hour-report.test.ts`
Expected: PASS. Then eyeball that Step 3's math (`23:59:59` fallback, `- 60 * 60 * 1000`, `Math.max(..., nowMs)`) matches `computeEventEndOrlandoUTC`/`computeOneHourReportRunAt` in the test file exactly.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/schedule-host-report-reminders/index.ts
git commit -m "feat(host-report): schedule one_hour_report job at event end minus 1h

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: process-scheduled-jobs — execute the `one_hour_report` job

**Files:**
- Modify: `supabase/functions/process-scheduled-jobs/index.ts`

**Interfaces:**
- Consumes: `scheduled_jobs` rows with `job_type='one_hour_report'` (Task 4); `bookings.one_hour_report` (Task 1); `sync-to-ghl` (Task 2). Condition semantics must match `shouldFireOneHourReport` from Task 3.
- Produces: `bookings.one_hour_report='true'`, `booking_events` row `one_hour_report_triggered`, GHL sync.

- [ ] **Step 1: Add the job-type constant**

After line 16 (`const HOST_REPORT_JOB_TYPES = ...`), add:

```typescript
// One hour report (guest report closeout trigger) job types
const ONE_HOUR_REPORT_JOB_TYPES = ["one_hour_report"];
```

- [ ] **Step 2: Add the execution branch**

Insert a new `else if` branch AFTER the host-report branch's closing (the line `console.log(\`Job ${job.id} completed - booking ${job.booking_id} host_report_step changed: ...\`);` at ~line 1022) and BEFORE the `// GUEST FEEDBACK JOBS` comment block:

```typescript
        // ===============================
        // ONE HOUR REPORT JOBS (guest report closeout trigger)
        // ===============================
        } else if (ONE_HOUR_REPORT_JOB_TYPES.includes(job.job_type)) {
          const { data: booking, error: bookingError } = await supabase
            .from("bookings")
            .select("id, status, payment_status, reservation_number, one_hour_report")
            .eq("id", job.booking_id)
            .maybeSingle();

          // Helper to cancel this job with a reason
          const cancelOneHourJob = async (reason: string) => {
            await supabase
              .from("scheduled_jobs")
              .update({
                status: "cancelled",
                last_error: reason,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.cancelled++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: reason });
          };

          if (bookingError || !booking) {
            console.error(`Booking not found for one_hour_report job ${job.id}:`, bookingError);
            await cancelOneHourJob("booking_not_found_for_one_hour_report");
            continue;
          }

          if (booking.status === "cancelled") {
            console.log(`Booking ${job.booking_id} cancelled - cancelling one_hour_report job ${job.id}`);
            await cancelOneHourJob("booking_cancelled_before_one_hour_report");
            continue;
          }

          if (booking.payment_status !== "deposit_paid" && booking.payment_status !== "fully_paid") {
            console.log(`Booking ${job.booking_id} deposit not paid (${booking.payment_status}) - cancelling one_hour_report job`);
            await cancelOneHourJob("deposit_not_paid");
            continue;
          }

          // Requires at least 1 staff assigned (any role)
          const { data: staffRows } = await supabase
            .from("booking_staff_assignments")
            .select("id")
            .eq("booking_id", job.booking_id)
            .limit(1);

          if (!staffRows || staffRows.length === 0) {
            console.log(`Booking ${job.booking_id} has no staff assigned - cancelling one_hour_report job`);
            await cancelOneHourJob("no_staff_assigned");
            continue;
          }

          // Skip if host (guest) report already submitted - email would be pointless
          const { data: hostReports } = await supabase
            .from("booking_host_reports")
            .select("id")
            .eq("booking_id", job.booking_id)
            .limit(1);

          if (hostReports && hostReports.length > 0) {
            console.log(`Host report already completed for booking ${job.booking_id} - cancelling one_hour_report job`);
            await cancelOneHourJob("host_report_already_completed");
            continue;
          }

          // Idempotency: already fired → complete without update (no GHL re-trigger)
          if (booking.one_hour_report === "true") {
            console.log(`Booking ${job.booking_id} one_hour_report already 'true' - marking job complete without update`);
            await supabase
              .from("scheduled_jobs")
              .update({
                status: "completed",
                completed_at: new Date().toISOString(),
                last_error: "already_fired",
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.skipped++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "skipped", error: "already_fired" });
            continue;
          }

          // Flip the flag
          console.log(`Setting one_hour_report='true' for booking ${job.booking_id}`);
          const { error: updateError } = await supabase
            .from("bookings")
            .update({
              one_hour_report: "true",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.booking_id);

          if (updateError) {
            console.error(`Failed to set one_hour_report for booking ${job.booking_id}:`, updateError);
            const newAttempts = job.attempts + 1;
            const newStatus = newAttempts >= 3 ? "failed" : "pending";
            await supabase
              .from("scheduled_jobs")
              .update({
                status: newStatus,
                last_error: `db_update_failed: ${updateError.message}`,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.failed++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: newStatus, error: `db_update_failed: ${updateError.message}` });
            continue;
          }

          // Log the trigger event
          await supabase.from("booking_events").insert({
            booking_id: job.booking_id,
            event_type: "one_hour_report_triggered",
            channel: "system",
            metadata: {
              job_id: job.id,
              reservation_number: booking.reservation_number,
              timestamp: new Date().toISOString(),
            },
          });

          // CRITICAL: sync to GHL immediately - Contact Changed fires the email/SMS
          console.log(`CRITICAL: Calling syncToGHL for booking ${job.booking_id} after one_hour_report flip`);
          try {
            const syncResponse = await fetch(
              `${supabaseUrl}/functions/v1/sync-to-ghl`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({ booking_id: job.booking_id }),
              }
            );

            if (!syncResponse.ok) {
              const syncError = await syncResponse.text();
              console.error(`syncToGHL FAILED for booking ${job.booking_id}:`, syncError);
              await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "sync_to_ghl_failed",
                channel: "system",
                metadata: {
                  context: "one_hour_report_trigger",
                  error: syncError,
                },
              });
            } else {
              console.log(`syncToGHL SUCCESS for booking ${job.booking_id} (one_hour_report)`);
              await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "sync_to_ghl_success",
                channel: "system",
                metadata: {
                  context: "one_hour_report_trigger",
                },
              });
            }
          } catch (syncError) {
            console.error(`syncToGHL EXCEPTION for booking ${job.booking_id}:`, syncError);
          }

          // Mark job as completed
          await supabase
            .from("scheduled_jobs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.succeeded++;
          results.details.push({ job_id: job.id, job_type: job.job_type, status: "completed" });
          console.log(`Job ${job.id} completed - one_hour_report fired for booking ${job.booking_id}`);

```

- [ ] **Step 3: Type-check**

Run: `deno check supabase/functions/process-scheduled-jobs/index.ts`
Expected: no errors.

- [ ] **Step 4: Verify condition parity with the mirror tests**

Run: `deno test supabase/functions/_tests/one-hour-report.test.ts`
Expected: PASS. Manually confirm the branch's check ORDER matches `shouldFireOneHourReport`: not-found → cancelled → payment → staff → host report → already-fired. Order matters because the first failing check names the cancel reason.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/process-scheduled-jobs/index.ts
git commit -m "feat(jobs): execute one_hour_report job - flip flag and sync to GHL

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Deploy + GHL wiring + E2E verification

**Files:**
- None (operational).

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Push the migration**

```bash
cd /Users/cberrio04/Documents/OEV-PROJECT && supabase db push
```

Expected: `20260728000000_add_one_hour_report.sql` applied. Verify:

```bash
supabase db execute --sql "SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_name='bookings' AND column_name='one_hour_report';" 2>/dev/null || echo "verify in Supabase dashboard SQL editor"
```

- [ ] **Step 2: Deploy the three modified functions**

```bash
supabase functions deploy sync-to-ghl schedule-host-report-reminders process-scheduled-jobs
```

Expected: 3 functions deployed without error.

- [ ] **Step 3: GHL manual setup (Cristian)**

1. Create a **text** custom field in GHL (e.g. `oev_one_hour_report`).
2. In the inbound-webhook workflow that maps the booking snapshot, map JSON key `one_hour_report` → that field.
3. Create workflow: trigger **Contact Changed**, filter: the field equals `true` → send the Guest Report email + SMS (copy already written).

- [ ] **Step 4: E2E test with a real test booking**

1. Create/confirm a test booking (deposit paid, staff assigned) ending ~1.5h from now.
2. Call `schedule-host-report-reminders` for it and confirm a `scheduled_jobs` row with `job_type='one_hour_report'` and `run_at` = end−1h exists.
3. Wait for the cron tick past run_at (or temporarily set `run_at=now()` on the row): confirm `bookings.one_hour_report='true'`, `booking_events` has `one_hour_report_triggered`, GHL contact field updated, email + SMS received ONCE.
4. Trigger any other sync (e.g. re-run sync-to-ghl) and confirm the workflow does NOT re-fire (value unchanged at `'true'`).

- [ ] **Step 5: Negative-path spot check**

On a second test booking with NO staff assigned, set the job's `run_at=now()` and confirm the job lands in `status='cancelled'`, `last_error='no_staff_assigned'`, and no email goes out.
