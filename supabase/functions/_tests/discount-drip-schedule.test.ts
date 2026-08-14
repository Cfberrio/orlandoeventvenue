/**
 * Tests for the popup lead-magnet drip schedule.
 *
 * Mirror-logic pattern (same as one-hour-report.test.ts): edge functions are
 * standalone and can't be imported, so the scheduling logic is replicated here
 * as pure functions and the production code in
 * supabase/functions/process-discount-drip/index.ts must match.
 *
 * Run with TZ=UTC (matches the edge runtime):
 *   TZ=UTC deno test supabase/functions/_tests/discount-drip-schedule.test.ts
 *
 * Spec (ClickUp 8cqnrff-11737). Each step pairs an email with an SMS; the SMS
 * half lives in GoHighLevel workflows fired by the `popup` tag and must carry
 * the same delays.
 *   E01 + S01 - immediately on submit
 *   E02 + S02 - 24 hours after E01
 *   E03 + S03 - 48 hours after E01 (measured as 24 hours after E02 shipped)
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const EMAIL_2_DELAY_HOURS = 24;
const EMAIL_3_DELAY_HOURS = 24;
const HOUR_MS = 60 * 60 * 1000;

/* ---------- mirrored from process-discount-drip/index.ts ---------- */

/** Email 2 is due 24 hours after Email 1 actually went out. */
function email2DueAt(email1SentAt: Date): Date {
  return new Date(email1SentAt.getTime() + EMAIL_2_DELAY_HOURS * HOUR_MS);
}

/**
 * Email 3 is due 24 hours after Email 2 actually went out - deliberately keyed
 * off Email 2 and not off signup, so a late Email 2 pushes Email 3 back instead
 * of making both fire in the same run.
 */
function email3DueAt(email2SentAt: Date): Date {
  return new Date(email2SentAt.getTime() + EMAIL_3_DELAY_HOURS * HOUR_MS);
}

/* ---------- Email 2 ---------- */

Deno.test("Email 2 is due exactly 24 hours after Email 1", () => {
  const email1Sent = new Date("2026-07-15T14:00:00Z");
  assertEquals(email2DueAt(email1Sent).toISOString(), "2026-07-16T14:00:00.000Z");
});

Deno.test("Email 2 is never due before signup day + 1", () => {
  for (let hour = 0; hour < 24; hour++) {
    const email1Sent = new Date(`2026-07-15T${String(hour).padStart(2, "0")}:00:00Z`);
    const due = email2DueAt(email1Sent);
    assertEquals(due.getTime() - email1Sent.getTime(), 24 * HOUR_MS);
    assertEquals(due > email1Sent, true);
  }
});

/* ---------- Email 3 ---------- */

Deno.test("Email 3 is due exactly 24 hours after Email 2 went out", () => {
  const email2Sent = new Date("2026-07-16T14:03:00Z");
  assertEquals(email3DueAt(email2Sent).toISOString(), "2026-07-17T14:03:00.000Z");
});

Deno.test("Email 3 lands 48 hours into the sequence when Email 2 is on time", () => {
  const email1Sent = new Date("2026-07-15T14:00:00Z");
  const email2Sent = email2DueAt(email1Sent);
  const email3Due = email3DueAt(email2Sent);

  assertEquals(email3Due.getTime() - email1Sent.getTime(), 48 * HOUR_MS);
});

Deno.test("A late Email 2 pushes Email 3 back instead of firing both at once", () => {
  // Reproduces the ANDREINA incident: Email 2 shipped 3 days after signup.
  const email1Sent = new Date("2026-08-10T17:40:09Z");
  const email2Sent = new Date("2026-08-14T00:30:12Z"); // 78 hours late
  const email3Due = email3DueAt(email2Sent);

  // Email 3 must still wait a full day after Email 2, never the same minute.
  assertEquals(email3Due.getTime() - email2Sent.getTime(), 24 * HOUR_MS);
  assertEquals(email3Due > email2Sent, true);
  assertEquals(email3Due.toISOString(), "2026-08-15T00:30:12.000Z");
  void email1Sent;
});

/* ---------- Ordering ---------- */

Deno.test("The full sequence stays strictly in order", () => {
  const email1Sent = new Date("2026-07-15T14:00:00Z");
  // The cron runs every 15 minutes, so the real send can lag slightly.
  const email2Sent = new Date(email2DueAt(email1Sent).getTime() + 7 * 60 * 1000);
  const email3Sent = new Date(email3DueAt(email2Sent).getTime() + 11 * 60 * 1000);

  assertEquals(email1Sent < email2Sent, true);
  assertEquals(email2Sent < email3Sent, true);
});

Deno.test("Cron lag can never collapse two steps into the same run", () => {
  // Even with a full cron interval of lag on each step, consecutive sends stay
  // at least 24 hours apart.
  const cronLagMs = 15 * 60 * 1000;
  const email1Sent = new Date("2026-01-15T23:50:00Z");
  const email2Sent = new Date(email2DueAt(email1Sent).getTime() + cronLagMs);
  const email3Sent = new Date(email3DueAt(email2Sent).getTime() + cronLagMs);

  assertEquals(email2Sent.getTime() - email1Sent.getTime() >= 24 * HOUR_MS, true);
  assertEquals(email3Sent.getTime() - email2Sent.getTime() >= 24 * HOUR_MS, true);
});
