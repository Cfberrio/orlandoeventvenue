import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — M-10, M-11, M-12, M-16, M-19, M-20, M-22, M-32.
const read = (p: string) => readFileSync(p, "utf-8");
const SQL = read("supabase/migrations/20261113180000_phase1b_revenue.sql");
const WEBHOOK = read("supabase/functions/stripe-webhook/index.ts");
const ADDON = read("supabase/functions/create-addon-invoice/index.ts");
const ADMIN = read("src/hooks/useAdminData.ts");
const LIST = read("src/pages/admin/BookingsList.tsx");

describe("populate_booking_revenue_items", () => {
  const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.populate_booking_revenue_items"));
  it("M-10: no fixed $75 setup line on top of optional_services", () => {
    expect(fn).not.toMatch(/75\.00/);
    expect(fn).toMatch(/v_rest := v_opt - v_tablecloth;/);
  });
  it("M-11: dates each payment on its Orlando day", () => {
    expect(fn).toMatch(/AT TIME ZONE 'America\/New_York'\)::date/);
    expect(fn).not.toMatch(/created_at::date/);
  });
  it("deposit lines add up to deposit_amount (allocation + rounding remainder)", () => {
    expect(fn).toMatch(/COALESCE\(v_b\.deposit_amount, 0\) \/ v_total/);
    expect(fn).toMatch(/v_dep_parts\[v_max_idx\] := v_dep_parts\[v_max_idx\] \+ \(round\(v_total \* v_ratio, 2\) - v_dep_sum\)/);
    expect(fn).not.toMatch(/\* 0\.5/);
  });
  it("writes nothing for a booking with no money in", () => {
    expect(fn).toMatch(/IF v_b\.deposit_paid_at IS NULL AND v_b\.balance_paid_at IS NULL THEN\s+RETURN;/);
  });
});

describe("M-12 charged amounts from Stripe", () => {
  it("resets charged amount and fee from stripe_event_log, never below the base", () => {
    expect(SQL).toMatch(/metadata->>'amount_cents'/);
    expect(SQL).toMatch(/ev\.charged >= b\.deposit_amount - 0\.01/);
    expect(SQL).toMatch(/balance_fee = round\(ev\.charged - b\.balance_amount, 2\)/);
  });
});

describe("M-32 / M-16 add-on invoices", () => {
  it("create-addon-invoice stores the charged lines and refuses missing prices", () => {
    expect(ADDON).toMatch(/line_items: pricedLines,/);
    expect(ADDON).not.toMatch(/\?\? 100;/);
    expect(ADDON).not.toMatch(/\?\? 3\.5;/);
    expect(ADDON).toMatch(/Setup & breakdown has no active price/);
  });
  it("webhook writes add-on revenue from the stored lines, legacy without double count", () => {
    expect(WEBHOOK).toMatch(/if \(paidInvoice && bookingId && chargedLines\) \{/);
    expect(WEBHOOK).not.toMatch(/amount: 75\.00,/);
    expect(WEBHOOK).toMatch(/const miscAmount = inv\.setup_breakdown === true \? 0 : legacyRest;/);
    expect(WEBHOOK).toMatch(/if \(!chargedLines\) addonRevenueRows\.push\(\{/);
  });
});

describe("dashboard, list, analytics", () => {
  it("M-19: today / upcoming / weekly / pipeline exclude cancelled, pipeline counts only active upcoming", () => {
    expect(ADMIN.match(/\.not\("status", "in", "\(cancelled,declined\)"\)/g)?.length).toBeGreaterThanOrEqual(4);
    expect(ADMIN).toMatch(/return \{ counts, active \};/);
  });
  it("M-20: list total includes paid add-ons", () => {
    expect(LIST).toMatch(/paidAddonsByBooking\?\.\[booking\.id\]/);
  });
  it("M-22: attribution view drops cancelled bookings", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE VIEW public\.v_paid_booking_attribution WITH \(security_invoker = on\)/);
    expect(SQL).toMatch(/b\.status <> ALL \(ARRAY\[''cancelled''::booking_status/);
  });
});
