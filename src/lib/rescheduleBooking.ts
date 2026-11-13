// Admin reschedule call + how its result is shown.
//
// The dialog used to fetch `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/...`.
// That env var is not set in the Lovable build, so production requested
// "undefined/functions/v1/reschedule-booking", got the SPA's index.html back
// and failed with "Unexpected token '<'". functions.invoke resolves the URL
// and the session token from the configured client instead.

export interface ReschedulePayload {
  booking_id: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  reason: string | null;
}

export interface RescheduleResult {
  ok: boolean;
  error?: string;
  message?: string;
  changed?: boolean;
  conflict?: { guest?: string; type?: string } | null;
  warnings?: string[];
  [key: string]: unknown;
}

interface InvokeClient {
  functions: {
    invoke: (
      name: string,
      options: { body: unknown },
    ) => Promise<{ data: unknown; error: unknown }>;
  };
}

/**
 * Calls reschedule-booking. Business errors come back with HTTP 200 and
 * ok:false; auth/validation/server errors come back as non-2xx JSON, which
 * functions.invoke surfaces as an error carrying the Response in `context`.
 * Both are normalised to a RescheduleResult. Only a transport failure, or a
 * body that is not JSON, throws.
 */
export async function rescheduleBooking(
  client: InvokeClient,
  payload: ReschedulePayload,
): Promise<RescheduleResult> {
  const { data, error } = await client.functions.invoke("reschedule-booking", { body: payload });

  if (!error) {
    if (data && typeof data === "object") return data as RescheduleResult;
    throw new Error("Unexpected response from reschedule-booking");
  }

  const context = (error as { context?: unknown }).context;
  if (context && typeof (context as Response).json === "function") {
    const body = await (context as Response).json().catch(() => null);
    if (body && typeof body === "object") return body as RescheduleResult;
  }
  throw error instanceof Error ? error : new Error(String(error));
}

const ERROR_MESSAGES: Record<string, string> = {
  date_conflict: "That date is already reserved.",
  daily_conflict: "That date has a full-day rental.",
  time_overlap: "That time overlaps with another booking.",
  blocked_date: "That date is blocked on the availability calendar.",
  past_date: "The new date is in the past.",
  times_required: "Start and end times are required for hourly bookings.",
  invalid_time_range: "End time must be after start time.",
  invalid_event_window: "Event window end time must be after start time.",
  admin_required: "Only admins can reschedule bookings.",
  event_already_happened: "This event already happened; it cannot be moved.",
  booking_cancelled: "Cancelled bookings cannot be rescheduled.",
  unpaid_length_change: "The guest has not paid the deposit yet: change the date or start time only, or have them rebook with the new hours.",
  invalid_token: "Your session expired. Sign in again and retry.",
  unauthorized: "Your session expired. Sign in again and retry.",
};

const FOLLOW_UP_LABELS: Record<string, string> = {
  host_report: "host report reminders",
  guest_feedback: "guest feedback email",
  balance: "remaining balance / lifecycle jobs",
  ghl_sync: "GHL contact sync",
  staff_notice: "staff schedule-change emails",
};

/** M-1: what the office still has to look at after a reschedule. */
export function rescheduleReviewNotes(result: RescheduleResult): string {
  const notes: string[] = [];
  const price = result.price as { delta?: number | string } | undefined;
  const delta = Number(price?.delta ?? 0);
  if (result.price_review_id && Math.abs(delta) >= 0.01) {
    notes.push(
      delta > 0
        ? `The new hours cost $${delta.toFixed(2)} more: choose how to handle it on this page.`
        : `The new hours cost $${(-delta).toFixed(2)} less: choose how to handle it on this page.`,
    );
  }
  const staff = Number(result.staff_to_review ?? 0);
  if (staff > 0) notes.push(`Check the hours of ${staff} staff member${staff === 1 ? "" : "s"}.`);
  return notes.join(" ");
}

export interface RescheduleToast {
  title: string;
  description: string;
  variant?: "destructive";
  /** Close the dialog and reload the booking. */
  success: boolean;
}

export function describeRescheduleResult(result: RescheduleResult): RescheduleToast {
  if (!result.ok) {
    const message =
      (result.error && ERROR_MESSAGES[result.error]) || result.message || "Unable to reschedule booking";
    const who = result.conflict?.guest || result.conflict?.type;
    return {
      title: "Cannot reschedule",
      description: who ? `${message} (${who})` : message,
      variant: "destructive",
      success: false,
    };
  }

  const warnings = result.warnings ?? [];
  if (warnings.length === 1 && warnings[0] === "staff_notice") {
    // Re-saving the same date does not resend staff emails (nothing changed).
    return {
      title: "Booking rescheduled — staff email not sent",
      description:
        "Date saved, but the schedule-change email did not reach every staff member. Tell them directly; the staff review on this page lists who is on the event.",
      variant: "destructive",
      success: true,
    };
  }
  if (warnings.length > 0) {
    const failed = warnings.map((w) => FOLLOW_UP_LABELS[w] ?? w).join(", ");
    return {
      title: "Booking rescheduled — some follow-ups failed",
      description:
        `Date saved, but these did not update: ${failed}. ` +
        "Save the same date again to retry, or check the booking's jobs before the event.",
      variant: "destructive",
      success: true,
    };
  }

  if (result.changed === false) {
    // Same date/time re-submitted: the server still re-checks every follow-up,
    // which is how a failed follow-up is retried.
    return {
      title: "Date unchanged",
      description: "Reminders, balance jobs and GHL were re-checked for the current date.",
      success: true,
    };
  }

  const notes = rescheduleReviewNotes(result);
  return {
    title: "Booking rescheduled successfully!",
    description:
      "Date updated, reminders and balance jobs rebuilt, GHL synced, staff emailed." + (notes ? ` ${notes}` : ""),
    success: true,
  };
}
