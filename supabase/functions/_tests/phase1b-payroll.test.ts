import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — Phase 1B payroll rules (M-2, M-3, M-4, M-5, M-33).
// The SQL was also dry-run in production inside a rolled-back transaction:
// 9CMUGG Production 2h → $100 (was $200 from 4h package), duplicate insert
// rejected, reject voids the unpaid line with a payroll_voided event.
const read = (p: string) => readFileSync(p, "utf-8");
const MIGRATION = read("supabase/migrations/20261113130000_phase1b_payroll_rules.sql");
const fnBlock = (name: string) => {
  const start = MIGRATION.indexOf(`FUNCTION public.${name}(`);
  return MIGRATION.slice(start, MIGRATION.indexOf("$function$;", start));
};

describe("M-3: completion only for accepted staff, after the event", () => {
  const body = fnBlock("auto_complete_assignments_on_in_progress");
  it("fires on post_event / closed_review_complete, not in_progress", () => {
    expect(body).toMatch(/NEW\.lifecycle_status IN \('post_event', 'closed_review_complete'\)/);
    expect(body).not.toMatch(/NEW\.lifecycle_status = 'in_progress'/);
  });
  it("skips cancelled bookings and non-accepted assignments", () => {
    expect(body).toMatch(/NEW\.status <> 'cancelled'::booking_status/);
    expect(body).toMatch(/response_status = 'accepted'/);
  });
});

describe("M-4: unpaid pay lines are voided on reject, cancel or booking cancel", () => {
  const voidFn = fnBlock("_void_unpaid_payroll");
  it("keeps paid lines and manual bonus/deduction lines", () => {
    expect(voidFn).toMatch(/COALESCE\(p\.paid_status, 'pending'\) <> 'paid'/);
    expect(voidFn).toMatch(/p\.pay_category NOT IN \('bonus', 'deduction'\)/);
    expect(voidFn).toMatch(/'payroll_voided'/);
  });
  it("is wired to assignment exit and booking cancel", () => {
    expect(MIGRATION).toMatch(/CREATE TRIGGER trg_void_payroll_on_assignment_exit\s+AFTER UPDATE OF status, response_status ON public\.booking_staff_assignments/);
    expect(MIGRATION).toMatch(/CREATE TRIGGER trg_void_payroll_on_booking_cancel\s+AFTER UPDATE OF status, lifecycle_status ON public\.bookings/);
  });
  it("internal helpers are not callable by anon or authenticated", () => {
    expect(MIGRATION).toMatch(/REVOKE ALL ON FUNCTION public\._void_unpaid_payroll\(uuid\[\], text\) FROM PUBLIC, anon, authenticated/);
  });
  it("the admin no longer creates payroll at assignment time", () => {
    const hook = read("src/hooks/useAdminData.ts");
    const create = hook.slice(hook.indexOf("export function useCreateStaffAssignment"), hook.indexOf("syncToGHL(variables.booking_id)", hook.indexOf("export function useCreateStaffAssignment")));
    expect(create).not.toMatch(/populate_staff_payroll_items/);
  });
});

describe("M-5: no duplicate assignment", () => {
  const body = fnBlock("trg_reject_duplicate_assignment");
  it("locks per (booking, staff, role) and rejects a live duplicate", () => {
    expect(body).toMatch(/pg_advisory_xact_lock/);
    expect(body).toMatch(/cleaning_type IS NOT DISTINCT FROM NEW\.cleaning_type/);
    expect(body).toMatch(/ERRCODE = '23505'/);
    expect(MIGRATION).toMatch(/BEFORE INSERT ON public\.booking_staff_assignments/);
  });
  it("the admin button cannot double-submit", () => {
    const detail = read("src/pages/admin/BookingDetail.tsx");
    expect(detail).toMatch(/if \(createAssignment\.isPending\) return;/);
    expect(detail).not.toMatch(/<Button onClick=\{handleAddAssignment\}(?! disabled)/);
  });
});

describe("M-2: payroll hours match the Staff tab", () => {
  it("uses the assignment window before the package window, wrapping overnight", () => {
    const patch = MIGRATION.slice(MIGRATION.indexOf("DO $patch$"));
    expect(patch.indexOf("v_assignment.scheduled_start_time")).toBeLessThan(patch.lastIndexOf("v_booking.package_start_time"));
    expect(patch).toMatch(/IF v_hours < 0 THEN v_hours := v_hours \+ 24; END IF;/);
    expect(patch).toMatch(/RAISE EXCEPTION 'M-2 patch: expected hours block not found/);
  });
});

describe("M-33: Unassign Me goes through the server", () => {
  const body = fnBlock("staff_unassign_self");
  it("refuses completed or paid work and records the event", () => {
    expect(body).toMatch(/WHERE id = p_assignment_id AND staff_id = p_staff_id\s+FOR UPDATE/);
    expect(body).toMatch(/v_row\.status = 'completed'/);
    expect(body).toMatch(/paid_status = 'paid' OR pay_category IN \('bonus', 'deduction'\)/);
    expect(body).toMatch(/'staff_unassigned'/);
  });
  it("the staff portal calls the RPC instead of a blocked delete", () => {
    const hook = read("src/hooks/useStaffData.ts");
    const fn = hook.slice(hook.indexOf("export function useRemoveStaffAssignment"), hook.indexOf("export function useStaffScheduleData"));
    expect(fn).toMatch(/rpc\("staff_unassign_self"/);
    expect(fn).not.toMatch(/\.delete\(\)/);
  });
});

describe("auto-generate-payroll is no longer public", () => {
  const src = read("supabase/functions/auto-generate-payroll/index.ts");
  it("requires admin or service role before any work", () => {
    expect(src).toMatch(/authorizeAdminOrService\(/);
    expect(src.indexOf("authorizeAdminOrService(")).toBeLessThan(src.indexOf('.from("booking_staff_assignments")'));
  });
  it("only processes accepted assignments", () => {
    expect(src).toMatch(/\.eq\("response_status", "accepted"\)/);
  });
});

describe("pre-deploy review: late acceptance after the event", () => {
  const body = fnBlock("trg_complete_late_acceptance");
  it("completes an assignment accepted after the booking reached post_event", () => {
    expect(body).toMatch(/NEW\.response_status = 'accepted'/);
    expect(body).toMatch(/b\.lifecycle_status IN \('post_event', 'closed_review_complete'\)/);
    expect(body).toMatch(/b\.status <> 'cancelled'::booking_status/);
    expect(MIGRATION).toMatch(/AFTER UPDATE OF response_status ON public\.booking_staff_assignments\s+FOR EACH ROW EXECUTE FUNCTION public\.trg_complete_late_acceptance\(\)/);
  });
  it("help text matches the new rule", () => {
    const help = read("src/components/admin/payroll/PayrollHelpPanel.tsx");
    expect(help).not.toMatch(/transitions to in_progress/);
    expect(help).toMatch(/accepted/);
  });
});
