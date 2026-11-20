import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ClickUp 86e40ach2, second-pass audit R2-1..R2-20. Behaviour was proven
// against production with a rolled-back dry-run (Aug..Nov gross + cancelled
// without decision = Stripe checkout.session.completed to the cent); these
// checks keep the migration and the two edge functions from regressing.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const mig = read("supabase/migrations/20261119140000_reports_second_pass.sql");
const section = (from: string, to: string) => mig.slice(mig.indexOf(from), mig.indexOf(to, mig.indexOf(from) + from.length));

describe("revenue ledger (R2-1, R2-2, R2-3, R2-5, R2-11)", () => {
  const ledger = section("FUNCTION public._revenue_ledger_unchecked", "FUNCTION public._revenue_rollup_unchecked");

  it("one cancellation rule: status OR lifecycle_status", () => {
    expect(ledger).toMatch(
      /\(b\.status::text IN \('cancelled', 'declined'\) OR COALESCE\(b\.lifecycle_status, ''\) = 'cancelled'\) AS is_cancelled/,
    );
  });

  it("add-on lines count for every origin, deposit/balance lines for website only", () => {
    expect(ledger).toMatch(/AND \(bk\.booking_origin = 'website' OR bri\.payment_split = 'addon'\)/);
  });

  it("card fees come from deposit_fee / balance_fee / add-on and invoice processing_fee, only once paid", () => {
    expect(ledger).toMatch(/bk\.deposit_paid_at IS NOT NULL AND COALESCE\(bk\.deposit_fee, 0\) <> 0/);
    expect(ledger).toMatch(/bk\.balance_paid_at IS NOT NULL AND COALESCE\(bk\.balance_fee, 0\) <> 0/);
    expect(ledger).toMatch(/i\.paid_at IS NOT NULL AND COALESCE\(i\.processing_fee, 0\) <> 0/);
    expect(ledger).toMatch(/inv\.paid_offline_method IS NULL AND COALESCE\(inv\.processing_fee, 0\) <> 0/);
  });

  it("paid invoices enter net (amount), never voided ones", () => {
    expect(ledger).toMatch(/'invoice', round\(inv\.amount, 2\)/);
    expect(ledger).toMatch(/inv\.payment_status = 'paid' AND inv\.paid_at IS NOT NULL AND inv\.voided_at IS NULL/);
  });

  it("cancelled money: kept only with a recorded refund decision, otherwise apart", () => {
    expect(ledger).toMatch(/WHERE r\.kind = 'refund' AND r\.status = 'resolved'/);
    expect(ledger).toMatch(/THEN 'cancelled_kept' ELSE 'cancelled_unrecorded' END/);
    expect(ledger).toMatch(/-r\.refund_amount/);
  });

  it("externals are their own source, from external bookings only", () => {
    expect(ledger).toMatch(/'external', 'deposit', 'deposit', round\(bk\.deposit_amount, 2\)/);
    expect(ledger).toMatch(/NOT bk\.is_cancelled AND bk\.booking_origin = 'external'/);
  });

  it("every day is an Orlando day", () => {
    const tz = ledger.match(/AT TIME ZONE 'America\/New_York'/g) ?? [];
    expect(tz.length).toBeGreaterThanOrEqual(11);
  });
});

describe("collected totals (R2-1, R2-6, R2-7)", () => {
  const rollup = section("FUNCTION public._revenue_rollup_unchecked", "DROP FUNCTION IF EXISTS public.get_revenue_summary(");

  it("Collected excludes externals and cancelled-without-decision; gross adds card fees", () => {
    expect(rollup).toMatch(/FILTER \(WHERE l\.source IN \('booking', 'invoice', 'cancelled_kept'\)\), 0\),\n\s+COALESCE\(SUM\(l\.amount\) FILTER \(WHERE l\.source = 'card_fee'\), 0\),\n\s+COALESCE\(SUM\(l\.amount\) FILTER \(WHERE l\.source IN \('booking', 'invoice', 'cancelled_kept', 'card_fee'\)\), 0\)/);
  });

  it("booking count is distinct over the whole range", () => {
    expect(rollup).toMatch(/COUNT\(DISTINCT l\.booking_id\) FILTER \(WHERE l\.source IN \('booking', 'card_fee', 'cancelled_kept'\)\)/);
    expect(mig).toMatch(/LEFT JOIN public\._revenue_rollup_unchecked\(p_start_date, p_end_date, 'all'\) r ON true/);
  });

  it("monthly carries a discount column", () => {
    const monthly = section("CREATE FUNCTION public.get_monthly_revenue_unchecked", "CREATE FUNCTION public.get_monthly_revenue(");
    expect(monthly).toMatch(/r\.other_revenue, r\.discount_amount,/);
  });
});

describe("segment and generated (R2-4, R2-15)", () => {
  it("segment lists every origin and whitelists the column", () => {
    const seg = section("CREATE FUNCTION public.get_revenue_by_segment_unchecked", "CREATE FUNCTION public.get_revenue_by_segment(");
    expect(seg).not.toMatch(/booking_origin = ''website''/);
    expect(seg).not.toMatch(/format\(/);
    expect(seg).toMatch(/p_segment_by NOT IN \('booking_origin', 'event_type', 'booking_type'\)/);
  });

  it("Generated requires a paid deposit and excludes lifecycle cancels", () => {
    const gen = section("FUNCTION public.get_daily_generated_revenue_unchecked", "FUNCTION public._payroll_not_payable_reason");
    expect(gen).toMatch(/AND b\.deposit_paid_at IS NOT NULL/);
    expect(gen).toMatch(/AND COALESCE\(b\.lifecycle_status, ''\) <> 'cancelled'/);
  });
});

describe("payroll (R2-17, R2-18, R2-19)", () => {
  it("not-payable lines are flagged and kept out of staff/role totals", () => {
    const reason = section("FUNCTION public._payroll_not_payable_reason", "DROP FUNCTION IF EXISTS public.get_payroll_line_items_export(");
    expect(reason).toMatch(/THEN 'booking_cancelled'/);
    expect(reason).toMatch(/THEN 'not_accepted'/);
    expect(reason).toMatch(/WHEN COALESCE\(p_paid_status, 'pending'\) = 'paid' THEN NULL/);
    const byStaff = section("FUNCTION public.get_payroll_by_staff_unchecked", "FUNCTION public.get_payroll_by_role_unchecked");
    expect(byStaff).toMatch(/FILTER \(WHERE public\._payroll_not_payable_reason\(spi\.paid_status, bsa\.id\) IS NULL\)/);
    expect(mig).toMatch(/sm\.id AS staff_id,\n\s+public\._payroll_not_payable_reason\(spi\.paid_status, bsa\.id\) AS not_payable_reason/);
  });

  it("a line of a cancelled booking cannot be marked paid", () => {
    const trg = section("FUNCTION public.trg_payroll_requires_acceptance", "FUNCTION public._void_unpaid_payroll");
    expect(trg).toMatch(/AND COALESCE\(v_cancelled, false\) THEN\s+RAISE EXCEPTION 'Cannot mark paid: booking%is cancelled/);
    expect(trg).toMatch(/Cannot mark paid: % has not accepted this assignment/);
    expect(trg).toMatch(/TG_OP = 'INSERT' AND NEW\.pay_category NOT IN \('bonus', 'deduction'\) THEN\s+RETURN NULL;/);
  });

  it("voiding an assignment voids its unpaid bonus/deduction lines too", () => {
    const voidFn = section("FUNCTION public._void_unpaid_payroll", "REVOKE ALL ON FUNCTION public._revenue_ledger_unchecked");
    expect(voidFn).not.toMatch(/NOT IN \('bonus', 'deduction'\)/);
    expect(voidFn).toMatch(/COALESCE\(p\.paid_status, 'pending'\) <> 'paid'/);
  });
});

describe("grants: anon never gains execute", () => {
  it("helpers and unchecked functions are service_role only", () => {
    for (const fn of [
      "_revenue_ledger_unchecked(date, date)",
      "_revenue_rollup_unchecked(date, date, text)",
      "get_revenue_summary_unchecked(date, date)",
      "get_daily_revenue_unchecked(date, date)",
      "get_monthly_revenue_unchecked(date, date)",
      "get_revenue_by_segment_unchecked(date, date, text)",
      "get_revenue_line_items_export_unchecked(date, date)",
      "_payroll_not_payable_reason(text, uuid)",
      "get_payroll_line_items_export_unchecked(date, date)",
    ]) {
      const esc = fn.replace(/[().]/g, (c) => `\\${c}`);
      expect(mig).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${esc} FROM PUBLIC, anon, authenticated;`));
      expect(mig).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${esc} TO service_role;`));
    }
  });

  it("recreated wrappers check admin and grant authenticated, never anon", () => {
    for (const fn of [
      "get_revenue_summary",
      "get_daily_revenue",
      "get_monthly_revenue",
      "get_revenue_by_segment",
      "get_revenue_line_items_export",
      "get_payroll_line_items_export",
    ]) {
      const body = section(`CREATE FUNCTION public.${fn}(`, "$function$;");
      expect(body).toMatch(/PERFORM public\._assert_admin_or_service\(\);/);
      expect(mig).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
      expect(mig).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO authenticated, service_role;`));
    }
    expect(mig).not.toMatch(/TO anon/);
  });

  it("does not touch the revenue writer", () => {
    expect(mig).not.toMatch(/FUNCTION public\.populate_booking_revenue_items/);
  });
});

describe("edge functions (R2-10, R2-12)", () => {
  it("manage-invoice mark_paid clears the card fee", () => {
    const fn = read("supabase/functions/manage-invoice/index.ts");
    const markPaid = fn.slice(fn.indexOf('if (action === "mark_paid")'));
    expect(markPaid).toMatch(/processing_fee: 0,\s+total_charged: row\.amount,/);
  });

  it("stripe-webhook records a failed deposit/balance revenue write", () => {
    const fn = read("supabase/functions/stripe-webhook/index.ts");
    const hits = fn.match(/event_type: "revenue_write_failed"/g) ?? [];
    expect(hits.length).toBe(2);
    expect(fn).toMatch(/payment_type: "balance",\s+stripe_event_id: event\.id/);
    expect(fn).toMatch(/payment_type: "deposit",\s+stripe_event_id: event\.id/);
  });
});
