import { describe, expect, it } from "vitest";
import { parseMoney, refundDecisionFor, toCollected, validateRefundDecision } from "./refundDecision";

const base = {
  amount: 484.51,
  collected: 484.51,
  method: "stripe" as const,
  reference: "re_123",
  note: "",
  refundedOn: "2026-11-13",
  today: "2026-11-13",
};

describe("refundDecisionFor", () => {
  it("classifies full, part and kept", () => {
    expect(refundDecisionFor(484.51, 484.51)).toBe("refunded_in_full");
    expect(refundDecisionFor(484.5, 484.51)).toBe("refunded_in_full");
    expect(refundDecisionFor(200, 484.51)).toBe("refunded_in_part");
    expect(refundDecisionFor(0, 484.51)).toBe("kept");
  });
});

describe("validateRefundDecision", () => {
  it("accepts a full Stripe refund without a note", () => {
    expect(validateRefundDecision(base)).toBeNull();
  });
  it("refuses more than collected", () => {
    expect(validateRefundDecision({ ...base, amount: 500 })).toMatch(/cannot be more/);
  });
  it("needs a reference except for cash", () => {
    expect(validateRefundDecision({ ...base, reference: " " })).toMatch(/reference/);
    expect(validateRefundDecision({ ...base, method: "cash", reference: "" })).toBeNull();
  });
  it("needs a method when money went back", () => {
    expect(validateRefundDecision({ ...base, method: "" })).toMatch(/how the money/);
  });
  it("needs a reason when money is kept", () => {
    expect(validateRefundDecision({ ...base, amount: 100 })).toMatch(/why/);
    expect(validateRefundDecision({ ...base, amount: 0, method: "", reference: "" })).toMatch(/why/);
    expect(validateRefundDecision({ ...base, amount: 0, method: "", reference: "", note: "late cancel" })).toBeNull();
  });
  it("refuses a future refund date", () => {
    expect(validateRefundDecision({ ...base, refundedOn: "2026-11-14" })).toMatch(/future/);
  });
  it("refuses a bad amount", () => {
    expect(validateRefundDecision({ ...base, amount: NaN })).toMatch(/amount/);
  });
});

describe("parseMoney / toCollected", () => {
  it("parses money input", () => {
    expect(parseMoney("$1,234.50")).toBe(1234.5);
    expect(parseMoney("12")).toBe(12);
    expect(parseMoney("12.345")).toBeNaN();
    expect(parseMoney("abc")).toBeNaN();
  });
  it("normalizes the RPC payload", () => {
    expect(toCollected({ deposit: "484.51", balance: 0, addons: null, total: 484.51 })).toEqual({
      deposit: 484.51,
      balance: 0,
      addons: 0,
      total: 484.51,
      decided: 0,
      undecided: 484.51,
    });
    expect(toCollected({ total: 534.51, decided: 484.51, undecided: 50 }).undecided).toBe(50);
    expect(toCollected(null).total).toBe(0);
  });
});
