/**
 * Tests for the post_event transition decision logic, including the
 * 10-day host-report timeout (forced transition).
 *
 * Mirror-logic pattern (same as one-hour-report.test.ts): edge functions are
 * standalone and can't be imported, so the decision logic is replicated here
 * as a pure function and the production code must match.
 *
 * NOTE: run with TZ=UTC (matches the edge runtime, which parses
 * timezone-less date strings as UTC): TZ=UTC deno test <this file>
 *
 * Production location:
 * - supabase/functions/check-post-event-transition/index.ts
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const HOST_REPORT_TIMEOUT_DAYS = 10;

type Decision = "transition" | "forced_timeout" | "pending_host_report" | "pending_24h";

/**
 * Mirrors the per-booking branch in check-post-event-transition/index.ts:
 * event end computation (daily → 23:59:59, hourly → end_time), then
 * transition / forced-timeout / pending classification.
 */
function decide(
  now: Date,
  booking: { event_date: string; end_time: string | null; booking_type: string | null },
  hostReportCompleted: boolean,
): Decision {
  let eventEndDateTime: Date;
  if (booking.booking_type === "daily" || !booking.end_time) {
    eventEndDateTime = new Date(`${booking.event_date}T23:59:59`);
  } else {
    eventEndDateTime = new Date(`${booking.event_date}T${booking.end_time}`);
  }

  const eventEndPlus24h = new Date(eventEndDateTime.getTime() + 24 * 60 * 60 * 1000);
  const has24hPassed = now >= eventEndPlus24h;

  const timeoutAt = new Date(eventEndDateTime.getTime() + HOST_REPORT_TIMEOUT_DAYS * 24 * 60 * 60 * 1000);
  const timeoutPassed = now >= timeoutAt;

  if (hostReportCompleted && has24hPassed) return "transition";
  if (!hostReportCompleted && timeoutPassed) return "forced_timeout";
  if (!hostReportCompleted) return "pending_host_report";
  return "pending_24h";
}

const hourly = { event_date: "2026-07-10", end_time: "05:00:00", booking_type: "hourly" };
const daily = { event_date: "2026-07-10", end_time: null, booking_type: "daily" };

Deno.test("report submitted + 24h passed → normal transition", () => {
  assertEquals(decide(new Date("2026-07-12T00:00:00Z"), hourly, true), "transition");
});

Deno.test("report submitted but <24h → pending_24h", () => {
  assertEquals(decide(new Date("2026-07-10T20:00:00Z"), hourly, true), "pending_24h");
});

Deno.test("no report, <10 days → pending_host_report (no forced transition)", () => {
  assertEquals(decide(new Date("2026-07-15T00:00:00Z"), hourly, false), "pending_host_report");
});

Deno.test("no report, just before 10-day boundary → still pending", () => {
  // timeout at event end (07-10 05:00) + 10d = 07-20 05:00
  assertEquals(decide(new Date("2026-07-20T04:59:59Z"), hourly, false), "pending_host_report");
});

Deno.test("no report, exactly at 10-day boundary → forced timeout", () => {
  assertEquals(decide(new Date("2026-07-20T05:00:00Z"), hourly, false), "forced_timeout");
});

Deno.test("no report, way past timeout (jayshree case: 24 days) → forced timeout", () => {
  assertEquals(decide(new Date("2026-08-03T15:00:00Z"), hourly, false), "forced_timeout");
});

Deno.test("daily booking uses 23:59:59 as event end for the timeout", () => {
  // timeout at 07-10 23:59:59 + 10d = 07-20 23:59:59
  assertEquals(decide(new Date("2026-07-20T23:00:00Z"), daily, false), "pending_host_report");
  assertEquals(decide(new Date("2026-07-21T00:00:00Z"), daily, false), "forced_timeout");
});

Deno.test("report submitted after timeout window still takes the normal path", () => {
  // Late report beats the forced path: forced branch requires !hostReportCompleted
  assertEquals(decide(new Date("2026-07-25T00:00:00Z"), hourly, true), "transition");
});

/**
 * Mirrors the stale pending_review classification in daily-health-check 6c:
 * CRITICAL when any flagged booking has payments, HIGH otherwise.
 */
function stalePendingReviewSeverity(
  bookings: Array<{ payment_status: string }>,
): "CRITICAL" | "HIGH" {
  const paid = bookings.filter(b =>
    b.payment_status === "deposit_paid" || b.payment_status === "fully_paid"
  );
  return paid.length > 0 ? "CRITICAL" : "HIGH";
}

Deno.test("stale pending_review with fully_paid booking → CRITICAL (Keshie case)", () => {
  assertEquals(
    stalePendingReviewSeverity([{ payment_status: "fully_paid" }]),
    "CRITICAL",
  );
});

Deno.test("stale pending_review with deposit_paid → CRITICAL", () => {
  assertEquals(
    stalePendingReviewSeverity([{ payment_status: "deposit_paid" }, { payment_status: "pending" }]),
    "CRITICAL",
  );
});

Deno.test("stale pending_review without payments → HIGH", () => {
  assertEquals(
    stalePendingReviewSeverity([{ payment_status: "pending" }]),
    "HIGH",
  );
});
