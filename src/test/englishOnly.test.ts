import { describe, it, expect } from "vitest";

// The guard lives in scripts/ so it can also run standalone in a pre-deploy step.
import { findSpanish } from "../../scripts/check-english-only.mjs";

describe("English-only copy", () => {
  it("has no Spanish left in src/ or supabase/functions/", () => {
    const findings = findSpanish() as { file: string; line: number; hits: string[]; text: string }[];
    const report = findings.map((f) => `${f.file}:${f.line} [${f.hits.join(", ")}] ${f.text}`);
    expect(report).toEqual([]);
  });
});
