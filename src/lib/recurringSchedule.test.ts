import { describe, it, expect } from "vitest";
import {
  LAST_DAY_OF_MONTH,
  PICKABLE_DAYS,
  defaultSendDay,
  monthlyOccurrence,
  monthlyScheduleLabel,
  nextMonthlySend,
  sendDayOptionLabel,
} from "./recurringSchedule";

describe("monthlyOccurrence", () => {
  it("lands on 3 PM EDT (19:00 UTC) in summer", () => {
    expect(monthlyOccurrence({ year: 2026, month: 9 }, 2).toISOString()).toBe(
      "2026-10-02T19:00:00.000Z"
    );
  });

  it("lands on 3 PM EST (20:00 UTC) in winter", () => {
    expect(monthlyOccurrence({ year: 2026, month: 10 }, 2).toISOString()).toBe(
      "2026-11-02T20:00:00.000Z"
    );
  });

  it("clamps the last day to short months instead of skipping them", () => {
    expect(monthlyOccurrence({ year: 2027, month: 1 }, LAST_DAY_OF_MONTH).toISOString()).toBe(
      "2027-02-28T20:00:00.000Z"
    );
    expect(monthlyOccurrence({ year: 2028, month: 1 }, LAST_DAY_OF_MONTH).toISOString()).toBe(
      "2028-02-29T20:00:00.000Z"
    );
    expect(monthlyOccurrence({ year: 2026, month: 10 }, LAST_DAY_OF_MONTH).toISOString()).toBe(
      "2026-11-30T20:00:00.000Z"
    );
    expect(monthlyOccurrence({ year: 2026, month: 11 }, LAST_DAY_OF_MONTH).toISOString()).toBe(
      "2026-12-31T20:00:00.000Z"
    );
  });
});

describe("nextMonthlySend", () => {
  // Oct 6 2026, 9:50 AM ET
  const now = new Date("2026-10-06T13:50:00Z");

  it("send-now on Oct 6 for the 2nd → Nov 2", () => {
    expect(nextMonthlySend(2, now, now).toISOString()).toBe("2026-11-02T20:00:00.000Z");
  });

  it("send-now keeps one invoice per month even when the day is later this month", () => {
    // First invoice goes out today (Oct 6); the 20th must not bill October twice.
    expect(nextMonthlySend(20, now, now).toISOString()).toBe("2026-11-20T20:00:00.000Z");
  });

  it("wait-until-day uses this month when the day is still ahead", () => {
    expect(nextMonthlySend(20, null, now).toISOString()).toBe("2026-10-20T19:00:00.000Z");
  });

  it("wait-until-day rolls to next month when the day already passed", () => {
    expect(nextMonthlySend(2, null, now).toISOString()).toBe("2026-11-02T20:00:00.000Z");
  });

  it("wait-until-day on the day itself, before 3 PM ET, sends today", () => {
    expect(nextMonthlySend(6, null, now).toISOString()).toBe("2026-10-06T19:00:00.000Z");
  });

  it("wait-until-day on the day itself, after 3 PM ET, rolls a month", () => {
    const late = new Date("2026-10-06T20:30:00Z"); // 4:30 PM EDT
    expect(nextMonthlySend(6, null, late).toISOString()).toBe("2026-11-06T20:00:00.000Z");
  });

  it("editing: moving the day earlier after this month's send waits for next month", () => {
    const lastSent = new Date("2026-10-01T19:00:07Z");
    expect(nextMonthlySend(2, lastSent, now).toISOString()).toBe("2026-11-02T20:00:00.000Z");
  });

  it("editing: moving the day later in the month does not bill the current month twice", () => {
    const lastSent = new Date("2026-10-01T19:00:07Z");
    expect(nextMonthlySend(20, lastSent, now).toISOString()).toBe("2026-11-20T20:00:00.000Z");
  });

  it("editing: a stale last send never schedules in the past", () => {
    const lastSent = new Date("2026-08-03T20:11:21Z");
    expect(nextMonthlySend(2, lastSent, now).toISOString()).toBe("2026-11-02T20:00:00.000Z");
    expect(nextMonthlySend(20, lastSent, now).toISOString()).toBe("2026-10-20T19:00:00.000Z");
  });

  it("uses the Orlando calendar month, not UTC, for the last send", () => {
    // Oct 31 at 11 PM ET is already Nov 1 in UTC — it still counts as October.
    const lastSent = new Date("2026-11-01T03:00:00Z");
    const after = new Date("2026-11-01T04:00:00Z");
    expect(nextMonthlySend(2, lastSent, after).toISOString()).toBe("2026-11-02T20:00:00.000Z");
  });

  it("rolls over the year", () => {
    const lastSent = new Date("2026-12-31T20:00:00Z");
    expect(
      nextMonthlySend(LAST_DAY_OF_MONTH, lastSent, new Date("2027-01-01T12:00:00Z")).toISOString()
    ).toBe("2027-01-31T20:00:00.000Z");
  });
});

describe("defaultSendDay", () => {
  it("defaults to today's Orlando day", () => {
    expect(defaultSendDay(new Date("2026-10-06T13:50:00Z"))).toBe(6);
  });

  it("uses Orlando's date, not UTC", () => {
    // Oct 6 at 10 PM ET = Oct 7 UTC
    expect(defaultSendDay(new Date("2026-10-07T02:00:00Z"))).toBe(6);
  });

  it("maps the 29th–31st to last day of month", () => {
    expect(defaultSendDay(new Date("2026-10-30T15:00:00Z"))).toBe(LAST_DAY_OF_MONTH);
  });
});

describe("labels", () => {
  it("offers 1–28 plus last day", () => {
    expect(PICKABLE_DAYS).toHaveLength(29);
    expect(PICKABLE_DAYS[PICKABLE_DAYS.length - 1]).toBe(LAST_DAY_OF_MONTH);
  });

  it("formats schedule and options", () => {
    expect(monthlyScheduleLabel(2)).toBe("Monthly on the 2nd");
    expect(monthlyScheduleLabel(11)).toBe("Monthly on the 11th");
    expect(monthlyScheduleLabel(23)).toBe("Monthly on the 23rd");
    expect(monthlyScheduleLabel(LAST_DAY_OF_MONTH)).toBe("Monthly on the last day");
    expect(sendDayOptionLabel(1)).toBe("1st");
    expect(sendDayOptionLabel(LAST_DAY_OF_MONTH)).toBe("Last day of month");
  });
});
