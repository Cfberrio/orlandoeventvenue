import { defineConfig } from "vitest/config";

// Dedicated config for edge-function tests that are plain Node/vitest
// (source-analysis + pure-math). Deno-only tests are not included here.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "supabase/functions/_tests/split-payment.test.ts",
      "supabase/functions/_tests/invoice-fee-integrity.test.ts",
    ],
  },
});
