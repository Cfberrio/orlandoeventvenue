import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — M-31 / E-13 recurring invoices never skip a period silently.
const read = (p: string) => readFileSync(p, "utf-8");
const SQL = read("supabase/migrations/20261113190000_phase1b_recurring_invoices.sql");
const FN = read("supabase/functions/process-recurring-invoices/index.ts");
const UI = read("src/pages/admin/Invoices.tsx");

describe("recurring invoices", () => {
  it("one live child per parent and period", () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_child_per_period_uidx\s+ON public\.invoices \(recurring_parent_id, recurring_period\)/);
    expect(FN).toMatch(/recurring_period: period,/);
    expect(FN).toMatch(/insertError\?\.code === "23505"/);
  });
  it("claims the child before sending, with a lease", () => {
    expect(FN).toMatch(/\.update\(\{ recurring_send_claimed_at: new Date\(\)\.toISOString\(\) \}\)/);
    expect(FN).toMatch(/recurring_send_claimed_at\.is\.null,recurring_send_claimed_at\.lt\./);
  });
  it("advances the schedule only after the invoice was issued", () => {
    const send = FN.indexOf('functions/v1/create-invoice');
    const advance = FN.indexOf('rpc("claim_recurring_invoice"');
    expect(send).toBeGreaterThan(0);
    expect(advance).toBeGreaterThan(send);
  });
  it("records failures on the parent and shows them in Invoices", () => {
    expect(FN).toMatch(/recurring_last_error: message\.slice\(0, 500\)/);
    expect(UI).toMatch(/Last send failed/);
  });
});
