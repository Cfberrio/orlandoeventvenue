// Staff portal rules shared by the pages (ClickUp 86e40ach2, second pass ST2).
import { endOfMonth, endOfWeek, format, parseISO, startOfMonth, startOfWeek } from "date-fns";

/** ST2-11: there is no response deadline; the real limit is the event itself. */
export function answerBeforeLabel(eventDate: string | null | undefined): string | null {
  if (!eventDate) return null;
  return `Before your event on ${format(parseISO(eventDate), "EEE, MMM d")}`;
}

/** ST2-12: cancelled rows (e.g. the 11/19 backfill duplicates) are not the staff member's work. */
export function isLiveAssignment(a: { status?: string | null }): boolean {
  return (a.status ?? "assigned") !== "cancelled";
}

/** ST2-13: the staff calendar shows only work they still have. */
export function isScheduledWork(a: { status?: string | null; response_status?: string | null }): boolean {
  return isLiveAssignment(a) && a.response_status !== "rejected";
}

/** ST2-13: month grid starts on the Sunday of the first week, like the admin Schedule. */
export function monthGridRange(month: Date): { start: Date; end: Date } {
  return { start: startOfWeek(startOfMonth(month)), end: endOfWeek(endOfMonth(month)) };
}

export const UNASSIGN_CUTOFF_HOURS = 48;

/** Orlando wall-clock start of the work as a UTC instant. */
export function orlandoStart(date: string, time: string | null | undefined): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h || 0, mi || 0);
  const offset = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - ms;
  };
  let utc = guess - offset(guess);
  utc = guess - offset(utc);
  return new Date(utc);
}

/** ST2-25: mirrors staff_unassign_self, which refuses within 48h of the start and after it. */
export function canSelfUnassign(eventDate: string | null | undefined, startTime: string | null | undefined, now = new Date()): boolean {
  if (!eventDate) return true;
  const start = orlandoStart(eventDate, startTime);
  return start.getTime() - now.getTime() >= UNASSIGN_CUTOFF_HOURS * 3600 * 1000;
}

/** ST2-28: the cleaning report belongs to the role on this booking, not the profile role. */
export function isCleaningAssignment(role: string | null | undefined, type: string | null | undefined): boolean {
  return role === "Custodial" || role === "cleaner" || type === "cleaning";
}

/** Supabase errors are plain objects; show their message instead of a generic one. */
export function errorText(err: unknown, fallback = "Something went wrong. Please try again."): string {
  if (err instanceof Error && err.message) return err.message;
  const msg = (err as { message?: unknown } | null)?.message;
  return typeof msg === "string" && msg ? msg : fallback;
}

/** ST2-16: a staff member can be signed out remotely (deactivated). */
export function isSessionError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "42501";
}

// ---------------------------------------------------------------------------
// ST2-18: My Payments
// ---------------------------------------------------------------------------
export interface StaffPayLine {
  booking_id: string | null;
  assignment_type: string | null;
  response_status?: string | null;
  paid_status: string | null;
  amount: number | string;
}

/** A booking line can only be paid once the staff member accepted (bar work and standalone jobs are exempt). */
export function awaitingAcceptance(line: StaffPayLine): boolean {
  if (line.paid_status === "paid") return false;
  if (line.booking_id == null) return false;
  if (line.assignment_type === "bar_service") return false;
  return (line.response_status ?? "pending") !== "accepted";
}

export function summarizeStaffPay(lines: StaffPayLine[]): { owed: number; paid: number; awaiting: number } {
  let owed = 0;
  let paid = 0;
  let awaiting = 0;
  for (const l of lines) {
    const amount = Number(l.amount) || 0;
    if (l.paid_status === "paid") paid += amount;
    else if (awaitingAcceptance(l)) awaiting += amount;
    else owed += amount;
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { owed: r(owed), paid: r(paid), awaiting: r(awaiting) };
}

// ---------------------------------------------------------------------------
// Deep link back after sign-in (ST2-14)
// ---------------------------------------------------------------------------
/** Only same-site staff paths are allowed as a return target. */
export function safeStaffNext(next: string | null | undefined): string {
  if (!next) return "/staff";
  if (!next.startsWith("/staff") || next.startsWith("//") || next.includes("://") || next.startsWith("/staff/login")) {
    return "/staff";
  }
  return next;
}
