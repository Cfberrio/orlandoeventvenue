import { describe, expect, it } from "vitest";
import { avg, invoiceMoney, money, payrollTotals, payrollTotalsByStaff, pct, splitCategories } from "./reportMoney";
import { orlandoYmd } from "./orlandoDay";
import { revenueCategoryLabel, revenueItemTypeLabel, staffRoleLabel } from "./statusLabels";

describe("money / pct / avg (R2-7)", () => {
  it("never prints more than 2 decimals", () => {
    expect(money(603.056)).toBe("$603.06");
    expect(money(5427.5)).toBe("$5,427.50");
    expect(money(-225.05)).toBe("-$225.05");
    expect(money(null)).toBe("$0.00");
    expect(money("12")).toBe("$12.00");
    expect(money(-0.001)).toBe("$0.00");
  });

  it("averages and shares are safe on empty input", () => {
    expect(avg(5427.5, 9)).toBe(603.06);
    expect(avg(10, 0)).toBe(0);
    expect(pct(1, 0)).toBe("—");
    expect(pct(25, 100)).toBe("25.0%");
  });
});

describe("invoiceMoney (R2-10)", () => {
  it("splits a card-paid invoice into net + fee", () => {
    expect(invoiceMoney({ amount: 1237.6, processing_fee: 46.41, total_charged: 1284.01 })).toEqual({
      net: 1237.6,
      fee: 46.41,
      gross: 1284.01,
    });
  });

  it("an offline-paid invoice carries no card fee even if one was pre-filled", () => {
    expect(
      invoiceMoney({ amount: 1500, processing_fee: 56.25, total_charged: 1556.25, paid_offline_method: "zelle" }),
    ).toEqual({ net: 1500, fee: 0, gross: 1500 });
  });
});

describe("splitCategories (R2-8)", () => {
  const rows = [
    { category: "baseline", item_type: "hourly", total_amount: 4000, item_count: 5 },
    { category: "cleaning_base", item_type: "regular", total_amount: 600, item_count: 5 },
    { category: "discount", item_type: "PLAN50", total_amount: -225.05, item_count: 2 },
    { category: "invoice", item_type: "recurring", total_amount: 1237.6, item_count: 2 },
    { category: "card_fee", item_type: "deposit", total_amount: 106.54, item_count: 4 },
    { category: "card_fee", item_type: "invoice", total_amount: 46.41, item_count: 2 },
  ];

  it("keeps discounts and card fees out of the pie", () => {
    const s = splitCategories(rows);
    expect(s.revenue.map((r) => r.category)).toEqual(["baseline", "invoice", "cleaning_base"]);
    expect(s.deductions).toEqual([{ category: "discount", amount: -225.05 }]);
    expect(s.cardFees).toBe(152.95);
  });

  it("gross minus deductions is net, and positive shares add to 100%", () => {
    const s = splitCategories(rows);
    expect(s.gross).toBe(5837.6);
    expect(s.net).toBe(5612.55);
    const shares = s.revenue.reduce((sum, r) => sum + (r.amount / s.gross) * 100, 0);
    expect(Math.round(shares)).toBe(100);
  });
});

describe("payrollTotals (R2-17 / R2-19)", () => {
  const lines = [
    { staff_id: "a", amount: 100, paid_status: "paid", not_payable_reason: null },
    { staff_id: "a", amount: 80, paid_status: "pending", not_payable_reason: null },
    { staff_id: "a", amount: 70, paid_status: "pending", not_payable_reason: "booking_cancelled" },
    { staff_id: "b", amount: 80, paid_status: "pending", not_payable_reason: "not_accepted" },
  ];

  it("not-payable lines are kept apart from owed and pending", () => {
    expect(payrollTotals(lines)).toEqual({ owed: 180, paid: 100, pending: 80, notPayable: 150, notPayableCount: 2 });
  });

  it("groups by staff id, not by name", () => {
    const by = payrollTotalsByStaff(lines);
    expect(by.get("a")).toEqual({ owed: 180, paid: 100, pending: 80, notPayable: 70, notPayableCount: 1 });
    expect(by.get("b")?.owed).toBe(0);
    expect(by.get("b")?.notPayable).toBe(80);
  });
});

describe("labels and Orlando day (R2-8 / R2-9)", () => {
  it("prints human labels for revenue codes", () => {
    expect(revenueCategoryLabel("cleaning_base")).toBe("Cleaning");
    expect(revenueItemTypeLabel("cleaning_base", "touch_up")).toBe("Touch-up");
    expect(revenueItemTypeLabel("addon", "misc")).toBe("Optional Services");
    expect(revenueItemTypeLabel("discount", "plan50")).toBe("Coupon PLAN50");
    expect(revenueItemTypeLabel("discount", "manual")).toBe("Manual Discount");
    expect(staffRoleLabel("cleaner")).toBe("Cleaner");
  });

  it("an 9 pm ET payment stays on its Orlando day", () => {
    expect(orlandoYmd("2026-11-16T02:10:00Z")).toBe("2026-11-15");
    expect(orlandoYmd("2026-11-01T01:30:00Z")).toBe("2026-10-31");
  });
});
