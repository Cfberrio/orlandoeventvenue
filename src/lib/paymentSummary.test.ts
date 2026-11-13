import { describe, expect, it } from "vitest";
import { amountDue, formatMoney, paymentRows, totalCharged } from "./paymentSummary";

// OEV-9CMUGG: $1,151 contract, deposit 576 + fee 21.60, balance 575 + fee 21.56.
const cmugg = {
  deposit_amount: "576.00",
  balance_amount: "575.00",
  deposit_paid_at: "2026-10-28T15:00:00Z",
  balance_paid_at: "2026-10-29T15:00:00Z",
  deposit_fee: "21.60",
  balance_fee: "21.56",
  deposit_total_charged: "597.60",
  balance_total_charged: "596.56",
};

describe("paymentSummary", () => {
  it("shows what the guest actually paid, fees included (9CMUGG = $1,194.16)", () => {
    const rows = paymentRows(cmugg);
    expect(rows.map((r) => [r.label, r.base, r.fee, r.charged])).toEqual([
      ["Deposit", 576, 21.6, 597.6],
      ["Balance", 575, 21.56, 596.56],
    ]);
    expect(totalCharged(rows)).toBe(1194.16);
    expect(amountDue(rows)).toBe(0);
  });
  it("lists an unpaid balance as due, not charged", () => {
    const rows = paymentRows({ ...cmugg, balance_paid_at: null, balance_total_charged: null, balance_fee: null });
    expect(rows[1]).toMatchObject({ label: "Balance", paidAt: null, charged: 0 });
    expect(totalCharged(rows)).toBe(597.6);
    expect(amountDue(rows)).toBe(575);
  });
  it("adds paid add-ons with their fee", () => {
    const rows = paymentRows(cmugg, [{ total_amount: 396, total_charged: 409.86 }]);
    expect(rows[2]).toMatchObject({ label: "Add-on", base: 396, fee: 13.86, charged: 409.86 });
    expect(totalCharged(rows)).toBe(1604.02);
  });
  it("offline payments (no fee) charge the base", () => {
    const rows = paymentRows({ ...cmugg, balance_fee: 0, balance_total_charged: "575.00" });
    expect(rows[1]).toMatchObject({ fee: 0, charged: 575 });
  });
  it("formats money with cents", () => {
    expect(formatMoney(1852.5)).toBe("$1,852.50");
  });
});
