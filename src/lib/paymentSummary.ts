// M-13 (ClickUp 86e40ach2): what the admin Payment Summary shows as charged.
// Before, the processing fee was a hardcoded "Applied per transaction" and the
// total excluded it (9CMUGG showed $1,151; the guest paid $1,194.16).

export interface ChargeableBooking {
  deposit_amount: number | string | null;
  balance_amount: number | string | null;
  deposit_paid_at: string | null;
  balance_paid_at: string | null;
  deposit_fee: number | string | null;
  balance_fee: number | string | null;
  deposit_total_charged: number | string | null;
  balance_total_charged: number | string | null;
}

export interface ChargedAddon {
  total_amount?: number | string | null;
  total_charged?: number | string | null;
  processing_fee?: number | string | null;
}

export interface PaymentRow {
  label: string;
  base: number;
  fee: number;
  charged: number;
  paidAt: string | null;
}

const money = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** One row per payment step (paid or still due) plus each paid add-on. */
export function paymentRows(b: ChargeableBooking, paidAddons: ChargedAddon[] = []): PaymentRow[] {
  const rows: PaymentRow[] = [];
  const step = (label: string, base: unknown, fee: unknown, charged: unknown, paidAt: string | null) => {
    const baseN = money(base as number);
    if (baseN <= 0 && !paidAt) return;
    if (paidAt) {
      const chargedN = charged != null ? money(charged as number) : baseN + money(fee as number);
      rows.push({ label, base: baseN, fee: money(chargedN - baseN), charged: chargedN, paidAt });
    } else {
      rows.push({ label, base: baseN, fee: 0, charged: 0, paidAt: null });
    }
  };
  step("Deposit", b.deposit_amount, b.deposit_fee, b.deposit_total_charged, b.deposit_paid_at);
  step("Balance", b.balance_amount, b.balance_fee, b.balance_total_charged, b.balance_paid_at);
  paidAddons.forEach((a, i) => {
    const base = money(a.total_amount);
    const charged = a.total_charged != null ? money(a.total_charged) : base + money(a.processing_fee);
    rows.push({ label: paidAddons.length > 1 ? `Add-on ${i + 1}` : "Add-on", base, fee: money(charged - base), charged, paidAt: "paid" });
  });
  return rows;
}

export function totalCharged(rows: PaymentRow[]): number {
  return money(rows.reduce((s, r) => s + (r.paidAt ? r.charged : 0), 0));
}

export function amountDue(rows: PaymentRow[]): number {
  return money(rows.reduce((s, r) => s + (r.paidAt ? 0 : r.base), 0));
}

export function formatMoney(v: number): string {
  return `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
