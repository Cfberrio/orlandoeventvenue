// Monthly recurring invoices go out on a fixed calendar day at 3 PM
// America/New_York. This mirrors the SQL in recurring_month_occurrence /
// set_recurring_day_of_month / claim_recurring_invoice, which is the source of
// truth: the UI only uses these helpers to preview dates and to pick the first
// send date at creation.

const TZ = "America/New_York";
const SEND_HOUR_ET = 15;

/** recurring_day_of_month value that means "last day of the month". */
export const LAST_DAY_OF_MONTH = 31;

/** Days offered in the picker. 29–30 are left out: they would land on a
 * different day in shorter months, which "Last day of month" covers. */
export const PICKABLE_DAYS: number[] = [
  ...Array.from({ length: 28 }, (_, i) => i + 1),
  LAST_DAY_OF_MONTH,
];

interface YearMonth {
  year: number;
  /** 0-based month */
  month: number;
}

function etParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (t: string) => +(parts.find((p) => p.type === t)?.value ?? "0");
  return { year: get("year"), month: get("month") - 1, day: get("day") };
}

function addMonths({ year, month }: YearMonth, n: number): YearMonth {
  const total = year * 12 + month + n;
  return { year: Math.floor(total / 12), month: total % 12 };
}

/** UTC instant for 3 PM America/New_York on the given calendar date. */
function threePmEt(year: number, month: number, day: number): Date {
  // Probe 20:00 UTC on the target date to detect EST vs EDT:
  // 20:00 UTC → 15 in EST (offset 5h) or 16 in EDT (offset 4h).
  const probe = new Date(Date.UTC(year, month, day, 20, 0, 0));
  const probeHour = +new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
  }).format(probe);
  const utcHour = SEND_HOUR_ET + (20 - probeHour);
  return new Date(Date.UTC(year, month, day, utcHour, 0, 0));
}

/** 3 PM ET on `day` of the given month, clamped to the month's last day. */
export function monthlyOccurrence(ym: YearMonth, day: number): Date {
  const lastDay = new Date(Date.UTC(ym.year, ym.month + 1, 0)).getUTCDate();
  return threePmEt(ym.year, ym.month, Math.min(day, lastDay));
}

/**
 * Next monthly send. At most one invoice per calendar month: when something was
 * already sent (lastSentAt), the next one goes out no earlier than the month
 * after it. Never returns a moment in the past — a month whose day already
 * passed is skipped rather than back-billed.
 */
export function nextMonthlySend(
  day: number,
  lastSentAt: Date | null,
  now: Date = new Date()
): Date {
  let ym: YearMonth = lastSentAt
    ? addMonths(etParts(lastSentAt), 1)
    : etParts(now);
  let candidate = monthlyOccurrence(ym, day);
  while (candidate.getTime() <= now.getTime()) {
    ym = addMonths(ym, 1);
    candidate = monthlyOccurrence(ym, day);
  }
  return candidate;
}

/** Today's day of month in Orlando, mapped onto a pickable value. */
export function defaultSendDay(now: Date = new Date()): number {
  const { day } = etParts(now);
  return day > 28 ? LAST_DAY_OF_MONTH : day;
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "the 2nd" / "the last day" */
export function sendDayPhrase(day: number): string {
  return day >= LAST_DAY_OF_MONTH ? "the last day" : `the ${ordinal(day)}`;
}

/** Picker label: "2nd" / "Last day of month" */
export function sendDayOptionLabel(day: number): string {
  return day >= LAST_DAY_OF_MONTH ? "Last day of month" : ordinal(day);
}

/** List label: "Monthly on the 2nd" / "Monthly on the last day" */
export function monthlyScheduleLabel(day: number): string {
  return `Monthly on ${sendDayPhrase(day)}`;
}

export function formatSendDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
