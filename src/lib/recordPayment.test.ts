import { describe, expect, it } from "vitest";
import { expectedPaymentAmount, recordablePaymentKinds, validateRecordPayment } from "./recordPayment";

// ClickUp 86e40ach2 — M-7 record payment outside Stripe.
const unpaid = { deposit_amount: "277.5", balance_amount: 277.5, deposit_paid_at: null, balance_paid_at: null };
const depositPaid = { ...unpaid, deposit_paid_at: "2026-10-01T12:00:00Z" };
const fullyPaid = { ...depositPaid, balance_paid_at: "2026-11-01T12:00:00Z" };

describe("recordablePaymentKinds", () => {
  it("offers deposit or full before anything is paid", () => {
    expect(recordablePaymentKinds(unpaid)).toEqual(["deposit", "full"]);
  });
  it("offers only the balance once the deposit is paid", () => {
    expect(recordablePaymentKinds(depositPaid)).toEqual(["balance"]);
  });
  it("offers nothing when fully paid", () => {
    expect(recordablePaymentKinds(fullyPaid)).toEqual([]);
  });
});

describe("expectedPaymentAmount", () => {
  it("is the exact amount owed for the step", () => {
    expect(expectedPaymentAmount(unpaid, "deposit")).toBe(277.5);
    expect(expectedPaymentAmount(unpaid, "full")).toBe(555);
    expect(expectedPaymentAmount(depositPaid, "balance")).toBe(277.5);
  });
});

describe("validateRecordPayment", () => {
  const base = { kind: "balance" as const, method: "zelle" as const, reference: "ZL-123", paidOn: "2026-11-10", today: "2026-11-12" };
  it("accepts a complete Zelle payment", () => {
    expect(validateRecordPayment(base)).toBeNull();
  });
  it("requires a reference except for cash", () => {
    expect(validateRecordPayment({ ...base, reference: " " })).toMatch(/reference/);
    expect(validateRecordPayment({ ...base, method: "cash", reference: "" })).toBeNull();
  });
  it("rejects a future date", () => {
    expect(validateRecordPayment({ ...base, paidOn: "2026-11-13" })).toMatch(/future/);
  });
  it("requires kind and method", () => {
    expect(validateRecordPayment({ ...base, kind: "" })).toMatch(/what was paid/);
    expect(validateRecordPayment({ ...base, method: "" })).toMatch(/method/);
  });
});
