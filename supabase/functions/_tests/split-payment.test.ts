import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";

/**
 * Verify 80/20 Stripe split is correctly configured in all payment edge functions.
 *
 * Run:
 *   deno test --allow-read supabase/functions/_tests/split-payment.test.ts
 */

const FUNCTIONS_TO_CHECK: { name: string; path: string }[] = [
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

for (const fn of FUNCTIONS_TO_CHECK) {
  Deno.test(`[${fn.name}] contains transfer_data with 20% split`, async () => {
    const src = await Deno.readTextFile(fn.path);

    // 1. Must reference transfer_data
    assertStringIncludes(
      src,
      "transfer_data",
      `${fn.name}: missing 'transfer_data'`
    );

    // 2. Must use the 0.20 multiplier (20% split)
    assertStringIncludes(
      src,
      "* 0.20",
      `${fn.name}: missing '* 0.20' multiplier for 20% split`
    );

    // 3. Must use STRIPE_CONNECTED_ACCOUNT_ID as destination
    assertStringIncludes(
      src,
      "STRIPE_CONNECTED_ACCOUNT_ID",
      `${fn.name}: missing 'STRIPE_CONNECTED_ACCOUNT_ID' reference`
    );

    // 4. Must use connectedAccountId as destination value
    assertStringIncludes(
      src,
      "destination: connectedAccountId",
      `${fn.name}: missing 'destination: connectedAccountId'`
    );

    // 5. transfer_data MUST be nested inside payment_intent_data (not top-level)
    //    Check that "payment_intent_data" appears AND that "transfer_data" only
    //    shows up after "payment_intent_data" (i.e. nested inside it).
    assertStringIncludes(
      src,
      "payment_intent_data",
      `${fn.name}: missing 'payment_intent_data' wrapper — transfer_data must be nested`
    );

    // 6. Ensure transfer_data is NOT at the Stripe session top level.
    //    Top-level would look like: checkout.sessions.create({ ... transfer_data ... })
    //    without being inside payment_intent_data. We verify by checking that every
    //    occurrence of "transfer_data" is preceded by "payment_intent_data" within
    //    the same block (within ~200 chars before it).
    const transferMatches = [...src.matchAll(/transfer_data/g)];
    for (const m of transferMatches) {
      const idx = m.index!;
      const preceding = src.substring(Math.max(0, idx - 300), idx);
      const hasWrapper = preceding.includes("payment_intent_data");
      assertEquals(
        hasWrapper,
        true,
        `${fn.name}: 'transfer_data' found WITHOUT preceding 'payment_intent_data' — it may be at the top level`
      );
    }

    console.log(`✅ ${fn.name} — split payment correctly configured`);
  });
}
