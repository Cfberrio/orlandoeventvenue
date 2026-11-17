import { describe, expect, it } from "vitest";
import { duplicateAddonIds } from "./addonInvoices";

describe("duplicate add-on invoices (E-9)", () => {
  it("marks older copies of the same booking + amount, keeps the newest", () => {
    const rows = [
      { id: "a", booking_id: "B", total_amount: 596, created_at: "2026-10-01T10:00:00Z" },
      { id: "b", booking_id: "B", total_amount: "596.00", created_at: "2026-10-03T10:00:00Z" },
      { id: "c", booking_id: "B", total_amount: 596, created_at: "2026-10-02T10:00:00Z" },
      { id: "d", booking_id: "B", total_amount: 120, created_at: "2026-10-02T10:00:00Z" },
      { id: "e", booking_id: "C", total_amount: 596, created_at: "2026-10-02T10:00:00Z" },
    ];
    expect([...duplicateAddonIds(rows)].sort()).toEqual(["a", "c"]);
  });
});
