import { describe, expect, it } from "vitest";
import { payModeOf, validatePayOverride } from "./payOverride";

describe("pay override (E-6)", () => {
  it("requires a reason for override and void, and a valid amount for override", () => {
    expect(validatePayOverride({ mode: "computed", amount: "", reason: "" })).toBeNull();
    expect(validatePayOverride({ mode: "excluded", amount: "", reason: " " })).toMatch(/why/);
    expect(validatePayOverride({ mode: "override", amount: "", reason: "flat" })).toMatch(/amount/);
    expect(validatePayOverride({ mode: "override", amount: "20000", reason: "flat" })).toMatch(/10,000/);
    expect(validatePayOverride({ mode: "override", amount: "0", reason: "volunteer" })).toBeNull();
  });

  it("reads the stored mode", () => {
    expect(payModeOf({ pay_override_mode: "excluded" })).toBe("excluded");
    expect(payModeOf({ pay_override_mode: null })).toBe("computed");
    expect(payModeOf(null)).toBe("computed");
  });
});
