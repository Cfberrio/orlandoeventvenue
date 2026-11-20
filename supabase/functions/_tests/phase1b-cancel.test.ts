import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { expireAddonSessionsWith } from "../_shared/addon-session-expiry";

// ClickUp 86e40ach2 — M-9 one cancel, whatever wrote it.
const read = (p: string) => readFileSync(p, "utf-8");
const SQL = read("supabase/migrations/20261113150000_phase1b_cancel.sql");
const CANCEL = read("supabase/functions/cancel-booking/index.ts");
const GHL_STATUS = read("supabase/functions/ghl-update-booking-status/index.ts");
const GHL_APPT = read("supabase/functions/ghl-appointment-webhook/index.ts");
const DETAIL = read("src/pages/admin/BookingDetail.tsx");

describe("cancel triggers", () => {
  it("normalizes a cancel on either column into both, only on the transition", () => {
    expect(SQL).toMatch(/BEFORE UPDATE OF status, lifecycle_status ON public\.bookings/);
    expect(SQL).toMatch(/OLD\.status IS DISTINCT FROM 'cancelled'::booking_status/);
    expect(SQL).toMatch(/OLD\.lifecycle_status IS DISTINCT FROM 'cancelled'/);
    expect(SQL).toMatch(/NEW\.cancelled_at := COALESCE\(NEW\.cancelled_at, now\(\)\)/);
  });
  it("runs the cascade once (not again when already fully cancelled)", () => {
    expect(SQL).toMatch(/IF OLD\.status = 'cancelled'::booking_status AND OLD\.lifecycle_status = 'cancelled' THEN\s+RETURN NEW;/);
  });
  it("cancels open staff, pending jobs, blocks and unpaid add-ons, but never completed work", () => {
    expect(SQL).toMatch(/SET status = 'cancelled', updated_at = now\(\)\s+WHERE booking_id = NEW\.id\s+AND status IN \('assigned', 'in_progress'\)/);
    expect(SQL).toMatch(/last_error = 'booking_cancelled'/);
    expect(SQL).toMatch(/DELETE FROM public\.availability_blocks WHERE booking_id = NEW\.id/);
    expect(SQL).toMatch(/SET payment_status = 'expired'\s+WHERE id IN \(\s+SELECT id FROM public\.booking_addon_invoices\s+WHERE booking_id = NEW\.id\s+AND payment_status = 'pending'\s+AND paid_at IS NULL/);
  });
  it("flags a refund review when money was collected", () => {
    expect(SQL).toMatch(/'refund_review_needed'/);
    expect(SQL).toMatch(/deposit_paid_at IS NOT NULL/);
    expect(SQL).toMatch(/balance_paid_at IS NOT NULL/);
    expect(SQL).toMatch(/i\.paid_at IS NOT NULL/);
  });
  it("does not touch staff/payroll on old cancelled bookings (Luis D5)", () => {
    const backfill = SQL.slice(SQL.indexOf("-- Backfill"));
    expect(backfill).not.toMatch(/booking_staff_assignments/);
    expect(backfill).not.toMatch(/staff_payroll_items/);
  });
});

describe("Codex review fixes", () => {
  it("cancelled is terminal unless an explicit reopen flag is set", () => {
    expect(SQL).toMatch(/current_setting\('oev\.reopen_cancelled', true\)/);
    expect(SQL).toMatch(/cannot be reopened here/);
  });
  it("a late cancel keeps earned pay of completed assignments", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.trg_void_payroll_on_booking_cancel()"));
    expect(fn.slice(0, 900)).toMatch(/AND status <> 'completed'/);
  });
  it("money landing after the cancel reopens the refund review", () => {
    expect(SQL).toMatch(/AFTER UPDATE OF deposit_paid_at, balance_paid_at ON public\.bookings/);
    expect(SQL).toMatch(/AFTER UPDATE OF paid_at ON public\.booking_addon_invoices/);
    expect(SQL).toMatch(/ON CONFLICT \(booking_id, kind\) WHERE status = 'open' DO NOTHING/);
  });
  it("reviews live in an RLS table only definer functions write", () => {
    expect(SQL).toMatch(/CREATE TABLE IF NOT EXISTS public\.booking_money_reviews/);
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.booking_money_reviews FROM authenticated/);
  });
  it("GHL appointment webhook fails closed and never un-cancels", () => {
    expect(GHL_APPT).toMatch(/if \(!webhookSecret \|\| !providedSecret \|\| !safeEqual\(providedSecret, webhookSecret\)\)/);
    // X2-15: an update on a cancelled booking is ignored, never applied.
    expect(GHL_APPT).toMatch(/return \{ action: "ignored", reason: "booking_cancelled" \}/);
  });
  it("cancel-booking reports Stripe cleanup failures", () => {
    expect(CANCEL).toMatch(/"cancel_cleanup_failed"/);
    expect(CANCEL).toMatch(/cleanup_warnings: cleanupWarnings/);
  });
});

describe("admin_record_refund_decision", () => {
  it("is admin/service only, locks the booking and is one decision per review", () => {
    const fn = SQL.slice(SQL.indexOf("CREATE OR REPLACE FUNCTION public.admin_record_refund_decision("));
    expect(fn.indexOf("PERFORM public._assert_admin_or_service();")).toBeLessThan(fn.indexOf("FOR UPDATE"));
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.admin_record_refund_decision\([^)]*\) FROM PUBLIC, anon;/);
    expect(SQL).toMatch(/a refund decision is already recorded/);
    expect(SQL).toMatch(/v_total := round\(\(v_collected->>'total'\)::numeric - v_decided_before, 2\)/);
  });
  it("caps at what was collected, requires a reference and a reason for kept money", () => {
    expect(SQL).toMatch(/refund cannot exceed the % collected/);
    expect(SQL).toMatch(/p_method <> 'cash' AND v_reference IS NULL/);
    expect(SQL).toMatch(/v_decision <> 'refunded_in_full' AND v_note IS NULL/);
  });
  it("payment status is derived from cumulative refunded/kept money, both ways", () => {
    expect(SQL).toMatch(/CREATE OR REPLACE FUNCTION public\._sync_cancelled_payment_status/);
    expect(SQL).toMatch(/v_kept <= 0\.009 AND abs\(v_total - v_refunded\) <= 0\.01/);
    expect(SQL).toMatch(/ELSIF v_b\.payment_status = 'refunded'::payment_status THEN/);
    expect(SQL).toMatch(/PERFORM public\._sync_cancelled_payment_status\(p_booking_id\);\s+INSERT INTO public\.booking_events/);
  });
  it("late payment serializes on the booking row; cascade skips invoices being paid", () => {
    expect(SQL).toMatch(/PERFORM 1 FROM public\.bookings WHERE id = p_booking_id FOR UPDATE;/);
    expect(SQL).toMatch(/FOR UPDATE SKIP LOCKED/);
  });
  it("only cancelled bookings take a decision", () => {
    expect(SQL).toMatch(/only a cancelled booking takes a refund decision/);
  });
});

describe("every cancel reaches cancel-booking", () => {
  it("cancel-booking closes add-on Stripe sessions before the already-cancelled early return", () => {
    const expiry = CANCEL.indexOf("await expireAddonSessions(supabase, booking_id)");
    const early = CANCEL.indexOf("if (wasAlreadyCancelled) {");
    expect(expiry).toBeGreaterThan(0);
    expect(expiry).toBeLessThan(early);
    expect(CANCEL).toMatch(/collected_total: collectedTotal/);
  });
  it("GHL status cancel and GHL appointment delete call cancel-booking", () => {
    expect(GHL_STATUS).toMatch(/applyStatus === "cancelled" \|\| applyLifecycle === "cancelled"/);
    expect(GHL_STATUS).toMatch(/functions\.invoke\("cancel-booking"/);
    expect(GHL_APPT).toMatch(/functions\.invoke\('cancel-booking'/);
    expect(GHL_APPT).toMatch(/\.neq\('status', 'cancelled'\)/);
  });
  it("the admin dropdown opens the cancel flow instead of writing the status", () => {
    expect(DETAIL).toMatch(/if \(newStatus === "cancelled"\) \{\s+setShowCancelDialog\(true\);\s+return;/);
    expect(DETAIL).toMatch(/<RefundReviewCard booking=\{booking\} \/>/);
  });
});

describe("expireAddonSessionsWith", () => {
  it("expires open sessions once, skips closed ones and reports failures", async () => {
    const expired: string[] = [];
    const api = {
      retrieve: async (id: string) => {
        if (id === "cs_boom") throw new Error("stripe down");
        return { status: id === "cs_open" ? "open" : "expired" };
      },
      expire: async (id: string) => {
        expired.push(id);
        return {};
      },
    };
    const r = await expireAddonSessionsWith(
      [
        { id: "a", stripe_session_id: "cs_open" },
        { id: "b", stripe_session_id: "cs_open" },
        { id: "c", stripe_session_id: "cs_done" },
        { id: "d", stripe_session_id: "cs_boom" },
        { id: "e", stripe_session_id: null },
      ],
      api,
    );
    expect(expired).toEqual(["cs_open"]);
    expect(r.checked).toBe(3);
    expect(r.already_closed).toEqual(["cs_done"]);
    expect(r.failed).toEqual([{ invoice_id: "d", session_id: "cs_boom", error: "stripe down" }]);
  });
  it("reports every session as failed when Stripe is not configured", async () => {
    const r = await expireAddonSessionsWith([{ id: "a", stripe_session_id: "cs_1" }], null);
    expect(r.failed[0].error).toBe("stripe_not_configured");
  });
});
