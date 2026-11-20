import { describe, expect, it } from "vitest";
import { orlandoDayRange, orlandoMidnightUtc, orlandoToday } from "./orlandoDay";

describe("orlandoDay (C-6)", () => {
  it("uses EST in winter and EDT in summer", () => {
    expect(orlandoMidnightUtc("2026-12-04").toISOString()).toBe("2026-12-04T05:00:00.000Z");
    expect(orlandoMidnightUtc("2026-07-04").toISOString()).toBe("2026-07-04T04:00:00.000Z");
  });

  it("handles DST change days (midnight is before the 2am switch)", () => {
    expect(orlandoMidnightUtc("2026-11-01").toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(orlandoMidnightUtc("2026-03-08").toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("includes the whole last day, evening included", () => {
    const r = orlandoDayRange("2026-11-01", "2026-11-30");
    expect(r.gte).toBe("2026-11-01T04:00:00.000Z");
    expect(r.lt).toBe("2026-12-01T05:00:00.000Z");
    // 9pm Orlando on 11/30 = 02:00 UTC 12/01: must be inside
    expect("2026-12-01T02:00:00.000Z" < r.lt!).toBe(true);
  });

  it("crosses month and year ends", () => {
    expect(orlandoDayRange(undefined, "2026-12-31").lt).toBe("2027-01-01T05:00:00.000Z");
  });
});

describe("orlandoToday (UI2-13/14)", () => {
  it("is still today in Orlando after 8 pm, when UTC has rolled over", () => {
    // 2026-10-28 21:41 EDT = 2026-10-29 01:41 UTC (the DRP-2026 case)
    expect(orlandoToday(new Date("2026-10-29T01:41:00Z"))).toBe("2026-10-28");
    // 2026-11-19 20:30 EST = 2026-11-20 01:30 UTC
    expect(orlandoToday(new Date("2026-11-20T01:30:00Z"))).toBe("2026-11-19");
  });

  it("matches the UTC date during the day", () => {
    expect(orlandoToday(new Date("2026-11-19T15:00:00Z"))).toBe("2026-11-19");
  });

  it("rolls over at Orlando midnight, not UTC midnight", () => {
    expect(orlandoToday(new Date("2026-12-04T04:59:00Z"))).toBe("2026-12-03");
    expect(orlandoToday(new Date("2026-12-04T05:00:00Z"))).toBe("2026-12-04");
  });
});
