// Staff-facing and office-facing notices (ClickUp 86e40ach2, second pass ST2).
//
// Pure helpers only (no Deno or supabase-js imports) so the vitest edge suite
// can load this file. The database queues every notice in
// public.staff_notifications (see migration 20261119160000); the
// send-staff-notices edge function claims rows and turns them into email with
// buildStaffNotice(). Nothing here trusts a caller: every value comes from a
// row the database wrote.

/** The staff portal lives on the live custom domain. Staff sign-in is stored
 * per origin, so links must always point here (not lovable.app). */
export const STAFF_PORTAL_ORIGIN = "https://orlandoeventvenue.org";

export function staffBookingUrl(bookingId: string): string {
  return `${STAFF_PORTAL_ORIGIN}/staff/bookings/${bookingId}`;
}
export function staffCleaningReportUrl(bookingId: string): string {
  return `${STAFF_PORTAL_ORIGIN}/staff/bookings/${bookingId}/cleaning-report`;
}
export function staffStandaloneReportUrl(assignmentId: string): string {
  return `${STAFF_PORTAL_ORIGIN}/staff/standalone/${assignmentId}/cleaning-report`;
}
export function adminBookingUrl(bookingId: string): string {
  return `${STAFF_PORTAL_ORIGIN}/admin/bookings/${bookingId}`;
}

/** Photos staff_submit_cleaning_report refuses to save without. Keep in step
 * with that RPC (a test compares this list with the migration). */
export const REQUIRED_CLEANING_PHOTOS: ReadonlyArray<{ field: string; label: string; min: number; onlyIfDeep?: boolean }> = [
  { field: "media_front_door", label: "Front door", min: 1 },
  { field: "media_main_area", label: "Main area", min: 1 },
  { field: "media_rack", label: "Tables & chairs rack", min: 1 },
  { field: "media_bathrooms", label: "Bathrooms", min: 2 },
  { field: "media_kitchen", label: "Kitchen", min: 1 },
  { field: "media_deep_cleaning", label: "Deep cleaning", min: 1, onlyIfDeep: true },
];

export function requiredPhotoLines(): string[] {
  return REQUIRED_CLEANING_PHOTOS.map((p) =>
    `${p.label}: at least ${p.min} photo${p.min === 1 ? "" : "s"}${p.onlyIfDeep ? " (only if you did a deep cleaning)" : ""}`
  );
}

export function escapeHtml(text: unknown): string {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** "15:30:00" -> "3:30 PM". Empty input -> "". */
export function formatTime12(time: string | null | undefined): string {
  if (!time) return "";
  const [h, m] = time.split(":");
  const hour = Number(h);
  if (!Number.isFinite(hour)) return "";
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${(m ?? "00").padStart(2, "0")} ${suffix}`;
}

export function formatTimeRange(start: string | null | undefined, end: string | null | undefined): string {
  const s = formatTime12(start);
  const e = formatTime12(end);
  if (s && e) return `${s} - ${e}`;
  return s || "";
}

/** "2026-12-01" -> "Tuesday, December 1, 2026" (calendar date, no time zone shift). */
export function formatEventDate(date: string | null | undefined): string {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return String(date);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Convert an Orlando wall-clock date + time to a UTC instant (DST aware). */
export function orlandoWallTimeToUtc(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi, s] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h || 0, mi || 0, s || 0);
  const offsetAt = (ms: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(ms));
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
    return wall - ms;
  };
  let utc = guess - offsetAt(guess);
  // Second pass settles the hour around a DST switch.
  utc = guess - offsetAt(utc);
  return new Date(utc);
}

/** Standalone reminder: the cron runs every 15 minutes, so each start falls in
 * exactly one run's window [now+45min, now+60min). */
export const STANDALONE_REMINDER_LEAD_MIN = 60;
export const STANDALONE_REMINDER_WINDOW_MIN = 15;
export function standaloneReminderDue(startUtc: Date, now: Date): boolean {
  const minutes = (startUtc.getTime() - now.getTime()) / 60000;
  return minutes >= STANDALONE_REMINDER_LEAD_MIN - STANDALONE_REMINDER_WINDOW_MIN && minutes < STANDALONE_REMINDER_LEAD_MIN;
}

// ---------------------------------------------------------------------------
// Outbox rows -> email
// ---------------------------------------------------------------------------

export type StaffNoticeKind =
  | "staff_response"
  | "office_recorded_response"
  | "booking_cancelled"
  | "assignment_removed"
  | "staff_unassigned"
  | "pending_digest"
  | "pending_escalation";

export interface StaffNoticeRow {
  id: string;
  kind: StaffNoticeKind;
  recipient: "staff" | "office";
  staff_id: string | null;
  booking_id: string | null;
  assignment_id: string | null;
  payload: Record<string, unknown>;
}

export interface BuiltNotice {
  subject: string;
  html: string;
  text: string;
}

interface DigestItem {
  booking_id?: string;
  reservation_number?: string | null;
  event_date?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  role?: string | null;
}

const str = (v: unknown): string => (v == null ? "" : String(v));
const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

function shell(title: string, paragraphs: string[], button?: { label: string; url: string }, extraHtml = ""): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">${p}</p>`).join("");
  const cta = button
    ? `<p style="margin:16px 0 8px;"><a href="${escapeHtml(button.url)}" style="display:inline-block;background:#0b1220;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:bold;font-size:14px;">${escapeHtml(button.label)}</a></p>
<p style="margin:0 0 12px;font-size:12px;color:#64748b;word-break:break-all;">${escapeHtml(button.url)}</p>`
    : "";
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:10px;border:1px solid #e2e8f0;">
<tr><td style="padding:18px 24px;background:#0b1220;color:#ffffff;font-size:17px;font-weight:bold;">${escapeHtml(title)}</td></tr>
<tr><td style="padding:22px 24px 10px;">${body}${extraHtml}${cta}</td></tr>
<tr><td style="padding:14px 24px;background:#f8fafc;color:#64748b;font-size:12px;line-height:1.5;">Orlando Event Venue · 3847 E Colonial Dr, Orlando, FL 32803 · (407) 974-5979</td></tr>
</table></td></tr></table></body></html>`;
}

function whenLine(p: Record<string, unknown>): string {
  const date = formatEventDate(str(p.event_date));
  const time = formatTimeRange(str(p.start_time) || null, str(p.end_time) || null);
  return [date, time].filter(Boolean).join(", ");
}

function resLabel(p: Record<string, unknown>): string {
  const r = str(p.reservation_number);
  return r ? `OEV #${r.replace(/^OEV-/, "")}` : "your booking";
}

/** Build the email for one outbox row, or null when the row has nothing to send. */
export function buildStaffNotice(row: StaffNoticeRow): BuiltNotice | null {
  const p = row.payload ?? {};
  const name = str(p.staff_name) || "Staff member";
  const role = str(p.role) || "staff";
  const when = whenLine(p);
  const res = resLabel(p);
  const e = escapeHtml;

  switch (row.kind) {
    case "staff_response": {
      const accepted = str(p.response) === "accepted";
      const subject = `${accepted ? "Staff accepted" : "Staff declined"}: ${name} - ${res}`;
      const lines = [
        `<b>${e(name)}</b> ${accepted ? "accepted" : "declined"} the ${e(role)} assignment for ${e(res)}${when ? ` on ${e(when)}` : ""}.`,
        ...(accepted ? [] : ["Please assign someone else."]),
      ];
      const text = `${name} ${accepted ? "accepted" : "declined"} the ${role} assignment for ${res}${when ? ` on ${when}` : ""}.${accepted ? "" : " Please assign someone else."}`;
      const url = row.booking_id ? adminBookingUrl(row.booking_id) : undefined;
      return { subject, html: shell(subject, lines, url ? { label: "Open booking", url } : undefined), text: url ? `${text}\n${url}` : text };
    }
    case "office_recorded_response": {
      const accepted = str(p.response) === "accepted";
      const subject = `Your answer for ${res} was recorded`;
      const what = accepted ? "accepted" : "declined";
      const lines = [
        `Hi ${e(firstName(name))},`,
        `The office recorded that you ${what} the ${e(role)} assignment for ${e(res)}${when ? ` on ${e(when)}` : ""}.`,
        accepted ? "If that is not right, reply to this email or call the office." : "You no longer need to work it. If that is not right, reply to this email or call the office.",
      ];
      const url = row.booking_id && accepted ? staffBookingUrl(row.booking_id) : undefined;
      const text = `The office recorded that you ${what} the ${role} assignment for ${res}${when ? ` on ${when}` : ""}.`;
      return { subject, html: shell(subject, lines, url ? { label: "Open in Staff Portal", url } : undefined), text: url ? `${text}\n${url}` : text };
    }
    case "booking_cancelled": {
      const subject = `Booking cancelled: ${res}`;
      const lines = [
        `Hi ${e(firstName(name))},`,
        `${e(res)}${when ? ` on ${e(when)}` : ""} was cancelled. You no longer need to work it.`,
        "Questions? Reply to this email.",
      ];
      return { subject, html: shell(subject, lines), text: `${res}${when ? ` on ${when}` : ""} was cancelled. You no longer need to work it.` };
    }
    case "assignment_removed": {
      const subject = `You were removed from ${res}`;
      const lines = [
        `Hi ${e(firstName(name))},`,
        `The office removed you from the ${e(role)} assignment for ${e(res)}${when ? ` on ${e(when)}` : ""}. You no longer need to work it.`,
        "Questions? Reply to this email.",
      ];
      return { subject, html: shell(subject, lines), text: `The office removed you from the ${role} assignment for ${res}${when ? ` on ${when}` : ""}.` };
    }
    case "staff_unassigned": {
      const subject = `Staff unassigned: ${name} - ${res}`;
      const lines = [
        `<b>${e(name)}</b> removed themselves from the ${e(role)} assignment for ${e(res)}${when ? ` on ${e(when)}` : ""}.`,
        "Please assign someone else.",
      ];
      const url = row.booking_id ? adminBookingUrl(row.booking_id) : undefined;
      const text = `${name} removed themselves from the ${role} assignment for ${res}${when ? ` on ${when}` : ""}. Please assign someone else.`;
      return { subject, html: shell(subject, lines, url ? { label: "Open booking", url } : undefined), text: url ? `${text}\n${url}` : text };
    }
    case "pending_escalation": {
      const subject = `Not accepted yet: ${name} - ${res}`;
      const lines = [
        `<b>${e(name)}</b> has not accepted the ${e(role)} assignment for ${e(res)}${when ? `, which is on ${e(when)}` : ""}.`,
        "The booking is not ready until they accept. Call them, or record their answer on the booking.",
      ];
      const url = row.booking_id ? adminBookingUrl(row.booking_id) : undefined;
      const text = `${name} has not accepted the ${role} assignment for ${res}${when ? ` (${when})` : ""}.`;
      return { subject, html: shell(subject, lines, url ? { label: "Open booking", url } : undefined), text: url ? `${text}\n${url}` : text };
    }
    case "pending_digest": {
      const items = (Array.isArray(p.items) ? p.items : []) as DigestItem[];
      const live = items.filter((i) => i && i.booking_id);
      if (live.length === 0) return null;
      const n = live.length;
      const subject = `Please accept or decline: ${n} assignment${n === 1 ? "" : "s"}`;
      const rows = live
        .map((i) => {
          const url = staffBookingUrl(String(i.booking_id));
          const w = whenLine(i as Record<string, unknown>);
          return `<tr><td style="padding:10px 0;border-top:1px solid #e2e8f0;font-size:14px;line-height:1.5;color:#334155;">
<b>${e(w || "Date to be confirmed")}</b><br/>${e(i.role || "Staff")} · ${e(resLabel(i as Record<string, unknown>))}<br/>
<a href="${e(url)}" style="color:#0369a1;">Open and answer</a></td></tr>`;
        })
        .join("");
      const lines = [
        `Hi ${e(firstName(name))},`,
        `${n === 1 ? "This assignment is" : "These assignments are"} waiting for your answer. The booking is not ready until you accept.`,
      ];
      const extra = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:4px 0 14px;">${rows}</table>
<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#334155;">Can't work one? Open it and tap Reject so the office can find someone else.</p>`;
      const text = [
        `${n === 1 ? "This assignment is" : "These assignments are"} waiting for your answer:`,
        ...live.map((i) => `- ${whenLine(i as Record<string, unknown>)} · ${i.role || "Staff"} · ${resLabel(i as Record<string, unknown>)}: ${staffBookingUrl(String(i.booking_id))}`),
      ].join("\n");
      return { subject, html: shell(subject, lines, undefined, extra), text };
    }
    default:
      return null;
  }
}
