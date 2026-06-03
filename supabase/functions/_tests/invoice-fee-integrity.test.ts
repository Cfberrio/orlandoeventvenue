import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

/**
 * Invoice / Stripe fee integrity.
 *
 * Guarantees that, across every payment path, the amount Stripe charges equals
 * subtotal + processing fee, that this exact total is persisted to the database,
 * and that PDFs / emails / dashboard all read the persisted total instead of the
 * bare subtotal. Also guards that the 80/20 Stripe Connect split bases are
 * unchanged.
 */

const read = (p: string) => readFileSync(p, "utf-8");

// ---------------------------------------------------------------------------
// A. Pure fee math — replicates the EXACT cents-based formula used in every
//    edge function: feeCents = round(round(subtotal*100) * pct/100).
// ---------------------------------------------------------------------------

function subtotalToCents(subtotal: number): number {
  return Math.round(subtotal * 100);
}
function feeCents(subtotalCents: number, pct: number): number {
  return Math.round(subtotalCents * (pct / 100));
}
function totalCents(subtotalCents: number, pct: number): number {
  return subtotalCents + feeCents(subtotalCents, pct);
}

describe("A. Fee math (cents-based, matches edge functions)", () => {
  it("the reported $32.57 case yields exactly $1.14 fee and $33.71 total at 3.5%", () => {
    const sc = subtotalToCents(32.57);
    expect(sc).toBe(3257);
    expect(feeCents(sc, 3.5)).toBe(114); // $1.14
    expect(totalCents(sc, 3.5)).toBe(3371); // $33.71
  });

  it("total always equals subtotal + fee (invariant) over a wide range", () => {
    for (let dollars = 1; dollars <= 5000; dollars += 7.13) {
      const sc = subtotalToCents(dollars);
      expect(totalCents(sc, 3.5)).toBe(sc + feeCents(sc, 3.5));
    }
  });

  it("fee is a non-negative integer number of cents", () => {
    for (const amt of [1, 49.99, 100, 199, 1500, 3257, 8123.45]) {
      const f = feeCents(subtotalToCents(amt), 3.5);
      expect(Number.isInteger(f)).toBe(true);
      expect(f).toBeGreaterThanOrEqual(0);
    }
  });

  it("respects a custom fee percentage from venue_pricing (e.g. 2.9%)", () => {
    const sc = subtotalToCents(1000); // $1000
    expect(feeCents(sc, 2.9)).toBe(2900); // $29.00
    expect(totalCents(sc, 2.9)).toBe(102900); // $1029.00
  });

  it("deposit is a whole-dollar amount (SummaryStep Math.round) so cents math is exact", () => {
    // deposit = Math.round(subtotal * depositRate) → integer dollars
    const deposit = Math.round(3000 * 0.5);
    const sc = subtotalToCents(deposit);
    expect(sc % 100).toBe(0); // whole dollars → no sub-cent drift
    expect(totalCents(sc, 3.5)).toBe(sc + feeCents(sc, 3.5));
  });
});

// ---------------------------------------------------------------------------
// B. Each payment function computes total = base + fee and persists it.
// ---------------------------------------------------------------------------

const PAY_FUNCS = [
  {
    name: "create-checkout (deposit)",
    path: "supabase/functions/create-checkout/index.ts",
    base: "depositAmountCents",
    total: "totalChargeCents",
    persistFee: "deposit_fee",
    persistTotal: "deposit_total_charged",
  },
  {
    name: "create-balance-payment-link (balance)",
    path: "supabase/functions/create-balance-payment-link/index.ts",
    base: "balanceAmountCents",
    total: "totalChargeCents",
    persistFee: "balance_fee",
    persistTotal: "balance_total_charged",
  },
  {
    name: "create-invoice (standalone)",
    path: "supabase/functions/create-invoice/index.ts",
    base: "invoiceAmountCents",
    total: "totalWithFeeCents",
    persistFee: "processing_fee",
    persistTotal: "total_charged",
  },
  {
    name: "create-addon-invoice",
    path: "supabase/functions/create-addon-invoice/index.ts",
    base: "baseAmountCents",
    total: null, // addon sums line items inline; checked separately
    persistFee: "processing_fee",
    persistTotal: "total_charged",
  },
];

describe("B. Fee computed as base + fee and persisted", () => {
  for (const fn of PAY_FUNCS) {
    describe(fn.name, () => {
      const src = read(fn.path);

      it("computes feeCents from the base amount", () => {
        expect(src).toMatch(
          new RegExp(`feeCents\\s*=\\s*Math\\.round\\(${fn.base}\\s*\\*\\s*PROCESSING_FEE_RATE\\)`)
        );
      });

      if (fn.total) {
        it("total = base + fee", () => {
          expect(src).toContain(`${fn.total} = ${fn.base} + feeCents`);
        });
      }

      it(`persists ${fn.persistFee}`, () => {
        expect(src).toContain(`${fn.persistFee}:`);
      });

      it(`persists ${fn.persistTotal}`, () => {
        expect(src).toContain(`${fn.persistTotal}:`);
      });

      it("persisted fee equals feeCents / 100", () => {
        expect(src).toMatch(new RegExp(`${fn.persistFee}:\\s*feeCents\\s*/\\s*100`));
      });
    });
  }

  it("create-addon-invoice total_charged = (baseAmountCents + feeCents)/100", () => {
    const src = read("supabase/functions/create-addon-invoice/index.ts");
    expect(src).toContain("total_charged: (baseAmountCents + feeCents) / 100");
  });
});

// ---------------------------------------------------------------------------
// C. Stripe is charged base + fee as separate line items (so amount_total matches).
// ---------------------------------------------------------------------------

describe("C. Stripe line items include base + fee", () => {
  for (const fn of PAY_FUNCS) {
    it(`${fn.name} adds a fee line item with unit_amount: feeCents`, () => {
      const src = read(fn.path);
      expect(src).toContain("unit_amount: feeCents");
    });
  }
});

// ---------------------------------------------------------------------------
// D. Webhook forwards persisted fee fields to the receipt emails, and the
//    standalone "Payment Confirmation" shows the real total, not the subtotal.
// ---------------------------------------------------------------------------

describe("D. stripe-webhook forwards fee fields and shows real totals", () => {
  const src = read("supabase/functions/stripe-webhook/index.ts");

  it("deposit email body forwards deposit_fee + deposit_total_charged", () => {
    expect(src).toContain("deposit_fee: data.deposit_fee");
    expect(src).toContain("deposit_total_charged: data.deposit_total_charged");
  });

  it("balance email body forwards balance_fee + balance_total_charged", () => {
    expect(src).toContain("balance_fee: data.balance_fee");
    expect(src).toContain("balance_total_charged: data.balance_total_charged");
  });

  it("both receipt emails forward processing_fee_pct", () => {
    const matches = [...src.matchAll(/processing_fee_pct: data\.processing_fee_pct/g)];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });

  it("standalone invoice select includes total_charged + processing_fee", () => {
    expect(src).toMatch(/\.select\([^)]*total_charged[^)]*\)/);
    expect(src).toMatch(/\.select\([^)]*processing_fee[^)]*\)/);
  });

  it("standalone invoice Payment Confirmation uses total_charged (not bare amount) for the paid total", () => {
    // The customer-facing total must be the charged total, falling back to Stripe's amount_total.
    expect(src).toContain("inv.total_charged != null ? Number(inv.total_charged) : amountPaid");
    expect(src).toContain("const amtFormatted = `$${totalPaidAmt.toFixed(2)}`");
  });

  it("standalone invoice receipt appends a Processing Fee line so items sum to the total", () => {
    expect(src).toContain("Processing Fee (${feePct}%)");
  });

  it("has reconciliation guards comparing Stripe amount to persisted total_charged", () => {
    expect(src).toContain("RECONCILE_MISMATCH deposit");
    expect(src).toContain("RECONCILE_MISMATCH balance");
  });
});

// ---------------------------------------------------------------------------
// E. PDFs read the persisted total (with a legacy fallback), never just subtotal.
// ---------------------------------------------------------------------------

describe("E. Receipt PDFs read persisted totals", () => {
  it("deposit PDF uses booking.deposit_total_charged with fallback", () => {
    const src = read("supabase/functions/send-booking-confirmation/index.ts");
    expect(src).toContain("booking.deposit_total_charged != null");
    expect(src).toContain("Number(booking.deposit_total_charged)");
    expect(src).toContain("booking.deposit_fee != null");
  });

  it("balance PDF uses booking.balance_total_charged with fallback", () => {
    const src = read("supabase/functions/send-balance-confirmation/index.ts");
    expect(src).toContain("booking.balance_total_charged != null");
    expect(src).toContain("Number(booking.balance_total_charged)");
    expect(src).toContain("booking.balance_fee != null");
  });
});

// ---------------------------------------------------------------------------
// F. Admin dashboard shows the charged total (with fee), not the bare subtotal.
// ---------------------------------------------------------------------------

describe("F. Admin Invoices dashboard uses total_charged", () => {
  const src = read("src/pages/admin/Invoices.tsx");

  it("revenue stat sums total_charged (fallback amount)", () => {
    expect(src).toContain("Number(i.total_charged ?? i.amount)");
  });

  it("row amount displays total_charged (fallback amount)", () => {
    expect(src).toContain("Number(inv.total_charged ?? inv.amount)");
  });
});

// ---------------------------------------------------------------------------
// G. GHL sync forwards the charged totals so external emails are correct.
// ---------------------------------------------------------------------------

describe("G. sync-to-ghl forwards charged totals", () => {
  const src = read("supabase/functions/sync-to-ghl/index.ts");

  it("sends deposit_total_charged + balance_total_charged", () => {
    expect(src).toContain("deposit_total_charged:");
    expect(src).toContain("balance_total_charged:");
  });
});

// ---------------------------------------------------------------------------
// H. 80/20 Stripe Connect split bases are UNCHANGED (must not be broken).
//    Deposit/balance split 20% of the SUBTOTAL; invoices split 20% of the
//    fee-inclusive TOTAL. These bases are intentional and must stay as-is.
// ---------------------------------------------------------------------------

describe("H. 80/20 split bases unchanged", () => {
  it("create-checkout splits 20% of depositAmountCents (subtotal)", () => {
    const src = read("supabase/functions/create-checkout/index.ts");
    expect(src).toContain("Math.round(depositAmountCents * 0.20)");
  });

  it("create-balance-payment-link splits 20% of balanceAmountCents (subtotal)", () => {
    const src = read("supabase/functions/create-balance-payment-link/index.ts");
    expect(src).toContain("Math.round(balanceAmountCents * 0.20)");
  });

  it("create-invoice splits 20% of totalWithFeeCents (fee-inclusive)", () => {
    const src = read("supabase/functions/create-invoice/index.ts");
    expect(src).toContain("Math.round(totalWithFeeCents * 0.20)");
  });

  it("create-addon-invoice splits 20% of totalAmountCentsWithFee (fee-inclusive)", () => {
    const src = read("supabase/functions/create-addon-invoice/index.ts");
    expect(src).toContain("Math.round(totalAmountCentsWithFee * 0.20)");
  });

  it("every payment function still wraps transfer_data in payment_intent_data", () => {
    for (const fn of PAY_FUNCS) {
      const src = read(fn.path);
      expect(src).toContain("payment_intent_data");
      const matches = [...src.matchAll(/transfer_data/g)];
      for (const m of matches) {
        const preceding = src.substring(Math.max(0, m.index! - 320), m.index!);
        expect(preceding).toContain("payment_intent_data");
      }
    }
  });
});
