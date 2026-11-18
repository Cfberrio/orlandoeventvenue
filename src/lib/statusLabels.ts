// One place for the human labels of the status-like codes the admin shows.
// ClickUp 86e40ach2 C-1 / C-24. Display only: never compare against these strings.

const LIFECYCLE_LABELS: Record<string, string> = {
  pending: "Pending Review",
  confirmed: "Confirmed",
  pre_event_ready: "Ready for Event",
  in_progress: "Event In Progress",
  post_event: "Post Event",
  closed_review_complete: "Closed",
  cancelled: "Cancelled",
};

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  deposit_paid: "Deposit Paid",
  fully_paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  invoiced: "Invoiced",
};

const BOOKING_TYPE_LABELS: Record<string, string> = {
  hourly: "Hourly",
  daily: "Daily",
};

const CLEANING_TYPE_LABELS: Record<string, string> = {
  touch_up: "Touch-up",
  regular: "Regular",
  deep: "Deep",
};

/** Generic work status (cleaning reports, standalone assignments, inventory). */
const WORK_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  assigned: "Assigned",
  in_progress: "In Progress",
  completed: "Completed",
  approved: "Approved",
  cancelled: "Cancelled",
  stocked: "Stocked",
  low: "Low",
  out: "Out",
};

/** "some_raw-code" -> "Some Raw Code". Fallback for values no map knows yet. */
export function humanizeCode(value: string | null | undefined): string {
  const v = value?.trim();
  if (!v) return "—";
  return v
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function lookup(map: Record<string, string>, value: string | null | undefined): string {
  const v = value?.trim();
  if (!v) return "—";
  return map[v] ?? map[v.toLowerCase()] ?? humanizeCode(v);
}

export const lifecycleLabel = (v: string | null | undefined) => lookup(LIFECYCLE_LABELS, v);
export const paymentStatusLabel = (v: string | null | undefined) => lookup(PAYMENT_STATUS_LABELS, v);
export const bookingTypeLabel = (v: string | null | undefined) => lookup(BOOKING_TYPE_LABELS, v);
export const cleaningTypeLabel = (v: string | null | undefined) => lookup(CLEANING_TYPE_LABELS, v);
export const workStatusLabel = (v: string | null | undefined) => lookup(WORK_STATUS_LABELS, v);
