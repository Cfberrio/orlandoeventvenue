// E-3 (86e40ach2): deposit / balance percentages for customer-facing labels.
//
// The deposit % is editable in Pricing, but every receipt, Stripe line and
// email said "50%". The booking already stores what was actually split
// (deposit_amount / total_amount), so labels read that, never a constant.
//
// KEEP BYTE-IDENTICAL: src/lib/depositSplit.ts and
// supabase/functions/_shared/deposit-split.ts (checked by a test).

export interface DepositSplitInput {
  deposit_amount?: number | string | null;
  total_amount?: number | string | null;
}

export interface DepositSplit {
  /** Whole-number percent paid up front, e.g. 50. */
  firstPct: number;
  /** Whole-number percent left for the balance, e.g. 50. */
  finalPct: number;
}

/**
 * Percent split stored on the booking, rounded to whole percent.
 * fallbackPct (the current Pricing value) is used only when the booking has
 * no usable amounts yet.
 */
export function depositSplit(b: DepositSplitInput, fallbackPct = 50): DepositSplit {
  const dep = Number(b.deposit_amount);
  const tot = Number(b.total_amount);
  let first = Number.isFinite(dep) && Number.isFinite(tot) && tot > 0 && dep >= 0 ? Math.round((dep / tot) * 100) : NaN;
  if (!Number.isFinite(first)) first = Math.round(Number(fallbackPct));
  if (!Number.isFinite(first)) first = 50;
  first = Math.min(100, Math.max(0, first));
  return { firstPct: first, finalPct: 100 - first };
}

/** "First 50%" / "Final 50%" for the given payment. */
export function splitLabel(kind: "deposit" | "balance", b: DepositSplitInput, fallbackPct = 50): string {
  const s = depositSplit(b, fallbackPct);
  return kind === "deposit" ? `First ${s.firstPct}%` : `Final ${s.finalPct}%`;
}
