export type DiscountType = "percent" | "fixed";

/** Stripe rejects charges under $0.50 USD, so a discount can never take the net below it. */
export const MIN_INVOICE_NET = 0.5;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Subtotal over the rows that actually get billed.
 *
 * A row needs both a name and a positive amount to survive into `line_items`.
 * An unnamed row is dropped there, so counting it in the subtotal would inflate
 * `amount` — and a discounted invoice bills Stripe a single line at `amount`,
 * charging the customer for an item that appears nowhere on the invoice.
 */
export function sumBillableItems(
  items: Array<{ label: string; amount: string | number }>
): number {
  const total = items.reduce((sum, item) => {
    const val = typeof item.amount === "number" ? item.amount : parseFloat(item.amount);
    if (!item.label.trim() || !Number.isFinite(val) || val <= 0) return sum;
    return sum + val;
  }, 0);
  return round2(total);
}

/**
 * Dollars taken off `subtotal`, clamped to [0, subtotal].
 * Returns 0 for a missing, non-numeric or negative value.
 */
export function computeDiscountAmount(
  subtotal: number,
  type: DiscountType | null,
  value: number | null
): number {
  if (!type || value == null || !Number.isFinite(value) || value <= 0) return 0;
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0;

  const raw = type === "percent" ? (subtotal * value) / 100 : value;
  return round2(Math.min(Math.max(raw, 0), subtotal));
}

/** Subtotal minus discount — what the customer owes before the processing fee. */
export function computeNetAmount(
  subtotal: number,
  type: DiscountType | null,
  value: number | null
): number {
  return round2(subtotal - computeDiscountAmount(subtotal, type, value));
}
