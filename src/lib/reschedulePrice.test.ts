import { describe, expect, it } from "vitest";
import { describeDelta, priceDecisionOptions, validatePriceDecision } from "./reschedulePrice";

const open = { balance_amount: 277, balance_paid_at: null, balance_link_expires_at: null };
const now = new Date("2026-11-13T15:00:00Z");

describe("priceDecisionOptions", () => {
  it("offers balance adjustment + refund + waive for a cheaper reschedule", () => {
    const opts = priceDecisionOptions(-178, open, now);
    expect(opts.map((o) => o.decision)).toEqual(["apply_to_balance", "refunded_separately", "waived"]);
    expect(opts[0].disabledReason).toBeNull();
  });
  it("offers charge instead of refund when it costs more", () => {
    expect(priceDecisionOptions(100, open, now).map((o) => o.decision)).toEqual([
      "apply_to_balance",
      "charged_separately",
      "waived",
    ]);
  });
  it("blocks balance adjustment when paid, link live, or reduction too big", () => {
    expect(priceDecisionOptions(-10, { ...open, balance_paid_at: "2026-11-01" }, now)[0].disabledReason).toMatch(/already paid/);
    expect(
      priceDecisionOptions(-10, { ...open, balance_link_expires_at: "2026-11-14T00:00:00Z" }, now)[0].disabledReason,
    ).toMatch(/still live/);
    expect(priceDecisionOptions(-300, open, now)[0].disabledReason).toMatch(/larger than/);
    expect(priceDecisionOptions(-10, { ...open, balance_link_expires_at: "2026-11-01T00:00:00Z" }, now)[0].disabledReason).toBeNull();
  });
});

describe("validatePriceDecision", () => {
  it("requires references and reasons", () => {
    expect(validatePriceDecision({ decision: "", reference: "", note: "" })).toMatch(/Choose/);
    expect(validatePriceDecision({ decision: "charged_separately", reference: " ", note: "" })).toMatch(/invoice/);
    expect(validatePriceDecision({ decision: "refunded_separately", reference: "", note: "" })).toMatch(/refund/);
    expect(validatePriceDecision({ decision: "waived", reference: "", note: "" })).toMatch(/why/);
    expect(validatePriceDecision({ decision: "apply_to_balance", reference: "", note: "" })).toBeNull();
  });
  it("describes the difference", () => {
    expect(describeDelta(-476)).toBe("The new hours cost $476.00 less");
    expect(describeDelta(50)).toBe("The new hours cost $50.00 more");
  });
});
