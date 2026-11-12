import { defineConfig } from "vitest/config";

// Dedicated config for edge-function tests that are plain Node/vitest
// (source-analysis + pure-math). Deno-only tests are not included here.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "supabase/functions/_tests/split-payment.test.ts",
      "supabase/functions/_tests/invoice-fee-integrity.test.ts",
      "supabase/functions/_tests/meta-core.test.ts",
      "supabase/functions/_tests/reschedule-plan.test.ts",
      "supabase/functions/_tests/internal-auth.test.ts",
      "supabase/functions/_tests/lead-silence.test.ts",
      "supabase/functions/_tests/booking-pricing.test.ts",
      "supabase/functions/_tests/billing-integrity.test.ts",
      "supabase/functions/_tests/readiness-lifecycle.test.ts",
      "supabase/functions/_tests/phase1a-security.test.ts",
    ],
  },
});
