import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { depositSplit, splitLabel } from "../_shared/deposit-split";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("E-3 deposit split labels", () => {
  it("keeps the frontend and edge copies byte-identical", () => {
    expect(read("src/lib/depositSplit.ts")).toBe(read("supabase/functions/_shared/deposit-split.ts"));
  });

  it("reads the split stored on the booking", () => {
    expect(depositSplit({ deposit_amount: 277.5, total_amount: 555 })).toEqual({ firstPct: 50, finalPct: 50 });
    expect(depositSplit({ deposit_amount: 300, total_amount: 1000 })).toEqual({ firstPct: 30, finalPct: 70 });
    expect(splitLabel("balance", { deposit_amount: "250", total_amount: "1000" })).toBe("Final 75%");
  });

  it("falls back to the Pricing value only without amounts", () => {
    expect(depositSplit({ deposit_amount: null, total_amount: 0 }, 40)).toEqual({ firstPct: 40, finalPct: 60 });
    expect(depositSplit({}, Number.NaN)).toEqual({ firstPct: 50, finalPct: 50 });
  });

  it("no transactional surface hardcodes 50%", () => {
    for (const f of [
      "supabase/functions/create-checkout/index.ts",
      "supabase/functions/create-balance-payment-link/index.ts",
      "supabase/functions/_shared/invoice-model.ts",
      "supabase/functions/_shared/invoice-pdf.ts",
      "supabase/functions/send-booking-confirmation/index.ts",
      "src/pages/BookingConfirmation.tsx",
      "src/components/booking/PaymentStep.tsx",
    ]) {
      expect(read(f), f).not.toMatch(/\b50%|fifty percent/i);
    }
  });
});
