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
 * Spec (ClickUp 8cqnrff-11737, timing confirmed by the venue owner):
 *   Email 1 - immediately on submit
 *   Email 2 - 8 AM Orlando time the day after submit
 *   Email 3 - 24 hours after Email 2 actually went out
 */

import { assertEquals } from "https://deno.land/std@0.190.0/testing/asserts.ts";

const EMAIL_2_SEND_HOUR_ET = 8;
const EMAIL_3_DELAY_HOURS = 24;
const ORLANDO_TZ = "America/New_York";

/* ---------- mirrored from process-discount-drip/index.ts ---------- */

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

function orlandoDateParts(date: Date): { year: number; month: number; day: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone: ORLANDO_TZ,
    year: "numeric", month: "2-digit", day: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

function nextMorningInOrlando(signupUtc: Date): Date {
  const { year, month, day } = orlandoDateParts(signupUtc);
  const naive = Date.UTC(year, month - 1, day + 1, EMAIL_2_SEND_HOUR_ET, 0, 0);
  const firstGuess = new Date(naive - tzOffsetMs(new Date(naive), ORLANDO_TZ));
  return new Date(naive - tzOffsetMs(firstGuess, ORLANDO_TZ));
}

function email3DueAt(email2SentAt: Date): Date {
  return new Date(email2SentAt.getTime() + EMAIL_3_DELAY_HOURS * 60 * 60 * 1000);
}

/** The wall-clock hour in Orlando for an instant, for readable assertions. */
function orlandoHour(date: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-US", { timeZone: ORLANDO_TZ, hour: "2-digit", hour12: false })
      .format(date)
      .replace("24", "00"),
  );
}

function orlandoDateString(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ORLANDO_TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

/* ---------- Email 2: always 8 AM Orlando, always the next day ---------- */

Deno.test("Email 2 lands at 8 AM Orlando time on the day after signup (summer, EDT)", () => {
  // 2026-07-15 14:00 UTC = 10:00 AM EDT
  const signup = new Date("2026-07-15T14:00:00Z");
  const due = nextMorningInOrlando(signup);

  assertEquals(orlandoDateString(due), "2026-07-16");
  assertEquals(orlandoHour(due), 8);
  assertEquals(due.toISOString(), "2026-07-16T12:00:00.000Z"); // EDT = UTC-4
});

Deno.test("Email 2 lands at 8 AM Orlando time on the day after signup (winter, EST)", () => {
  // 2026-01-15 15:00 UTC = 10:00 AM EST
  const signup = new Date("2026-01-15T15:00:00Z");
  const due = nextMorningInOrlando(signup);

  assertEquals(orlandoDateString(due), "2026-01-16");
  assertEquals(orlandoHour(due), 8);
  assertEquals(due.toISOString(), "2026-01-16T13:00:00.000Z"); // EST = UTC-5
});

Deno.test("A late-night signup still waits for the next morning, not the same one", () => {
  // 2026-07-16 03:30 UTC = 11:30 PM EDT on 2026-07-15
  const signup = new Date("2026-07-16T03:30:00Z");
  const due = nextMorningInOrlando(signup);

  // Local date of signup is the 15th, so email 2 belongs to the 16th.
  assertEquals(orlandoDateString(signup), "2026-07-15");
  assertEquals(orlandoDateString(due), "2026-07-16");
  assertEquals(orlandoHour(due), 8);
});

Deno.test("An early-morning signup does not get email 2 the same day", () => {
  // 2026-07-15 11:00 UTC = 7:00 AM EDT, one hour before the send hour
  const signup = new Date("2026-07-15T11:00:00Z");
  const due = nextMorningInOrlando(signup);

  assertEquals(orlandoDateString(due), "2026-07-16");
  assertEquals(due.getTime() - signup.getTime(), 25 * 60 * 60 * 1000);
});

Deno.test("Email 2 is never sent in the middle of the night, whatever the signup hour", () => {
  // Every hour of a full day, both in EST and EDT.
  for (const baseDay of ["2026-01-15", "2026-07-15"]) {
    for (let hour = 0; hour < 24; hour++) {
      const signup = new Date(`${baseDay}T${String(hour).padStart(2, "0")}:00:00Z`);
      const due = nextMorningInOrlando(signup);
      assertEquals(
        orlandoHour(due),
        8,
        `signup ${signup.toISOString()} produced a send at hour ${orlandoHour(due)} Orlando time`,
      );
      // And it is always in the future relative to signup.
      assertEquals(due.getTime() > signup.getTime(), true);
    }
  }
});

/* ---------- DST boundaries ---------- */

Deno.test("Spring forward: signup the day before the switch still sends at 8 AM local", () => {
  // DST 2026 starts Sunday 2026-03-08. Signup on the 7th (EST), send on the 8th (EDT).
  const signup = new Date("2026-03-07T18:00:00Z"); // 1:00 PM EST
  const due = nextMorningInOrlando(signup);

  assertEquals(orlandoDateString(due), "2026-03-08");
  assertEquals(orlandoHour(due), 8);
  assertEquals(due.toISOString(), "2026-03-08T12:00:00.000Z"); // now EDT, UTC-4
});

Deno.test("Fall back: signup the day before the switch still sends at 8 AM local", () => {
  // DST 2026 ends Sunday 2026-11-01. Signup on Oct 31 (EDT), send on Nov 1 (EST).
  const signup = new Date("2026-10-31T18:00:00Z"); // 2:00 PM EDT
  const due = nextMorningInOrlando(signup);

  assertEquals(orlandoDateString(due), "2026-11-01");
  assertEquals(orlandoHour(due), 8);
  assertEquals(due.toISOString(), "2026-11-01T13:00:00.000Z"); // back to EST, UTC-5
});

Deno.test("Month and year rollovers advance the calendar day correctly", () => {
  const endOfMonth = nextMorningInOrlando(new Date("2026-01-31T20:00:00Z"));
  assertEquals(orlandoDateString(endOfMonth), "2026-02-01");

  const endOfYear = nextMorningInOrlando(new Date("2026-12-31T20:00:00Z"));
  assertEquals(orlandoDateString(endOfYear), "2027-01-01");

  // 2028 is a leap year: Feb 28 must roll to Feb 29, not March 1.
  const leapDay = nextMorningInOrlando(new Date("2028-02-28T20:00:00Z"));
  assertEquals(orlandoDateString(leapDay), "2028-02-29");
});

/* ---------- Email 3: 24 hours after email 2 ---------- */

Deno.test("Email 3 is due exactly 24 hours after email 2 went out", () => {
  const email2Sent = new Date("2026-07-16T12:03:00Z"); // 8:03 AM EDT
  const due = email3DueAt(email2Sent);

  assertEquals(due.toISOString(), "2026-07-17T12:03:00.000Z");
  assertEquals(orlandoHour(due), 8);
});

Deno.test("Email 3 keeps the morning slot across the fall-back switch", () => {
  // Email 2 sent 8 AM EDT on Oct 31; 24 hours later the clocks have gone back,
  // so the same instant reads as 7 AM local. Still a civil hour, never the night.
  const email2Sent = new Date("2026-10-31T12:00:00Z");
  const due = email3DueAt(email2Sent);

  assertEquals(due.toISOString(), "2026-11-01T12:00:00.000Z");
  assertEquals(orlandoHour(due), 7);
});

Deno.test("The full sequence stays in order and inside daytime hours", () => {
  const signup = new Date("2026-07-15T14:00:00Z"); // 10 AM EDT
  const email2 = nextMorningInOrlando(signup);
  // The cron runs every 15 minutes, so the real send can lag slightly.
  const email2Actual = new Date(email2.getTime() + 7 * 60 * 1000);
  const email3 = email3DueAt(email2Actual);

  assertEquals(signup < email2Actual, true);
  assertEquals(email2Actual < email3, true);
  assertEquals(orlandoHour(email2Actual), 8);
  assertEquals(orlandoHour(email3), 8);
});
