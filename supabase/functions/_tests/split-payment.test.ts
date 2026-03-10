import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

/**
 * Verify 80/20 Stripe split is correctly configured in all payment edge functions.
 */

const FUNCTIONS_TO_CHECK = [
  {
    name: "create-checkout (deposit)",
    path: "supabase/functions/create-checkout/index.ts",
  },
  {
    name: "create-balance-payment-link (balance)",
    path: "supabase/functions/create-balance-payment-link/index.ts",
  },
  {
    name: "create-invoice (standalone invoice)",
    path: "supabase/functions/create-invoice/index.ts",
  },
  {
    name: "create-addon-invoice (addon invoice)",
    path: "supabase/functions/create-addon-invoice/index.ts",
  },
];

describe("Stripe 80/20 split payment configuration", () => {
  for (const fn of FUNCTIONS_TO_CHECK) {
    describe(fn.name, () => {
      const src = readFileSync(fn.path, "utf-8");

      it("contains transfer_data", () => {
        expect(src).toContain("transfer_data");
      });

      it("uses 0.20 multiplier for 20% split", () => {
        expect(src).toContain("* 0.20");
      });

      it("references STRIPE_CONNECTED_ACCOUNT_ID", () => {
        expect(src).toContain("STRIPE_CONNECTED_ACCOUNT_ID");
      });

      it("sets destination: connectedAccountId", () => {
        expect(src).toContain("destination: connectedAccountId");
      });

      it("wraps transfer_data inside payment_intent_data", () => {
        expect(src).toContain("payment_intent_data");

        // Every occurrence of transfer_data must be preceded by payment_intent_data
        const matches = [...src.matchAll(/transfer_data/g)];
        for (const m of matches) {
          const idx = m.index!;
          const preceding = src.substring(Math.max(0, idx - 300), idx);
          expect(preceding).toContain("payment_intent_data");
        }
      });
    });
  }
});
