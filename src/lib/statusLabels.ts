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

// Reports (ClickUp 86e40ach2 R2-8): revenue category and item-type codes.
const REVENUE_CATEGORY_LABELS: Record<string, string> = {
  baseline: "Venue Rental",
  cleaning_base: "Cleaning",
  cleaning_surcharge: "Celebration Surcharge",
  production: "Production Package",
  addon: "Add-ons",
  bar_service: "Bar Service",
  discount: "Discounts",
  tax: "Taxes",
  fee: "Other Fees",
  invoice: "Standalone Invoices",
  cancelled_kept: "Cancelled (kept)",
  cancelled_unrecorded: "Cancelled (refund not recorded)",
  card_fee: "Card Fees (paid by guests)",
  external: "External (paid on platform)",
};

const REVENUE_ITEM_TYPE_LABELS: Record<string, string> = {
  hourly: "Hourly",
  daily: "Full Day",
  touch_up: "Touch-up",
  regular: "Regular",
  deep: "Deep",
  celebration: "Celebration",
  basic: "Basic",
  led: "LED",
  workshop: "Workshop",
  tablecloth: "Tablecloths",
  setup_breakdown: "Setup & Breakdown",
  misc: "Optional Services",
  manual: "Manual Discount",
  house_beer_wine: "House Beer & Wine",
  essential_bar: "Essential Bar",
  signature_bar: "Signature Bar",
  bespoke_bar: "Bespoke Bar",
  standalone: "One-time",
  recurring: "Recurring",
  deposit: "Deposit",
  balance: "Balance",
  addon: "Add-on Invoice",
  invoice: "Invoice",
  refund: "Refund",
  taxes_fees: "Taxes & Fees",
};

export const revenueCategoryLabel = (v: string | null | undefined) => lookup(REVENUE_CATEGORY_LABELS, v);

/** Item type within a revenue category. Discount item types are coupon codes: keep them as typed. */
export function revenueItemTypeLabel(category: string | null | undefined, itemType: string | null | undefined): string {
  const t = itemType?.trim();
  if (!t) return "—";
  if (category === "discount" && t !== "manual") return `Coupon ${t.toUpperCase()}`;
  return lookup(REVENUE_ITEM_TYPE_LABELS, t);
}

const BOOKING_ORIGIN_LABELS: Record<string, string> = {
  website: "Website",
  internal: "Internal",
  external: "External",
  invoice: "Standalone Invoice",
};

export const bookingOriginLabel = (v: string | null | undefined) => lookup(BOOKING_ORIGIN_LABELS, v);

const STAFF_ROLE_LABELS: Record<string, string> = {
  cleaner: "Cleaner",
  custodial: "Custodial",
  assistant: "Assistant",
  production: "Production",
  "bar vendor": "Bar Vendor",
};

export const staffRoleLabel = (v: string | null | undefined) => lookup(STAFF_ROLE_LABELS, v);
