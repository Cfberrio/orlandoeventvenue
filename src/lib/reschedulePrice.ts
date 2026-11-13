// Client-side mirror of admin_resolve_reschedule_price (ClickUp 86e40ach2,
// M-1 / Luis D8). The database function is the authority.

export type PriceDecision = "apply_to_balance" | "charged_separately" | "refunded_separately" | "waived";

export const PRICE_DECISION_LABELS: Record<PriceDecision, string> = {
  apply_to_balance: "Adjust the unpaid balance",
  charged_separately: "Charged separately (invoice)",
  refunded_separately: "Refunded separately",
  waived: "Waive the difference",
};

export interface PriceReviewDetails {
  delta: number;
  old_total: number;
  new_total: number;
  old_hours?: number | null;
  new_hours?: number | null;
  old_package_hours?: number | null;
  new_package_hours?: number | null;
  discount_basis?: string;
}

export interface BalanceState {
  balance_amount: number | string | null;
  balance_paid_at: string | null;
  balance_link_expires_at?: string | null;
}

/** Decisions that make sense for this difference, with why others are not offered. */
export function priceDecisionOptions(
  delta: number,
  booking: BalanceState,
  now: Date = new Date(),
): Array<{ decision: PriceDecision; disabledReason: string | null }> {
  const balance = Number(booking.balance_amount ?? 0);
  const linkLive = booking.balance_link_expires_at != null && new Date(booking.balance_link_expires_at) > now;
  let applyReason: string | null = null;
  if (booking.balance_paid_at) applyReason = "The balance is already paid.";
  else if (linkLive) applyReason = "A balance link for the old amount is still live.";
  else if (balance + delta < -0.005) applyReason = "The reduction is larger than the unpaid balance.";

  const options: Array<{ decision: PriceDecision; disabledReason: string | null }> = [
    { decision: "apply_to_balance", disabledReason: applyReason },
  ];
  if (delta > 0) options.push({ decision: "charged_separately", disabledReason: null });
  if (delta < 0) options.push({ decision: "refunded_separately", disabledReason: null });
  options.push({ decision: "waived", disabledReason: null });
  return options;
}

export function validatePriceDecision(input: {
  decision: PriceDecision | "";
  reference: string;
  note: string;
}): string | null {
  if (!input.decision) return "Choose how to handle the difference.";
  if ((input.decision === "charged_separately" || input.decision === "refunded_separately") && !input.reference.trim()) {
    return input.decision === "charged_separately"
      ? "Add the invoice number or payment reference."
      : "Add the refund reference (Stripe refund id, Zelle confirmation, check #).";
  }
  if (input.decision === "waived" && !input.note.trim()) return "Say why the difference is waived.";
  return null;
}

export function describeDelta(delta: number): string {
  if (delta > 0) return `The new hours cost $${delta.toFixed(2)} more`;
  if (delta < 0) return `The new hours cost $${(-delta).toFixed(2)} less`;
  return "No price difference";
}
