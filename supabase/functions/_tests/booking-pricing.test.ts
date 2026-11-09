import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  allocateCents,
  checkCouponForBooking,
  computeBookingPrice,
  describeDiscount,
  invoiceLinesFromStored,
  priceMismatches,
  type CouponTerms,
  type PricingRates,
} from "../_shared/booking-pricing.ts";

// Live venue_pricing values on 2026-11-09.
const RATES: PricingRates = {
  hourly_rate: 139,
  daily_rate: 899,
  cleaning_fee: 199,
  package_basic: 89,
  package_led: 99,
  package_workshop: 149,
  setup_breakdown: 299,
  tablecloth_rental: 5,
  tablecloth_cleaning_fee: 25,
  deposit_percentage: 50,
  processing_fee: 3.75,
};

const coupon = (over: Partial<CouponTerms>): CouponTerms => ({
  code: "TEST",
  discount_type: "fixed_amount",
  discount_value: 100,
  applies_to: "base_rental",
  applies_to_hourly: true,
  applies_to_daily: true,
  ...over,
});

// OEV-JZHY9Z: hourly 7-11 PM, basic package 4 h, no add-ons.
const MISHAUN = {
  bookingType: "hourly" as const,
  startTime: "19:00:00",
  endTime: "23:00:00",
  package: "basic" as const,
  packageStartTime: "19:00:00",
  packageEndTime: "23:00:00",
};

const sumBy = (lines: { [k: string]: unknown }[], k: string) =>
  Math.round(lines.reduce((s, l) => s + Math.round(Number(l[k]) * 100), 0)) / 100;

describe("frontend copy", () => {
  it("is byte-identical to the edge module", () => {
    expect(readFileSync("src/lib/bookingPricing.ts", "utf-8")).toBe(
      readFileSync("supabase/functions/_shared/booking-pricing.ts", "utf-8"),
    );
  });
});

describe("OEV-JZHY9Z incident", () => {
  it("reproduces the stored booking with the code as configured (100%)", () => {
    const p = computeBookingPrice(MISHAUN, RATES, coupon({ code: "MILITARYSERVICE", discount_type: "percentage", discount_value: 100 }));
    expect(p.grossSubtotal).toBe(1111);
    expect(p.discount?.amount).toBe(556);
    expect(p.total).toBe(555);
    expect(p.deposit).toBe(278);
    expect(p.balance).toBe(277);
    expect(p.depositFee).toBe(10.43);
    expect(p.depositTotal).toBe(288.43);
  });

  it("$100 off vs 100% off are clearly different", () => {
    const fixed = computeBookingPrice(MISHAUN, RATES, coupon({ discount_type: "fixed_amount", discount_value: 100 }));
    const pct = computeBookingPrice(MISHAUN, RATES, coupon({ discount_type: "percentage", discount_value: 100 }));
    expect(fixed.total).toBe(1011);
    expect(fixed.deposit).toBe(506);
    expect(fixed.balance).toBe(505);
    expect(fixed.depositFee).toBe(18.98);
    expect(pct.total).toBe(555);
    expect(fixed.total - pct.total).toBe(456);
  });

  it("invoice lines show the discount and sum exactly to the deposit", () => {
    const p = computeBookingPrice(MISHAUN, RATES, coupon({ code: "MILITARYSERVICE", discount_type: "percentage", discount_value: 100 }));
    expect(sumBy(p.lines, "gross")).toBe(1111);
    expect(sumBy(p.lines, "discount")).toBe(556);
    expect(sumBy(p.lines, "net")).toBe(555);
    expect(sumBy(p.lines, "deposit")).toBe(278);
    expect(sumBy(p.lines, "balance")).toBe(277);
    const rental = p.lines.find((l) => l.key === "base_rental")!;
    expect(rental.discount).toBe(556);
    expect(rental.net).toBe(0);
    expect(rental.deposit).toBe(0);
    expect(p.discount?.description).toBe("100% off base rental");
  });

  it("stored-column rebuild matches the fresh calculation", () => {
    const lines = invoiceLinesFromStored(
      {
        base_rental: 556, cleaning_fee: 199, package_cost: 356, optional_services: 0,
        discount_amount: 556, discount_code: "MILITARYSERVICE", total_amount: 555,
        deposit_amount: 278, balance_amount: 277, package: "basic", bar_subtotal: 0,
        bar_package_label: null, taxes_fees: 0,
      },
      "base_rental",
    );
    expect(sumBy(lines, "deposit")).toBe(278);
    expect(sumBy(lines, "discount")).toBe(556);
    expect(lines.find((l) => l.key === "base_rental")!.net).toBe(0);
  });
});

describe("discount targets and limits", () => {
  it("rental-only vs whole-total, percent", () => {
    const rental = computeBookingPrice(MISHAUN, RATES, coupon({ discount_type: "percentage", discount_value: 10 }));
    const total = computeBookingPrice(MISHAUN, RATES, coupon({ discount_type: "percentage", discount_value: 10, applies_to: "total" }));
    expect(rental.discount?.amount).toBe(55.6);
    expect(total.discount?.amount).toBe(111.1);
    expect(sumBy(total.lines, "discount")).toBe(111.1);
  });

  it("rental-only vs whole-total, fixed", () => {
    const rental = computeBookingPrice(MISHAUN, RATES, coupon({ discount_value: 700 }));
    const total = computeBookingPrice(MISHAUN, RATES, coupon({ discount_value: 700, applies_to: "total" }));
    expect(rental.discount?.amount).toBe(556); // capped at base rental
    expect(total.discount?.amount).toBe(700);
  });

  it("percent over 100 is treated as 100, never negative", () => {
    const p = computeBookingPrice(MISHAUN, RATES, coupon({ discount_type: "percentage", discount_value: 250, applies_to: "total" }));
    expect(p.total).toBe(0);
    expect(p.deposit).toBe(0);
    expect(p.balance).toBe(0);
  });

  it("zero discount = no discount line", () => {
    const p = computeBookingPrice(MISHAUN, RATES, null);
    expect(p.discount).toBeNull();
    expect(p.total).toBe(1111);
    expect(sumBy(p.lines, "discount")).toBe(0);
  });

  it("coupon not valid for the booking type is ignored", () => {
    const c = coupon({ applies_to_hourly: false });
    expect(checkCouponForBooking(c, "hourly")).toEqual({ ok: false, reason: "not_for_booking_type", allowed: "daily" });
    expect(computeBookingPrice(MISHAUN, RATES, c).discount).toBeNull();
  });

  it("describes discounts unambiguously", () => {
    expect(describeDiscount("fixed_amount", 100, "base_rental")).toBe("$100 off base rental");
    expect(describeDiscount("percentage", 15, "total")).toBe("15% off booking total");
    expect(describeDiscount("fixed_amount", 99.5, "total")).toBe("$99.50 off booking total");
  });
});

describe("rounding and add-ons", () => {
  it("odd totals: deposit rounds to whole dollars, columns still sum", () => {
    // 4.5 h rental + bar with cents
    const p = computeBookingPrice(
      { ...MISHAUN, endTime: "23:30", barSubtotal: 948.31, barLabel: "Essential Bar", setupBreakdown: true, tablecloths: true, tableclothQuantity: 7 },
      RATES,
      coupon({ discount_type: "percentage", discount_value: 15, applies_to: "total" }),
    );
    expect(Number.isInteger(p.deposit)).toBe(true);
    expect(Math.round((p.deposit + p.balance) * 100)).toBe(Math.round(p.total * 100));
    expect(sumBy(p.lines, "deposit")).toBe(p.deposit);
    expect(sumBy(p.lines, "balance")).toBe(p.balance);
    expect(sumBy(p.lines, "net")).toBe(p.total);
    expect(p.optionalServices).toBe(299 + 35 + 25);
  });

  it("daily booking ignores hours", () => {
    const p = computeBookingPrice({ bookingType: "daily" }, RATES, null);
    expect(p.baseRental).toBe(899);
    expect(p.total).toBe(1098);
    expect(p.deposit).toBe(549);
  });

  it("allocation sums exactly for awkward splits", () => {
    for (const total of [1, 7, 100, 27750, 99999]) {
      const parts = allocateCents(total, [333, 333, 334, 0]);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
      expect(parts[3]).toBe(0);
    }
  });
});

describe("tamper detection", () => {
  const stored = {
    base_rental: 556, cleaning_fee: 199, package_cost: 356, optional_services: 0,
    discount_amount: 100, discount_code: "SAVE", total_amount: 1011, deposit_amount: 506, balance_amount: 505,
  };
  const price = computeBookingPrice(MISHAUN, RATES, coupon({ code: "SAVE" }));

  it("accepts a stored booking that matches", () => {
    expect(priceMismatches(stored, price)).toEqual([]);
  });

  it("flags a deposit lowered in the browser", () => {
    expect(priceMismatches({ ...stored, deposit_amount: 1 }, price)).toContain("deposit_amount");
  });

  it("flags an invented discount", () => {
    expect(priceMismatches({ ...stored, discount_amount: 500, total_amount: 611 }, price)).toEqual(
      expect.arrayContaining(["discount_amount", "total_amount"]),
    );
  });

  it("flags a code that does not match", () => {
    expect(priceMismatches({ ...stored, discount_code: "OTHER" }, price)).toContain("discount_code");
  });
});
