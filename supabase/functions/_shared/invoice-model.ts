// What a deposit or balance invoice says, as data (pure; no Deno imports).
//
// Rules every invoice follows:
// - Every line shows Full price, Discount, Net and the amount paid in this
//   payment; each column sums exactly to its total.
// - The discount and its code are always visible when one was applied.
// - Fee and total charged are the amounts persisted when the Stripe session
//   was created (what Stripe actually charged), never recomputed.

import {
  allocateCents,
  describeDiscount,
  fromCents,
  invoiceLinesFromStored,
  toCents,
  type DiscountKind,
  type DiscountTarget,
  type PriceLine,
  type StoredBookingForInvoice,
} from "./booking-pricing.ts";

export type InvoiceKind = "deposit" | "balance";

export interface InvoiceBooking extends StoredBookingForInvoice {
  reservation_number: string;
  full_name: string;
  email: string;
  event_date: string;
  event_type: string | null;
  number_of_guests: number | null;
  booking_type: string;
  start_time: string | null;
  end_time: string | null;
  processing_fee_pct: number | null;
  deposit_fee: number | null;
  deposit_total_charged: number | null;
  balance_fee: number | null;
  balance_total_charged: number | null;
  deposit_paid_at?: string | null;
  bar_guest_count?: number | null;
  bar_rate_per_guest?: number | null;
}

export interface InvoiceSnapshot {
  discount_code: string | null;
  discount_type: DiscountKind | null;
  discount_value: number | null;
  discount_applies_to: DiscountTarget | null;
  lines: unknown;
}

export interface InvoiceRow {
  label: string;
  sub?: string;
  gross: number;
  discount: number;
  net: number;
  /** Paid in THIS payment. */
  paid: number;
}

export interface InvoiceModel {
  kind: InvoiceKind;
  rows: InvoiceRow[];
  totals: { gross: number; discount: number; net: number; paid: number };
  /** e.g. "Discount code MILITARYSERVICE: 100% off base rental". Null when no discount. */
  discountNote: string | null;
  /** Deposit or balance base amount (before fee). */
  subtotalLabel: string;
  subtotal: number;
  feePct: number;
  fee: number;
  totalCharged: number;
  /** Deposit invoice: remaining balance. Balance invoice: deposit paid earlier. */
  footnote: string;
}

function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function isPriceLineArray(v: unknown): v is PriceLine[] {
  return Array.isArray(v) && v.every((l) =>
    l && typeof l === "object" &&
    typeof (l as PriceLine).label === "string" &&
    ["gross", "discount", "net", "deposit", "balance"].every((k) => Number.isFinite(Number((l as Record<string, unknown>)[k])))
  );
}

const sumCents = (xs: number[]) => xs.reduce((a, b) => a + toCents(b), 0);

/**
 * Lines with their deposit/balance split. Uses the checkout snapshot when it
 * still matches the stored booking to the cent; otherwise rebuilds from the
 * stored columns (identical totals, exact sums).
 */
export function resolveLines(b: InvoiceBooking, snap: InvoiceSnapshot | null): PriceLine[] {
  if (snap && isPriceLineArray(snap.lines)) {
    const lines = snap.lines.map((l) => ({
      ...l,
      gross: Number(l.gross), discount: Number(l.discount), net: Number(l.net),
      deposit: Number(l.deposit), balance: Number(l.balance),
    }));
    const matches =
      sumCents(lines.map((l) => l.net)) === toCents(b.total_amount) &&
      sumCents(lines.map((l) => l.deposit)) === toCents(b.deposit_amount) &&
      sumCents(lines.map((l) => l.balance)) === toCents(b.balance_amount) &&
      sumCents(lines.map((l) => l.discount)) === toCents(b.discount_amount);
    if (matches) return lines.filter((l) => l.gross !== 0);
  }
  return invoiceLinesFromStored(b, snap?.discount_applies_to ?? null);
}

export function buildInvoiceModel(
  kind: InvoiceKind,
  b: InvoiceBooking,
  snap: InvoiceSnapshot | null,
  fallbackFeePct: number,
): InvoiceModel {
  const lines = resolveLines(b, snap);

  const rows: InvoiceRow[] = lines.map((l) => {
    let sub: string | undefined;
    if (l.key === "base_rental") sub = b.booking_type === "daily" ? "Full Day (24 hours)" : "Hourly";
    if (l.key === "bar" && b.bar_guest_count) {
      sub = `${b.bar_guest_count} guests${b.bar_rate_per_guest ? ` × ${money(Number(b.bar_rate_per_guest))}` : ""}`;
    }
    return {
      label: l.label,
      sub,
      gross: l.gross,
      discount: l.discount,
      net: l.net,
      paid: kind === "deposit" ? l.deposit : l.balance,
    };
  });

  // Guarantee the paid column sums to the stored amount even if a legacy row
  // was off by a cent (re-allocate by net).
  const target = toCents(kind === "deposit" ? b.deposit_amount : b.balance_amount);
  if (sumCents(rows.map((r) => r.paid)) !== target) {
    const parts = allocateCents(target, rows.map((r) => toCents(r.net)));
    rows.forEach((r, i) => (r.paid = fromCents(parts[i])));
  }

  const totals = {
    gross: fromCents(sumCents(rows.map((r) => r.gross))),
    discount: fromCents(sumCents(rows.map((r) => r.discount))),
    net: fromCents(sumCents(rows.map((r) => r.net))),
    paid: fromCents(target),
  };

  let discountNote: string | null = null;
  const code = (b.discount_code || snap?.discount_code || "").trim();
  if (toCents(b.discount_amount) > 0) {
    const terms =
      snap?.discount_type && snap.discount_value != null && snap.discount_applies_to
        ? `: ${describeDiscount(snap.discount_type, Number(snap.discount_value), snap.discount_applies_to)}`
        : "";
    discountNote = code
      ? `Discount code ${code.toUpperCase()}${terms} (saved ${money(Number(b.discount_amount))})`
      : `Discount applied (saved ${money(Number(b.discount_amount))})`;
  }

  const feePct = Number(b.processing_fee_pct ?? fallbackFeePct);
  const subtotal = fromCents(target);
  const persistedFee = kind === "deposit" ? b.deposit_fee : b.balance_fee;
  const persistedTotal = kind === "deposit" ? b.deposit_total_charged : b.balance_total_charged;
  const fee = persistedFee != null ? Number(persistedFee) : fromCents(Math.round(target * (feePct / 100)));
  const totalCharged = persistedTotal != null ? Number(persistedTotal) : fromCents(target + toCents(fee));

  const footnote =
    kind === "deposit"
      ? `Remaining 50% balance: ${money(Number(b.balance_amount))}, due 15 days before your event.`
      : `Deposit of ${money(Number(b.deposit_amount))} paid earlier. Event total: ${money(Number(b.total_amount))}. Booking now fully paid.`;

  return {
    kind,
    rows,
    totals,
    discountNote,
    subtotalLabel: kind === "deposit" ? "Deposit Subtotal (50%)" : "Balance Subtotal (50%)",
    subtotal,
    feePct,
    fee,
    totalCharged,
    footnote,
  };
}
