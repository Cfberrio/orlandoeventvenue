// Money math and formatting shared by Revenue Reports and Payroll Reports.
// ClickUp 86e40ach2 R2-7, R2-8, R2-10, R2-17, R2-19.

/** "$1,234.50", "-$225.05". Always exactly 2 decimals. */
export function money(v: number | string | null | undefined): string {
  const n = Number(v ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(safe).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return safe < 0 && abs !== "0.00" ? `-$${abs}` : `$${abs}`;
}

/** Share of a whole as "12.3%"; "—" when the whole is 0. */
export function pct(part: number, whole: number, digits = 1): string {
  if (!whole) return "—";
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

/** Average with 2-decimal rounding; 0 when there is nothing to divide by. */
export function avg(total: number, count: number): number {
  if (!count) return 0;
  return Math.round((total / count) * 100) / 100;
}

export interface InvoiceMoneyInput {
  amount: number | string | null;
  processing_fee: number | string | null;
  total_charged?: number | string | null;
  paid_offline_method?: string | null;
}

/**
 * Net / card fee / gross of a paid invoice. An invoice paid offline (cash,
 * Zelle, check) carried no card fee, whatever was pre-filled (R2-10).
 */
export function invoiceMoney(inv: InvoiceMoneyInput): { net: number; fee: number; gross: number } {
  const net = round2(Number(inv.amount ?? 0));
  const fee = inv.paid_offline_method ? 0 : round2(Number(inv.processing_fee ?? 0));
  return { net, fee, gross: round2(net + fee) };
}

export interface CategoryRow {
  category: string;
  item_type: string | null;
  total_amount: number | string;
  item_count: number | string;
}

export interface CategorySplit {
  /** Positive revenue categories (the pie). */
  revenue: { category: string; amount: number }[];
  /** Negative categories: discounts, refunds recorded on cancelled bookings. */
  deductions: { category: string; amount: number }[];
  cardFees: number;
  /** Sum of the positive categories, before discounts. */
  gross: number;
  /** gross + deductions (deductions are negative). */
  net: number;
}

/** R2-8: discounts are a deduction, not a pie slice; % is taken over gross. */
export function splitCategories(rows: CategoryRow[]): CategorySplit {
  const totals = new Map<string, number>();
  let cardFees = 0;
  for (const r of rows) {
    const amt = Number(r.total_amount) || 0;
    if (r.category === "card_fee") {
      cardFees += amt;
      continue;
    }
    totals.set(r.category, (totals.get(r.category) ?? 0) + amt);
  }
  const revenue: { category: string; amount: number }[] = [];
  const deductions: { category: string; amount: number }[] = [];
  for (const [category, raw] of totals) {
    const amount = round2(raw);
    if (amount > 0) revenue.push({ category, amount });
    else if (amount < 0) deductions.push({ category, amount });
  }
  revenue.sort((a, b) => b.amount - a.amount);
  deductions.sort((a, b) => a.amount - b.amount);
  const gross = round2(revenue.reduce((s, r) => s + r.amount, 0));
  const net = round2(gross + deductions.reduce((s, r) => s + r.amount, 0));
  return { revenue, deductions, cardFees: round2(cardFees), gross, net };
}

export interface PayrollLine {
  staff_id: string | null;
  amount: number | string;
  paid_status: string | null;
  not_payable_reason?: string | null;
}

export interface PayrollTotals {
  owed: number;
  paid: number;
  pending: number;
  notPayable: number;
  notPayableCount: number;
}

/**
 * R2-17: a line whose staff never accepted, or whose booking is cancelled, is
 * not owed. Paid lines always count as paid (that money already went out).
 */
export function payrollTotals(lines: PayrollLine[]): PayrollTotals {
  const t: PayrollTotals = { owed: 0, paid: 0, pending: 0, notPayable: 0, notPayableCount: 0 };
  for (const l of lines) {
    const amt = Number(l.amount) || 0;
    if (l.paid_status === "paid") {
      t.paid += amt;
      t.owed += amt;
    } else if (l.not_payable_reason) {
      t.notPayable += amt;
      t.notPayableCount += 1;
    } else {
      t.pending += amt;
      t.owed += amt;
    }
  }
  return {
    owed: round2(t.owed),
    paid: round2(t.paid),
    pending: round2(t.pending),
    notPayable: round2(t.notPayable),
    notPayableCount: t.notPayableCount,
  };
}

/** R2-19: totals per staff member, keyed by staff_id (never by name). */
export function payrollTotalsByStaff(lines: PayrollLine[]): Map<string, PayrollTotals> {
  const groups = new Map<string, PayrollLine[]>();
  for (const l of lines) {
    if (!l.staff_id) continue;
    const g = groups.get(l.staff_id) ?? [];
    g.push(l);
    groups.set(l.staff_id, g);
  }
  const out = new Map<string, PayrollTotals>();
  for (const [id, g] of groups) out.set(id, payrollTotals(g));
  return out;
}

export const NOT_PAYABLE_LABELS: Record<string, string> = {
  not_accepted: "Staff never accepted",
  booking_cancelled: "Booking cancelled",
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
