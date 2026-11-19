import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// ClickUp 1dfqjx6vh17. Behaviour is proven against production by
// supabase/tests/readiness_gate_scenarios.sql (T7, T9, T10, T12, T16, T17);
// these checks keep the migration from silently regressing.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const mig = read("supabase/migrations/20261119120000_readiness_every_origin_payroll_acceptance.sql");

describe("readiness rule applies to every origin", () => {
  it("no external exemption is left in the rule", () => {
    const rule = mig.slice(mig.indexOf("FUNCTION public.evaluate_booking_readiness"), mig.indexOf("FUNCTION public.recompute_booking_readiness"));
    expect(rule).not.toMatch(/= 'external'/);
    expect(rule).toMatch(/'staff_exempt', false/);
  });

  it("the DB promotes when the rule holds and demotes when it stops holding", () => {
    expect(mig).toMatch(/lifecycle_status = 'pre_event_ready' AND NOT \(v->>'ready'\)::boolean THEN\s+v_to := 'confirmed'/);
    expect(mig).toMatch(/lifecycle_status = 'confirmed' AND b\.status = 'confirmed'::booking_status\s+AND \(v->>'ready'\)::boolean THEN\s+v_to := 'pre_event_ready'/);
  });

  it("promotion goes through the lifecycle writer and restores the flag", () => {
    expect(mig).toMatch(/v_prev_writer := COALESCE\(current_setting\('oev\.lifecycle_writer', true\), ''\);\s+PERFORM set_config\('oev\.lifecycle_writer', 'on', true\);/);
    expect(mig).toMatch(/PERFORM set_config\('oev\.lifecycle_writer', v_prev_writer, true\);/);
  });

  it("externals are created confirmed with the checklist done, not pre_event_ready", () => {
    expect(mig).toMatch(/UPDATE public\.bookings SET pre_event_ready = 'true' WHERE id = v_id;\$new\$/);
    expect(mig).toMatch(/external block not found/);
  });
});

describe("payroll only for staff who accepted", () => {
  it("blocks marking paid and skips base pay for unaccepted staff", () => {
    expect(mig).toMatch(/BEFORE INSERT OR UPDATE OF paid_status ON public\.staff_payroll_items/);
    expect(mig).toMatch(/Cannot mark paid:/);
    expect(mig).toMatch(/TG_OP = 'INSERT' AND NEW\.pay_category NOT IN \('bonus', 'deduction'\) THEN\s+RETURN NULL;/);
  });

  it("standalone jobs and bar vendors are not gated", () => {
    expect(mig).toMatch(/AND a\.booking_id IS NOT NULL\s+AND COALESCE\(a\.assignment_type, ''\) <> 'bar_service'\s+FOR SHARE OF a;/);
  });

  it("any late acceptance of completed work rebuilds its pay line, without blocking the acceptance", () => {
    const fu = read("supabase/migrations/20261119130000_rebuild_pay_on_late_acceptance.sql");
    expect(fu).toMatch(/AFTER UPDATE OF response_status ON public\.booking_staff_assignments/);
    expect(fu).toMatch(/NEW\.status = 'completed'[\s\S]*PERFORM public\.populate_staff_payroll_items\(NEW\.id, false\);\s+EXCEPTION WHEN OTHERS THEN/);
    expect(fu).toMatch(/'payroll_rebuild_failed'/);
  });

  it("the backfill does not walk past events through the lifecycle", () => {
    expect(mig).not.toMatch(/stuck_past_event_backfill/);
  });

  it("only voids unpaid lines of events that have not ended", () => {
    expect(mig).toMatch(/COALESCE\(p\.paid_status, 'pending'\) <> 'paid'[\s\S]*_booking_event_end_at\(a\.booking_id\) > now\(\)/);
  });
});

describe("office can record a response given outside the portal", () => {
  it("admin-only, audited, never on a cancelled assignment", () => {
    expect(mig).toMatch(/FUNCTION public\.admin_record_staff_response[\s\S]*_assert_admin_or_service\(\)/);
    expect(mig).toMatch(/'recorded_by_office', true/);
    expect(mig).toMatch(/this assignment was cancelled/);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\.admin_record_staff_response\(uuid, text, text\) FROM PUBLIC, anon;/);
  });

  it("the admin booking page offers it", () => {
    const page = read("src/pages/admin/BookingDetail.tsx");
    expect(page).toMatch(/rpc\("admin_record_staff_response"/);
  });
});

describe("staff email matches the real rule", () => {
  it("no longer promises a 24-hour auto-reject", () => {
    const fn = read("supabase/functions/send-staff-assignment/index.ts");
    expect(fn).not.toMatch(/automatically rejected/);
  });
});
