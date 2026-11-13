import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — M-1 reschedule: package window, price review (D8), staff review.
const read = (p: string) => readFileSync(p, "utf-8");
const SQL = read("supabase/migrations/20261113160000_phase1b_reschedule.sql");
const EDGE = read("supabase/functions/reschedule-booking/index.ts");
const STAFF_MAIL = read("supabase/functions/send-staff-assignment/index.ts");
const DETAIL = read("src/pages/admin/BookingDetail.tsx");

describe("reschedule_booking", () => {
  it("refuses events that already happened or are cancelled", () => {
    expect(SQL).toMatch(/lifecycle_status IN \('post_event', 'closed_review_complete'\)/);
    expect(SQL).toMatch(/v_event_end := public\._booking_event_end_at\(p_booking_id\);/);
    expect(SQL).toMatch(/'error', 'event_already_happened'/);
    expect(SQL).toMatch(/v_booking\.status = 'cancelled' OR v_booking\.lifecycle_status = 'cancelled'/);
  });
  it("moves the package window with the event (time typed, never text)", () => {
    expect(SQL).toMatch(/v_new_pkg_start time;/);
    expect(SQL).toMatch(/v_new_pkg_start := greatest\(v_booking\.package_start_time, v_target_start::time\);/);
    expect(SQL).toMatch(/package_start_time = v_new_pkg_start,/);
    expect(SQL).toMatch(/'package_window_reset_to_event'/);
  });
  it("prices the change at the sold rates, against the settled window, before the row changes", () => {
    const preview = SQL.indexOf("v_price := public._reschedule_price_preview(p_booking_id,");
    const update = SQL.indexOf("UPDATE public.bookings\n  SET\n    event_date = p_new_date,");
    expect(preview).toBeGreaterThan(0);
    expect(preview).toBeLessThan(update);
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_price_basis/);
    expect(SQL).toMatch(/IF FOUND THEN\s+RETURN v_basis;/);
    expect(SQL).toMatch(/v_old := public\._price_at_window\(v_b, v_basis, v_basis\.priced_start_time/);
    expect(SQL).toMatch(/round\(p_basis\.hourly_rate \* v_hours, 2\)/);
  });
  it("every decision settles the window; no difference also settles it", () => {
    expect(SQL).toMatch(/PERFORM public\._settle_price_window\(v_b\.id, v_review\.details->'new_window'\);/);
    expect(SQL).toMatch(/PERFORM public\._settle_price_window\(p_booking_id, v_price->'new_window'\);/);
  });
  it("opens one price review (superseding older open ones) and a staff review, never changing money", () => {
    expect(SQL).toMatch(/kind = 'reschedule_price' AND status = 'open';\s+INSERT INTO public\.booking_money_reviews/);
    expect(SQL).toMatch(/'staff_hours'/);
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.reschedule_booking"), SQL.indexOf("CREATE OR REPLACE FUNCTION public.admin_resolve_reschedule_price"));
    expect(fn).not.toMatch(/total_amount\s*=/);
    expect(fn).not.toMatch(/balance_amount\s*=/);
    expect(fn).not.toMatch(/UPDATE public\.booking_staff_assignments/);
  });
  it("stays service-role only", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.reschedule_booking\(uuid, date, text, text, text, uuid\) FROM PUBLIC, anon, authenticated;/);
  });
});

describe("admin_resolve_reschedule_price (D8)", () => {
  it("is admin-only, locks booking then review, and is one-shot", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.admin_resolve_reschedule_price"));
    expect(fn.indexOf("PERFORM public._assert_admin_or_service();")).toBeLessThan(fn.indexOf("FOR UPDATE"));
    expect(fn).toMatch(/FROM public\.bookings WHERE id = v_review\.booking_id FOR UPDATE;\s+SELECT \* INTO v_review FROM public\.booking_money_reviews WHERE id = p_review_id FOR UPDATE;/);
    expect(fn).toMatch(/this price review is already %/);
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.admin_resolve_reschedule_price\(uuid, text, text, text\) FROM PUBLIC, anon;/);
  });
  it("adjusts the balance only when unpaid, no live link, no drift and never below zero", () => {
    expect(SQL).toMatch(/the booking total changed since this review/);
    expect(SQL).toMatch(/total_amount = COALESCE\(total_amount, 0\) \+ v_delta,/);
    expect(SQL).toMatch(/'create_balance_payment_link', v_b\.id,/);
    expect(SQL).toMatch(/the balance is already paid/);
    expect(SQL).toMatch(/a balance payment link for the old amount is live/);
    expect(SQL).toMatch(/IF v_new_balance < 0 THEN/);
    expect(SQL).toMatch(/balance_payment_url = NULL,/);
    expect(SQL).toMatch(/PERFORM public\.populate_booking_revenue_items\(v_b\.id, false\);/);
  });
  it("requires a reference to charge/refund and a reason to waive", () => {
    expect(SQL).toMatch(/add the invoice number or payment reference/);
    expect(SQL).toMatch(/add the refund reference/);
    expect(SQL).toMatch(/say why the difference is waived/);
  });
});

describe("notices", () => {
  it("reschedule-booking emails staff still on the event when something changed", () => {
    expect(EDGE).toMatch(/if \(rpcResult\.changed\) \{\s+followUps\.staff_notice = await notifyStaffOfReschedule/);
    expect(EDGE).toMatch(/\.not\("status", "in", "\(cancelled,completed\)"\)/);
    expect(EDGE).toMatch(/if \(a\.response_status === "rejected"\) continue;/);
    expect(EDGE).toMatch(/kind: "rescheduled"/);
  });
  it("send-staff-assignment is no longer an open mail relay", () => {
    expect(STAFF_MAIL).toMatch(/authorizeCaller\(req, authClient, \["admin", "service"\]\)/);
    expect(STAFF_MAIL.indexOf("authorizeCaller(req")).toBeLessThan(STAFF_MAIL.indexOf("await req.json()"));
  });
  it("admin sees the review cards", () => {
    expect(DETAIL).toMatch(/<RescheduleReviewCards booking=\{booking\} \/>/);
  });
});

describe("pre-deposit guard (Codex review)", () => {
  it("blocks a length change on an unpaid website booking and apply_to_balance before the deposit", () => {
    expect(SQL).toMatch(/'error', 'unpaid_length_change'/);
    expect(SQL).toMatch(/the deposit is not paid yet; the balance cannot absorb a price change/);
  });
});

describe("price basis lifecycle (Codex review)", () => {
  it("never persists a basis while the deposit is unpaid", () => {
    expect(SQL).toMatch(/_ensure_price_basis\(p_booking_id uuid, p_persist boolean DEFAULT true\)/);
    expect(SQL).toMatch(/IF NOT p_persist THEN\s+RETURN v_basis;/);
    expect(SQL).toMatch(/NOT \(v_b\.booking_origin::text = 'website' AND v_b\.deposit_paid_at IS NULL AND v_b\.balance_paid_at IS NULL\)/);
  });
});
