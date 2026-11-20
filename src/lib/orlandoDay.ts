// Day bounds in Orlando time (America/New_York). ClickUp 86e40ach2 C-6.
// A "yyyy-MM-dd" compared directly against a timestamptz is read as UTC
// midnight, which cuts the evening of the chosen day off the filter.

const TZ = "America/New_York";

/** UTC instant of 00:00 America/New_York on a "yyyy-MM-dd" date. */
export function orlandoMidnightUtc(ymd: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  // 05:00 UTC is 00:00 in EST and 01:00 in EDT.
  const est = new Date(Date.UTC(y, mo, d, 5, 0, 0));
  const hour = +new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(est);
  return hour === 0 ? est : new Date(Date.UTC(y, mo, d, 4, 0, 0));
}

/** "yyyy-MM-dd" Orlando calendar day of an instant (ISO string or Date). */
export function orlandoYmd(at: string | Date): string {
  const d = typeof at === "string" ? new Date(at) : at;
  return d.toLocaleDateString("en-CA", { timeZone: TZ });
}

/** [start, endExclusive) ISO bounds covering whole Orlando days from..to. */
export function orlandoDayRange(from?: string, to?: string): { gte?: string; lt?: string } {
  const out: { gte?: string; lt?: string } = {};
  if (from) out.gte = orlandoMidnightUtc(from).toISOString();
  if (to) {
    const [y, mo, d] = to.split("-").map(Number);
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    const nextYmd = next.toISOString().slice(0, 10);
    out.lt = orlandoMidnightUtc(nextYmd).toISOString();
  }
  return out;
}
