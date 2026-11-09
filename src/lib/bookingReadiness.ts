import type { BookingReadiness, ReadinessRequirement } from "@/hooks/useAdminData";

/**
 * How the admin UI presents pre-event readiness (ClickUp 86e3zjfq6).
 *
 * Two different things used to share the label "Ready for Event":
 *   - the confirmation checklist flag (bookings.pre_event_ready)
 *   - the lifecycle state pre_event_ready (what the Bookings list groups by)
 * The lifecycle is the source of truth. The GHL workflow moves it to
 * pre_event_ready, and the database only lets that happen when the rule
 * (evaluate_booking_readiness) holds: checklist complete + every selected
 * staff member accepted THIS event (external bookings are staff-exempt).
 * Between "rule met" and "GHL moved it" there are a few seconds: that state is
 * shown explicitly as waitingOnGhl.
 */

export type ReadinessBadge = "ready" | "not_ready" | "past" | "unknown";

export interface ReadinessView {
  badge: ReadinessBadge;
  label: string;
  checklistLabel: string;
  staffLabel: string | null;
  unmet: ReadinessRequirement[];
  /** Some selected staff have not answered yet; the view refreshes on its own. */
  waitingOnStaff: boolean;
  /** Every requirement is met; waiting for the GHL workflow to move the lifecycle. */
  waitingOnGhl: boolean;
  /** Offer "Mark checklist complete" (only the checklist, never the lifecycle). */
  showMarkChecklist: boolean;
}

const PAST_READY = ["in_progress", "post_event", "closed_review_complete", "cancelled"];

const PAST_LABELS: Record<string, string> = {
  in_progress: "Event in progress",
  post_event: "Post-event",
  closed_review_complete: "Closed",
  cancelled: "Cancelled",
};

export function describeReadiness(
  lifecycleStatus: string | null | undefined,
  readiness: BookingReadiness | null | undefined,
): ReadinessView {
  const lifecycle = lifecycleStatus || "pending";

  if (PAST_READY.includes(lifecycle)) {
    return {
      badge: "past",
      label: PAST_LABELS[lifecycle] ?? lifecycle,
      checklistLabel: "",
      staffLabel: null,
      unmet: [],
      waitingOnStaff: false,
      waitingOnGhl: false,
      showMarkChecklist: false,
    };
  }

  if (!readiness) {
    return {
      badge: "unknown",
      label: "Checking readiness…",
      checklistLabel: "",
      staffLabel: null,
      unmet: [],
      waitingOnStaff: false,
      waitingOnGhl: false,
      showMarkChecklist: false,
    };
  }

  const unmet = readiness.unmet ?? [];
  const staffLabel = readiness.staff_exempt
    ? "Staff acceptance not required (external booking)"
    : `Staff accepted: ${readiness.staff_accepted}/${readiness.staff_total}`;

  const waitingOnGhl = lifecycle === "confirmed" && readiness.ready === true;

  return {
    badge: lifecycle === "pre_event_ready" ? "ready" : "not_ready",
    label:
      lifecycle === "pre_event_ready"
        ? "✅ Pre-Event Ready"
        : waitingOnGhl
          ? "⏳ Requirements met, updating…"
          : "⏳ Not Pre-Event Ready",
    checklistLabel: readiness.checklist_complete
      ? "Confirmation checklist: complete"
      : "Confirmation checklist: incomplete",
    staffLabel,
    unmet,
    waitingOnStaff: unmet.some((u) => u.code === "staff_pending"),
    waitingOnGhl,
    showMarkChecklist: !readiness.checklist_complete && lifecycle !== "pending",
  };
}

/** One-line summary for toasts after a checklist change. */
export function readinessToastText(readiness: BookingReadiness | null | undefined): string {
  if (!readiness) return "Saved.";
  if (readiness.lifecycle_status === "pre_event_ready") return "Booking is Pre-Event Ready.";
  if (readiness.ready) return "All requirements met. Moving to Pre-Event Ready in a few seconds.";
  const unmet = readiness.unmet ?? [];
  if (unmet.length === 0) return "Saved.";
  return `Not Pre-Event Ready yet: ${unmet.map((u) => u.message).join("; ")}`;
}
