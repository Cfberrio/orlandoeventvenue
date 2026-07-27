/**
 * Tests for the one_hour_report feature.
 *
 * Mirror-logic pattern (same as balance-payment.test.ts): edge functions are
 * standalone and can't be imported, so the scheduling/condition logic is
 * replicated here as pure functions and the production code must match.
 *
 * NOTE: run with TZ=UTC (matches the edge runtime, which parses
 * timezone-less date strings as UTC): TZ=UTC deno test <this file>
 *
 * The one_hour_report scheduling is DST-aware: it converts the event end
 * time using real Orlando local time (America/New_York), so the resulting
 * UTC instant differs between EDT (UTC-4, roughly March-November) and EST
 * (UTC-5, the rest of the year). This differs from the legacy
 * host_report_step flow (30d/7d/1d reminders), which intentionally keeps a
 * fixed -5 offset and is not covered by this file.
 *
 * Production locations:
 * - scheduling math: supabase/functions/schedule-host-report-reminders/index.ts
 * - fire conditions: supabase/functions/process-scheduled-jobs/index.ts
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

/**
 * Millisecond offset of a timezone at a given instant (offset = tzWallClock - UTC).
 * Mirrors tzOffsetMs in schedule-host-report-reminders/index.ts.
 */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const asIfUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    parts.hour === "24" ? 0 : Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  return asIfUtc - date.getTime();
}

/**
 * Converts a date + time string interpreted as Orlando local time (America/New_York,
 * DST-aware) to the corresponding UTC Date. Mirrors orlandoLocalToUTC in
 * schedule-host-report-reminders/index.ts.
 */
function orlandoLocalToUTC(dateStr: string, timeStr: string): Date {
  const asUtcMs = Date.parse(`${dateStr}T${timeStr}Z`);
  const offset = tzOffsetMs(new Date(asUtcMs), "America/New_York");
  return new Date(asUtcMs - offset);
}

/** End of the event in UTC ms. Daily or missing end_time → 23:59:59 Orlando. */
function computeEventEndOrlandoUTC(
  eventDate: string,
  bookingType: string | null,
  endTime: string | null,
): Date {
  if (bookingType === "daily" || !endTime) {
    return orlandoLocalToUTC(eventDate, "23:59:59");
  }
  return orlandoLocalToUTC(eventDate, endTime);
}

/** run_at = end - 1h, clamped to now (smart catch-up for short notice). */
function computeOneHourReportRunAt(eventEndUtcMs: number, nowMs: number): number {
  const t = eventEndUtcMs - 60 * 60 * 1000;
  return Math.max(t, nowMs);
}

/** Past-event guard: only schedule if the event hasn't ended yet. */
function shouldScheduleOneHourReport(nowMs: number, eventEndMs: number): boolean {
  return nowMs <= eventEndMs;
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

Deno.test("one_hour_report: hourly 3-7pm Orlando (EDT) fires at 6pm Orlando (22:00 UTC)", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "hourly", "19:00:00");
  assertEquals(end.toISOString(), "2026-08-15T23:00:00.000Z"); // 19:00 Orlando EDT (UTC-4)
  const runAt = computeOneHourReportRunAt(end.getTime(), Date.parse("2026-08-01T00:00:00Z"));
  assertEquals(new Date(runAt).toISOString(), "2026-08-15T22:00:00.000Z"); // 18:00 Orlando EDT
});

Deno.test("one_hour_report: daily booking (EDT) falls back to 23:59:59 → fires 22:59:59 Orlando", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "daily", null);
  assertEquals(end.toISOString(), "2026-08-16T03:59:59.000Z"); // 23:59:59 Orlando EDT
  const runAt = computeOneHourReportRunAt(end.getTime(), Date.parse("2026-08-01T00:00:00Z"));
  assertEquals(new Date(runAt).toISOString(), "2026-08-16T02:59:59.000Z"); // 22:59:59 Orlando EDT
});

Deno.test("one_hour_report: hourly booking missing end_time (EDT) uses same 23:59:59 fallback", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "hourly", null);
  assertEquals(end.toISOString(), "2026-08-16T03:59:59.000Z"); // 23:59:59 Orlando EDT
});

Deno.test("one_hour_report: short-notice booking (end-1h already passed) clamps run_at to now", () => {
  const end = computeEventEndOrlandoUTC("2026-08-15", "hourly", "19:00:00"); // end = 23:00:00Z, t = 22:00:00Z
  const now = Date.parse("2026-08-15T22:30:00Z"); // 6:30pm Orlando EDT, past the 6pm mark (t)
  const runAt = computeOneHourReportRunAt(end.getTime(), now);
  assertEquals(runAt, now);
});

Deno.test("one_hour_report: hourly 3-7pm Orlando (EST) fires at 6pm Orlando (23:00 UTC)", () => {
  const end = computeEventEndOrlandoUTC("2026-01-15", "hourly", "19:00:00");
  assertEquals(end.toISOString(), "2026-01-16T00:00:00.000Z"); // 19:00 Orlando EST (UTC-5)
  const runAt = computeOneHourReportRunAt(end.getTime(), Date.parse("2026-01-01T00:00:00Z"));
  assertEquals(new Date(runAt).toISOString(), "2026-01-15T23:00:00.000Z"); // 18:00 Orlando EST
});

// ==================== Past-event guard ====================

Deno.test("one_hour_report: future event is scheduled", () => {
  const nowMs = Date.parse("2026-08-01T00:00:00Z");
  const eventEndMs = Date.parse("2026-08-15T23:00:00Z");
  assertEquals(shouldScheduleOneHourReport(nowMs, eventEndMs), true);
});

Deno.test("one_hour_report: already-ended event is not scheduled", () => {
  const nowMs = Date.parse("2026-08-16T00:00:00Z");
  const eventEndMs = Date.parse("2026-08-15T23:00:00Z");
  assertEquals(shouldScheduleOneHourReport(nowMs, eventEndMs), false);
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
