import { describe, it, expect } from "vitest";
import {
  computeDiscountAmount,
  computeNetAmount,
  sumBillableItems,
} from "./invoiceDiscount";

describe("sumBillableItems", () => {
  it("sums rows that have both a name and an amount", () => {
    expect(
      sumBillableItems([
        { label: "Venue Rental", amount: "1500" },
        { label: "Production", amount: "800" },
      ])
    ).toBe(2300);
  });

  it("ignores an amount typed into a row with no name", () => {
    // That row is dropped from line_items, so billing it would charge the
    // customer for an item that appears nowhere on the invoice.
    expect(
      sumBillableItems([
        { label: "Venue Rental", amount: "1500" },
        { label: "   ", amount: "999" },
      ])
    ).toBe(1500);
  });

  it("ignores empty, zero and non-numeric rows", () => {
    expect(
      sumBillableItems([
        { label: "Venue Rental", amount: "1500" },
        { label: "Freebie", amount: "0" },
        { label: "Typo", amount: "abc" },
        { label: "", amount: "" },
      ])
    ).toBe(1500);
  });

  it("rounds the sum to cents", () => {
    expect(
      sumBillableItems([
        { label: "A", amount: "10.1" },
        { label: "B", amount: "20.2" },
      ])
    ).toBe(30.3);
  });
});

describe("computeDiscountAmount", () => {
  it("takes a percentage off the subtotal", () => {
    expect(computeDiscountAmount(2337.49, "percent", 50)).toBe(1168.74);
    expect(computeDiscountAmount(1000, "percent", 10)).toBe(100);
  });

  it("takes a fixed dollar amount off", () => {
    expect(computeDiscountAmount(1000, "fixed", 500)).toBe(500);
  });

  it("never discounts more than the subtotal", () => {
    expect(computeDiscountAmount(1000, "fixed", 5000)).toBe(1000);
    expect(computeDiscountAmount(1000, "percent", 150)).toBe(1000);
  });

  it("returns 0 when there is no usable discount", () => {
    expect(computeDiscountAmount(1000, null, 50)).toBe(0);
    expect(computeDiscountAmount(1000, "percent", null)).toBe(0);
    expect(computeDiscountAmount(1000, "percent", 0)).toBe(0);
    expect(computeDiscountAmount(1000, "fixed", -20)).toBe(0);
    expect(computeDiscountAmount(1000, "percent", NaN)).toBe(0);
    expect(computeDiscountAmount(0, "percent", 50)).toBe(0);
  });

  it("rounds to cents", () => {
    expect(computeDiscountAmount(100.05, "percent", 33.333)).toBe(33.35);
  });
});

describe("computeNetAmount", () => {
  it("splits an invoice in half without drift", () => {
    const subtotal = 2337.49;
    const half = computeNetAmount(subtotal, "percent", 50);
    expect(half).toBe(1168.75);
    // Two 50% halves must not overshoot the original invoice.
    expect(half + computeDiscountAmount(subtotal, "percent", 50)).toBe(subtotal);
  });

  it("returns the subtotal when there is no discount", () => {
    expect(computeNetAmount(1500, null, null)).toBe(1500);
  });
});
