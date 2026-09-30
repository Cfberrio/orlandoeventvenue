import { describe, expect, it } from "vitest";
import {
  calendarDaysBetween,
  planBalanceReschedule,
  shouldClearHostReportStep,
} from "../_shared/reschedule-plan.ts";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// 2026-11-17 09:00 Orlando (EST, UTC-5) = 14:00Z
const EVENT_ANCHOR = Date.parse("2026-11-17T14:00:00Z");
const EVENT_START = EVENT_ANCHOR; // 9am start

describe("planBalanceReschedule", () => {
  it("long notice: 3 retries at T-15, +48h, +96h", () => {
    const plan = planBalanceReschedule({
      diffDays: 48,
      linkAlreadySent: false,
      completedTypes: [],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: Date.parse("2026-09-30T15:00:00Z"),
    });
    expect(plan.action).toBe("long_notice");
    expect(plan.jobs).toEqual([
      { job_type: "balance_retry_1", run_at: "2026-11-02T14:00:00.000Z" },
      { job_type: "balance_retry_2", run_at: "2026-11-04T14:00:00.000Z" },
      { job_type: "balance_retry_3", run_at: "2026-11-06T14:00:00.000Z" },
    ]);
  });

  it("long notice rebuilds the chain even if a link went out for the old date", () => {
    const plan = planBalanceReschedule({
      diffDays: 40,
      linkAlreadySent: true,
      completedTypes: ["balance_retry_1", "balance_retry_2", "balance_retry_3"],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: Date.parse("2026-10-08T15:00:00Z"),
    });
    expect(plan.action).toBe("long_notice");
    expect(plan.jobs).toHaveLength(3);
  });

  it("short notice, no link yet: create now + one retry in 48h", () => {
    const now = Date.parse("2026-11-07T15:00:00Z");
    const plan = planBalanceReschedule({
      diffDays: 10,
      linkAlreadySent: false,
      completedTypes: [],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: now,
    });
    expect(plan.action).toBe("short_notice_create_now");
    expect(plan.jobs).toEqual([
      { job_type: "balance_retry_2", run_at: new Date(now + 48 * HOUR).toISOString() },
    ]);
  });

  it("short notice, no link yet, event within 48h: link now, no retry after the event", () => {
    const plan = planBalanceReschedule({
      diffDays: 1,
      linkAlreadySent: false,
      completedTypes: [],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: EVENT_START - 20 * HOUR,
    });
    expect(plan.action).toBe("short_notice_create_now");
    expect(plan.jobs).toEqual([]);
  });

  it("moving earlier never fires the three retries back to back", () => {
    // Retries were pending for a far date; event moved to 12 days out, a link
    // was already sent. Old anchors are all in the past relative to now.
    const now = Date.parse("2026-11-05T15:00:00Z");
    const plan = planBalanceReschedule({
      diffDays: 12,
      linkAlreadySent: true,
      completedTypes: ["balance_retry_1"],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: now,
    });
    expect(plan.action).toBe("short_notice_link_sent");
    expect(plan.jobs).toEqual([
      { job_type: "balance_retry_2", run_at: new Date(now + 48 * HOUR).toISOString() },
      { job_type: "balance_retry_3", run_at: new Date(now + 96 * HOUR).toISOString() },
    ]);
    const times = plan.jobs.map((j) => Date.parse(j.run_at));
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(48 * HOUR);
    expect(times[0] - now).toBeGreaterThanOrEqual(48 * HOUR);
  });

  it("link already sent: keeps the normal anchor when it is later than now+48h", () => {
    const now = Date.parse("2026-10-30T15:00:00Z"); // 18 days out, but diffDays forced ≤15 path
    const plan = planBalanceReschedule({
      diffDays: 15,
      linkAlreadySent: true,
      completedTypes: ["balance_retry_1", "balance_retry_2"],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: now,
    });
    expect(plan.jobs).toEqual([
      { job_type: "balance_retry_3", run_at: "2026-11-06T14:00:00.000Z" },
    ]);
  });

  it("link already sent: drops retries that would land at or after the event start", () => {
    const now = EVENT_START - 3 * DAY;
    const plan = planBalanceReschedule({
      diffDays: 3,
      linkAlreadySent: true,
      completedTypes: [],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: now,
    });
    expect(plan.jobs.map((j) => j.job_type)).toEqual(["balance_retry_1"]);
    expect(Date.parse(plan.jobs[0].run_at)).toBeLessThan(EVENT_START);
  });

  it("link already sent and every retry already ran: nothing new is scheduled", () => {
    const plan = planBalanceReschedule({
      diffDays: 8,
      linkAlreadySent: true,
      completedTypes: ["balance_retry_1", "balance_retry_2", "balance_retry_3"],
      eventAnchorMs: EVENT_ANCHOR,
      eventStartMs: EVENT_START,
      nowMs: EVENT_START - 8 * DAY,
    });
    expect(plan).toEqual({ action: "short_notice_link_sent", jobs: [] });
  });

  it("retries the RPC cancelled as past-due are still recreated (payments-auditor BLOCK)", () => {
    // Event was 2026-11-30; retry_1 ran 11-15 and sent the link; retry_2/3
    // were pending for 11-17/11-19. On 11-16 the admin moves the event to
    // 11-25 (-5 days): the RPC cancels retry_2/3 as reschedule_past_due before
    // this runs, so none of them is "pending" any more. They must come back.
    const anchor = Date.parse("2026-11-25T14:00:00Z");
    const now = Date.parse("2026-11-16T15:00:00Z");
    const plan = planBalanceReschedule({
      diffDays: 9,
      linkAlreadySent: true,
      completedTypes: ["balance_retry_1"],
      eventAnchorMs: anchor,
      eventStartMs: anchor,
      nowMs: now,
    });
    expect(plan).toEqual({
      action: "short_notice_link_sent",
      jobs: [
        { job_type: "balance_retry_2", run_at: "2026-11-18T15:00:00.000Z" },
        { job_type: "balance_retry_3", run_at: "2026-11-20T15:00:00.000Z" },
      ],
    });
  });
});

describe("shouldClearHostReportStep", () => {
  it("clears a stale step when the new date is more than 30 days out", () => {
    expect(shouldClearHostReportStep(true, null, "pre_start")).toBe(true);
    expect(shouldClearHostReportStep(true, null, "during_event")).toBe(true);
  });

  it("leaves the step alone when nothing is set, a step applies, or no reschedule", () => {
    expect(shouldClearHostReportStep(true, null, null)).toBe(false);
    expect(shouldClearHostReportStep(true, "pre_start", "pre_start")).toBe(false);
    expect(shouldClearHostReportStep(false, null, "pre_start")).toBe(false);
  });
});

describe("calendarDaysBetween", () => {
  it("counts calendar days across the spring DST change (16, not 15)", () => {
    // 2027-03-14 is the US spring-forward date; the local-midnight gap is 383h.
    expect(calendarDaysBetween("2027-03-01", "2027-03-17")).toBe(16);
  });
  it("counts across the fall DST change and month/year boundaries", () => {
    expect(calendarDaysBetween("2026-10-25", "2026-11-10")).toBe(16);
    expect(calendarDaysBetween("2026-12-25", "2027-01-09")).toBe(15);
  });
  it("is 0 for the same day, negative for the past, ignores a time suffix", () => {
    expect(calendarDaysBetween("2026-11-17", "2026-11-17")).toBe(0);
    expect(calendarDaysBetween("2026-11-17", "2026-11-16")).toBe(-1);
    expect(calendarDaysBetween("2026-11-01", "2026-11-17T00:00:00")).toBe(16);
  });
});
