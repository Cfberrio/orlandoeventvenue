// Client-side mirror of admin_record_payment's rules (ClickUp 86e40ach2, M-7).
// The database function is the authority; this only shapes the form.

export type PaymentKind = "deposit" | "balance" | "full";
export type PaymentMethod = "cash" | "zelle" | "check" | "card_external" | "other";

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  zelle: "Zelle",
  check: "Check",
  card_external: "Card (other terminal)",
  other: "Other",
};

interface PayableBooking {
  deposit_amount: number | string | null;
  balance_amount: number | string | null;
  deposit_paid_at: string | null;
  balance_paid_at: string | null;
}

/** Steps that can still be recorded, most likely first. */
export function recordablePaymentKinds(b: PayableBooking): PaymentKind[] {
  if (!b.deposit_paid_at) return ["deposit", "full"];
  if (!b.balance_paid_at) return ["balance"];
  return [];
}

export function expectedPaymentAmount(b: PayableBooking, kind: PaymentKind): number {
  const deposit = Number(b.deposit_amount ?? 0);
  const balance = Number(b.balance_amount ?? 0);
  const raw = kind === "deposit" ? deposit : kind === "balance" ? balance : deposit + balance;
  return Math.round(raw * 100) / 100;
}

export function validateRecordPayment(input: {
  kind: PaymentKind | "";
  method: PaymentMethod | "";
  reference: string;
  paidOn: string; // yyyy-MM-dd
  today: string; // yyyy-MM-dd
}): string | null {
  if (!input.kind) return "Choose what was paid.";
  if (!input.method) return "Choose the payment method.";
  if (input.method !== "cash" && !input.reference.trim()) return "Add a reference for this method.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) return "Choose the date received.";
  if (input.paidOn > input.today) return "The date received cannot be in the future.";
  return null;
}
