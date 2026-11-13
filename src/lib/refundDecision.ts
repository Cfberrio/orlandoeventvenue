// Client-side mirror of admin_record_refund_decision (ClickUp 86e40ach2, M-9).
// The database function is the authority; this only shapes the form.

export type RefundMethod = "stripe" | "cash" | "zelle" | "check" | "other";
export type RefundDecision = "refunded_in_full" | "refunded_in_part" | "kept";

export const REFUND_METHOD_LABELS: Record<RefundMethod, string> = {
  stripe: "Stripe refund",
  cash: "Cash",
  zelle: "Zelle",
  check: "Check",
  other: "Other",
};

export const REFUND_DECISION_LABELS: Record<RefundDecision, string> = {
  refunded_in_full: "Refunded in full",
  refunded_in_part: "Refunded in part",
  kept: "Kept (no refund)",
};

export interface CollectedBreakdown {
  deposit: number;
  balance: number;
  addons: number;
  total: number;
  /** Already refunded or kept in an earlier decision. */
  decided: number;
  /** What still needs a decision. */
  undecided: number;
}

export function toCollected(raw: unknown): CollectedBreakdown {
  const r = (raw ?? {}) as Record<string, unknown>;
  const n = (v: unknown) => {
    const x = Number(v ?? 0);
    return Number.isFinite(x) ? Math.round(x * 100) / 100 : 0;
  };
  const total = n(r.total);
  const decided = n(r.decided);
  const undecided = r.undecided == null ? Math.round((total - decided) * 100) / 100 : n(r.undecided);
  return { deposit: n(r.deposit), balance: n(r.balance), addons: n(r.addons), total, decided, undecided };
}

export function refundDecisionFor(amount: number, collected: number): RefundDecision {
  if (amount >= collected - 0.01) return "refunded_in_full";
  if (amount > 0) return "refunded_in_part";
  return "kept";
}

/** Parses "12.5", "$1,234.00" etc. Returns NaN when it is not a money amount. */
export function parseMoney(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

export function validateRefundDecision(input: {
  amount: number;
  collected: number;
  method: RefundMethod | "";
  reference: string;
  note: string;
  refundedOn: string; // yyyy-MM-dd
  today: string; // yyyy-MM-dd
}): string | null {
  if (!Number.isFinite(input.amount) || input.amount < 0) return "Enter the amount refunded (0 if nothing).";
  if (input.amount > input.collected + 0.01) return `The refund cannot be more than the $${input.collected.toFixed(2)} collected.`;
  const decision = refundDecisionFor(input.amount, input.collected);
  if (input.amount > 0) {
    if (!input.method) return "Choose how the money was refunded.";
    if (input.method !== "cash" && !input.reference.trim()) return "Add the refund reference (Stripe refund id, Zelle confirmation, check #).";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.refundedOn)) return "Choose the refund date.";
    if (input.refundedOn > input.today) return "The refund date cannot be in the future.";
  }
  if (decision !== "refunded_in_full" && !input.note.trim()) return "Say why part of the money is kept.";
  return null;
}
