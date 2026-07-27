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
