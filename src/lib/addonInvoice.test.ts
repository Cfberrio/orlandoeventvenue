import { describe, expect, it } from "vitest";
import { addonInvoiceItemLabels, paidAddonInvoices, paidAddonTotal } from "./addonInvoice";

// ClickUp 86e40ach2 — Phase 1B / M-30.
describe("addonInvoiceItemLabels", () => {
  it("labels a package with its hours, setup, tablecloths and bar", () => {
    expect(
      addonInvoiceItemLabels({
        package: "led",
        package_start_time: "12:00:00",
        package_end_time: "16:00:00",
        setup_breakdown: true,
        tablecloths: true,
        tablecloth_quantity: 6,
        bar_package: "house_beer_wine",
        bar_package_label: "House Beer & Wine",
        bar_guest_count: 40,
      })
    ).toEqual(["LED Package (4h)", "Setup & Breakdown", "Tablecloths (6)", "Bar: House Beer & Wine (40 guests)"]);
  });

  it("returns nothing for an empty services-only invoice", () => {
    expect(addonInvoiceItemLabels({ package: "none", bar_package: "none" })).toEqual([]);
  });
});

describe("paid add-on totals", () => {
  const invoices = [
    { payment_status: "paid", total_amount: "396" },
    { payment_status: "pending", total_amount: 396 },
    { payment_status: "expired", total_amount: 100 },
    { payment_status: "paid", total_amount: 75.5 },
  ];

  it("counts only paid invoices", () => {
    expect(paidAddonInvoices(invoices)).toHaveLength(2);
    expect(paidAddonTotal(invoices)).toBeCloseTo(471.5);
  });

  it("handles no data", () => {
    expect(paidAddonTotal(undefined)).toBe(0);
  });
});
