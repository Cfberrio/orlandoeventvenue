import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LEAD_SILENCE_THRESHOLD_DAYS, leadSilenceDays } from "../_shared/lead-silence.ts";

const NOW = new Date("2026-11-04T13:00:00Z");
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

describe("leadSilenceDays", () => {
  it("stays quiet inside the threshold, including the 5.0 day historic ordinary gap", () => {
    expect(leadSilenceDays(daysAgo(0), NOW)).toBeNull();
    expect(leadSilenceDays(daysAgo(5), NOW)).toBeNull();
    expect(leadSilenceDays(daysAgo(LEAD_SILENCE_THRESHOLD_DAYS - 0.01), NOW)).toBeNull();
  });

  it("alerts from exactly the threshold onward", () => {
    expect(leadSilenceDays(daysAgo(LEAD_SILENCE_THRESHOLD_DAYS), NOW)).toBe(LEAD_SILENCE_THRESHOLD_DAYS);
  });

  it("would have caught the Sep-Nov 2026 outage", () => {
    expect(leadSilenceDays("2026-09-01T20:30:33Z", NOW)).toBe(63);
    // First morning the 8 AM check would have fired.
    expect(leadSilenceDays("2026-09-01T20:30:33Z", new Date("2026-09-09T13:00:00Z"))).toBe(7);
    expect(leadSilenceDays("2026-09-01T20:30:33Z", new Date("2026-09-08T13:00:00Z"))).toBeNull();
  });

  it("does not treat missing or unparseable data as an outage", () => {
    expect(leadSilenceDays(null, NOW)).toBeNull();
    expect(leadSilenceDays(undefined, NOW)).toBeNull();
    expect(leadSilenceDays("not-a-date", NOW)).toBeNull();
  });
});

describe("daily-health-check wiring", () => {
  const source = readFileSync(
    new URL("../daily-health-check/index.ts", import.meta.url),
    "utf8",
  );

  it("runs the check before the alert email is decided", () => {
    const check = source.indexOf("leadSilenceDays(");
    const alert = source.indexOf("await sendAlertEmail(issues)");
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(alert);
  });

  it("reports a failed lookup instead of reading it as healthy", () => {
    expect(source).toContain("lead_capture_check_failed");
  });
});
