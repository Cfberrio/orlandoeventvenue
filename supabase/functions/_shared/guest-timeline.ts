// Shared time rules for guest-facing messages (ClickUp 86e40ach2, second pass
// L2-15, CM2-02, CM2-04, CM2-06). Pure: no Deno/Supabase imports, so vitest
// runs the exact code the edge functions run.
//
// The SQL side has the same rules:
//   event start  = public._booking_event_start_at  (start_time, or 00:00)
//   event end    = public._booking_event_end_at    (end_time, next day when it
//                  is not after start_time, or 23:59 when there is no end_time)
// One rule for everything: the lifecycle cron, the one_hour_report reminder,
// the Event Page window and the Guest Report window.

/** Hours after the event end during which the Guest Report form stays open. */
export const GUEST_REPORT_WINDOW_HOURS = 24;

/**
 * Daily bookings are stored 01:00-23:00, so reminders anchored on the start
 * time fired at 1-2 AM. Reminders for daily bookings use this time instead.
 */
export const DAILY_REMINDER_TIME = "10:00:00";

/** Hourly bookings without a start time fall back to this reminder time. */
export const FALLBACK_REMINDER_TIME = "10:00:00";

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

function normTime(t: string): string {
  const [h = "0", m = "0", s = "0"] = t.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}:${s.padStart(2, "0")}`;
}

/** Orlando wall-clock start of the event (mirror of _booking_event_start_at). */
export function eventStartLocal(eventDate: string, startTime: string | null | undefined): { date: string; time: string } {
  return { date: eventDate.slice(0, 10), time: startTime ? normTime(startTime) : "00:00:00" };
}

/** Orlando wall-clock end of the event (mirror of _booking_event_end_at). */
export function eventEndLocal(
  eventDate: string,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): { date: string; time: string } {
  const date = eventDate.slice(0, 10);
  if (!endTime) return { date, time: "23:59:00" };
  const end = normTime(endTime);
  const overnight = !!startTime && end <= normTime(startTime);
  return { date: overnight ? addDays(date, 1) : date, time: end };
}

/** Wall-clock time the 30/7/1-day reminders are anchored on. */
export function reminderAnchorTime(bookingType: string | null | undefined, startTime: string | null | undefined): string {
  if (bookingType === "daily") return DAILY_REMINDER_TIME;
  return startTime ? normTime(startTime) : FALLBACK_REMINDER_TIME;
}

/** Calendar days between two YYYY-MM-DD dates. */
function daysBetween(fromDate: string, toDate: string): number {
  const ord = (d: string) => {
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, day) / 86400000;
  };
  return ord(toDate) - ord(fromDate);
}

export const BALANCE_DUE_DAYS_BEFORE = 15;

export interface BalanceDue {
  /** YYYY-MM-DD the balance is due (event date - 15 days). */
  dueDate: string;
  /** The due date is today or already past: tell the guest it is due now. */
  dueNow: boolean;
  /** Short phrase for the email, e.g. "due by Friday, December 5, 2026" or "due now". */
  phrase: string;
}

/** CM2-04: the real due date, or "due now" when the booking is short notice. */
export function balanceDue(eventDate: string, todayOrlando: string): BalanceDue {
  const dueDate = addDays(eventDate, -BALANCE_DUE_DAYS_BEFORE);
  const dueNow = daysBetween(todayOrlando, dueDate) <= 0;
  return { dueDate, dueNow, phrase: dueNow ? "due now" : `due by ${formatLongDate(dueDate)}` };
}

/** "Friday, December 5, 2026" from YYYY-MM-DD, timezone-safe. */
export function formatLongDate(ymd: string): string {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

/** "7:30 PM" from "19:30:00"; "" for empty. */
export function format12h(t: string | null | undefined): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m || 0).padStart(2, "0")} ${suffix}`;
}

/** Event time range as the guest should read it ("1:00 AM - 11:00 PM"), or "Full day". */
export function eventTimeRange(startTime: string | null | undefined, endTime: string | null | undefined): string {
  return startTime && endTime ? `${format12h(startTime)} - ${format12h(endTime)}` : "Full day";
}

/** CM2-06: booking-type label that matches the stored window instead of "24 hours". */
export function bookingTypeLabel(
  bookingType: string | null | undefined,
  startTime?: string | null,
  endTime?: string | null,
): string {
  if (bookingType === "daily") {
    return startTime && endTime ? `Full Day (${format12h(startTime)} - ${format12h(endTime)})` : "Full Day";
  }
  if (bookingType === "hourly") return "Hourly";
  return bookingType ?? "";
}

/** Today's date in Orlando as YYYY-MM-DD. */
export function orlandoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

// ---------------------------------------------------------------------------
// CM2-15: booking_policies communication switches
// ---------------------------------------------------------------------------

export interface CommsPolicy {
  include_host_report?: boolean | null;
  send_pre_event_30d?: boolean | null;
  send_pre_event_7d?: boolean | null;
  send_pre_event_1d?: boolean | null;
  send_balance_emails?: boolean | null;
  send_deposit_emails?: boolean | null;
  send_cleaning_report?: boolean | null;
}

/** A missing policy or a null flag means "on" (the historic behavior). */
export function policyAllows(policy: CommsPolicy | null | undefined, flag: keyof CommsPolicy): boolean {
  return policy?.[flag] !== false;
}

/**
 * Host-report steps the policy allows. pre_start is the 30-day step,
 * during_event the 7-day step, post_event the 1-day step; one_hour_report is
 * the Guest Report reminder. include_host_report=false turns all of them off.
 */
export function allowedHostReportJobs(policy: CommsPolicy | null | undefined): Set<string> {
  const allowed = new Set<string>();
  if (!policyAllows(policy, "include_host_report")) return allowed;
  if (policyAllows(policy, "send_pre_event_30d")) allowed.add("host_report_pre_start");
  if (policyAllows(policy, "send_pre_event_7d")) allowed.add("host_report_during");
  if (policyAllows(policy, "send_pre_event_1d")) allowed.add("host_report_post");
  allowed.add("one_hour_report");
  return allowed;
}

const STEP_TO_JOB: Record<string, string> = {
  pre_start: "host_report_pre_start",
  during_event: "host_report_during",
  post_event: "host_report_post",
};

/** The job type that owns a host_report_step value. */
export function hostReportJobForStep(step: string): string | undefined {
  return STEP_TO_JOB[step];
}
