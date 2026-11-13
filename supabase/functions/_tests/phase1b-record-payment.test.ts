import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — M-7 / M-8 record payment outside Stripe.
const read = (p: string) => readFileSync(p, "utf-8");
const SQL = read("supabase/migrations/20261113140000_phase1b_record_payment.sql");
const DETAIL = read("src/pages/admin/BookingDetail.tsx");

describe("admin_record_payment", () => {
  it("is admin/service only and never callable by anon", () => {
    expect(SQL.indexOf("PERFORM public._assert_admin_or_service();")).toBeLessThan(SQL.indexOf("FOR UPDATE"));
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.admin_record_payment\([^)]*\) FROM PUBLIC, anon;/);
  });
  it("locks the booking and refuses cancelled or already-paid steps", () => {
    expect(SQL).toMatch(/FROM public\.bookings WHERE id = p_booking_id FOR UPDATE/);
    expect(SQL).toMatch(/booking is cancelled/);
    expect(SQL).toMatch(/deposit is already recorded as paid/);
    expect(SQL).toMatch(/balance is already recorded as paid/);
  });
  it("requires the exact amount owed", () => {
    expect(SQL).toMatch(/abs\(p_amount - v_expected\) > 0\.01/);
  });
  it("requires a reference for every method except cash, and no future date", () => {
    expect(SQL).toMatch(/p_method <> 'cash' AND v_reference IS NULL/);
    expect(SQL).toMatch(/payment date cannot be in the future/);
  });
  it("records fee 0, the event with who recorded it, cancels balance jobs and rebuilds revenue", () => {
    expect(SQL).toMatch(/deposit_fee = CASE WHEN p_kind IN \('deposit', 'full'\) THEN 0/);
    expect(SQL).toMatch(/'manual_payment_recorded'/);
    expect(SQL).toMatch(/'recorded_by', v_actor/);
    expect(SQL).toMatch(/last_error = 'payment_recorded_manually'/);
    expect(SQL).toMatch(/PERFORM public\.populate_booking_revenue_items\(p_booking_id, false\);/);
  });
});

describe("admin UI", () => {
  it("no longer writes payment status from the browser", () => {
    expect(DETAIL).not.toMatch(/payment_status: "deposit_paid"/);
    expect(DETAIL).not.toMatch(/handleManualDepositOverride/);
  });
  it("records through the RPC", () => {
    const dialog = read("src/components/admin/RecordPaymentDialog.tsx");
    expect(dialog).toMatch(/rpc\("admin_record_payment"/);
    expect(DETAIL).toMatch(/<RecordPaymentDialog/);
  });
});

describe("Codex review: no offline record while a Stripe link is live", () => {
  it("refuses balance/full while balance_link_expires_at is in the future, and fresh deposits", () => {
    expect(SQL).toMatch(/v_b\.balance_link_expires_at > now\(\)/);
    expect(SQL).toMatch(/p_kind IN \('deposit', 'full'\) AND v_b\.booking_origin::text = 'website'/);
    expect(SQL).toMatch(/OPEN_STRIPE_LINK/);
  });
  it("the override is explicit and audited", () => {
    expect(SQL).toMatch(/p_confirm_open_link boolean DEFAULT false/);
    expect(SQL).toMatch(/'confirmed_open_stripe_link', p_confirm_open_link/);
    const dialog = read("src/components/admin/RecordPaymentDialog.tsx");
    expect(dialog).toMatch(/p_confirm_open_link: confirmOpenLink/);
    expect(dialog).toMatch(/msg\.includes\("OPEN_STRIPE_LINK"\)/);
  });
});

describe("Codex final review", () => {
  it("drops the older 7-argument overload before creating the guarded one", () => {
    expect(SQL.indexOf("DROP FUNCTION IF EXISTS public.admin_record_payment(uuid, text, numeric, text, text, timestamptz, text);"))
      .toBeLessThan(SQL.indexOf("CREATE OR REPLACE FUNCTION public.admin_record_payment("));
  });
  it("a manual deposit schedules the balance like the Stripe webhook", () => {
    const dialog = read("src/components/admin/RecordPaymentDialog.tsx");
    expect(dialog).toMatch(/kind === "deposit"[\s\S]{0,300}functions\.invoke\("schedule-balance-payment"/);
  });
});

describe("Codex verification: scheduler 200-with-failure is caught", () => {
  it("checks persisted balance jobs or link after scheduling, not just the HTTP status", () => {
    const dialog = read("src/components/admin/RecordPaymentDialog.tsx");
    expect(dialog).toMatch(/async function balanceFollowUpExists/);
    expect(dialog).toMatch(/\.from\("scheduled_jobs"\)[\s\S]{0,200}\.eq\("status", "pending"\)/);
    expect(dialog).toMatch(/balance_payment_url/);
    expect(dialog).toMatch(/if \(!scheduled\)/);
  });
});
