import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "fs";
import { authorizeAdminOrService, type AdminAuthDeps } from "../_shared/admin-auth.ts";

// ClickUp 86e40ach2 — Phase 1A (security and silent data loss).
const read = (p: string) => readFileSync(p, "utf-8");
const MIGRATION = "supabase/migrations/20261112120000_phase1a_security_silent_data_loss.sql";

const SERVICE_KEY = "service-role-secret";

function deps(overrides: Partial<AdminAuthDeps> = {}): AdminAuthDeps {
  return {
    getUserId: vi.fn(async (jwt: string) => (jwt === "admin-jwt" || jwt === "user-jwt" ? `${jwt}-id` : null)),
    hasAdminRole: vi.fn(async (userId: string) => userId === "admin-jwt-id"),
    ...overrides,
  };
}

describe("authorizeAdminOrService (S-3)", () => {
  it("accepts the service-role key without a user lookup", async () => {
    const d = deps();
    const r = await authorizeAdminOrService(`Bearer ${SERVICE_KEY}`, SERVICE_KEY, d);
    expect(r).toEqual({ ok: true, via: "service_role" });
    expect(d.getUserId).not.toHaveBeenCalled();
  });

  it("accepts a signed-in admin", async () => {
    const r = await authorizeAdminOrService("Bearer admin-jwt", SERVICE_KEY, deps());
    expect(r).toEqual({ ok: true, via: "admin", userId: "admin-jwt-id" });
  });

  it("refuses a signed-in user without the admin role (403)", async () => {
    const r = await authorizeAdminOrService("Bearer user-jwt", SERVICE_KEY, deps());
    expect(r).toMatchObject({ ok: false, status: 403 });
  });

  it("refuses the anon key / unknown tokens (401)", async () => {
    const r = await authorizeAdminOrService("Bearer anon-public-key", SERVICE_KEY, deps());
    expect(r).toMatchObject({ ok: false, status: 401 });
  });

  it("refuses a missing or malformed header (401)", async () => {
    for (const h of [null, undefined, "", "Bearer ", "Basic abc"]) {
      const r = await authorizeAdminOrService(h, SERVICE_KEY, deps());
      expect(r).toMatchObject({ ok: false, status: 401 });
    }
  });

  it("treats lookup failures as refusals, never as a pass", async () => {
    const throwingUser = deps({ getUserId: vi.fn(async () => { throw new Error("auth down"); }) });
    expect(await authorizeAdminOrService("Bearer admin-jwt", SERVICE_KEY, throwingUser))
      .toMatchObject({ ok: false, status: 401 });

    const throwingRole = deps({ hasAdminRole: vi.fn(async () => { throw new Error("db down"); }) });
    expect(await authorizeAdminOrService("Bearer admin-jwt", SERVICE_KEY, throwingRole))
      .toMatchObject({ ok: false, status: 403 });
  });

  it("does not treat an unset service key as a match", async () => {
    const r = await authorizeAdminOrService("Bearer undefined", undefined, deps());
    expect(r).toMatchObject({ ok: false, status: 401 });
  });
});

describe("invoice functions are gated and take the recipient from the record (S-3)", () => {
  for (const path of [
    "supabase/functions/create-invoice/index.ts",
    "supabase/functions/create-addon-invoice/index.ts",
  ]) {
    const src = read(path);

    it(`${path} authorizes before reading the body or touching Stripe`, () => {
      const authAt = src.indexOf("authorizeAdminOrService(");
      expect(authAt).toBeGreaterThan(0);
      expect(authAt).toBeLessThan(src.indexOf("await req.json()"));
      expect(authAt).toBeLessThan(src.indexOf("new Stripe("));
      expect(src).toMatch(/if \(!auth\.ok\)/);
    });

    it(`${path} never destructures customer_email from the request`, () => {
      expect(src).not.toMatch(/\{[^}]*customer_email[^}]*\}\s*:\s*\w+Request\s*=\s*\n?\s*await req\.json\(\)/);
    });
  }

  it("create-invoice emails the address stored on the invoice", () => {
    const src = read("supabase/functions/create-invoice/index.ts");
    expect(src).toMatch(/const customer_email = String\(invoice\.customer_email/);
  });

  it("create-addon-invoice emails the booking's address", () => {
    const src = read("supabase/functions/create-addon-invoice/index.ts");
    expect(src).toMatch(/const customer_email = String\(invoiceBooking\.email/);
  });

  it("the gated functions keep verify_jwt = false only because they check auth themselves", () => {
    const toml = read("supabase/config.toml");
    expect(toml).toMatch(/\[functions\.create-invoice\]\nverify_jwt = false/);
    expect(toml).toMatch(/\[functions\.create-addon-invoice\]\nverify_jwt = false/);
  });
});

describe("test-trigger-automation is retired (S-4)", () => {
  const src = read("supabase/functions/test-trigger-automation/index.ts");

  it("answers 410 and has no database client", () => {
    expect(src).toMatch(/status: 410/);
    expect(src).not.toMatch(/createClient|supabase-js|from\(/);
  });

  it("is no longer declared public in config.toml", () => {
    expect(read("supabase/config.toml")).not.toMatch(/test-trigger-automation/);
  });
});

describe("stripe-webhook writes add-on revenue in one insert and records failures (S-5)", () => {
  const src = read("supabase/functions/stripe-webhook/index.ts");
  const start = src.indexOf('if (paymentType === "addon_invoice")');
  const end = src.indexOf('if (paymentType === "balance")', start);
  const branch = src.slice(start, end);

  it("collects every add-on line and inserts them together", () => {
    expect(branch.match(/addonRevenueRows\.push\(/g)?.length).toBe(5);
    expect(branch.match(/from\("booking_revenue_items"\)/g)?.length).toBe(1);
    expect(branch).toMatch(/\.insert\(addonRevenueRows, \{ defaultToNull: false \}\)/);
  });

  it("records a visible booking event when the write fails or the invoice cannot be read", () => {
    expect(branch.match(/event_type: "addon_revenue_write_failed"/g)?.length).toBe(2);
  });

  it("still labels every line payment_split = addon (allowed by the new CHECK)", () => {
    expect(branch.match(/payment_split: "addon"/g)?.length).toBe(5);
    expect(read(MIGRATION)).toMatch(/'full'::text, 'addon'::text/);
  });
});

describe("Phase 1A migration (S-1, S-2, S-5..S-9)", () => {
  const sql = read(MIGRATION);

  it("guards every admin-only read RPC and revokes anon", () => {
    for (const fn of [
      "get_daily_generated_revenue",
      "get_daily_revenue",
      "get_monthly_revenue",
      "get_payroll_by_role",
      "get_payroll_line_items_export",
      "get_revenue_by_category",
      "get_revenue_by_segment",
      "get_revenue_line_items_export",
    ]) {
      expect(sql).toMatch(new RegExp(`RENAME TO ${fn}_unchecked`));
      expect(sql).toMatch(new RegExp(`CREATE FUNCTION public\\.${fn}\\([\\s\\S]*?PERFORM public\\._assert_admin_or_service\\(\\)`));
      expect(sql).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`));
    }
  });

  it("keeps the staff portal's per-staff payroll read open but locks the all-staff form", () => {
    expect(sql).toMatch(/IF p_staff_id IS NULL THEN\s+PERFORM public\._assert_admin_or_service\(\);/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.get_payroll_by_staff\(date, date, uuid\) TO anon/);
  });

  it("revokes anon from both money generators and guards direct calls", () => {
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.populate_booking_revenue_items\(uuid, boolean\) FROM PUBLIC, anon;/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.populate_staff_payroll_items\(uuid, boolean\) FROM PUBLIC, anon;/);
    expect(sql.match(/IF pg_trigger_depth\(\) = 0 THEN\\n    PERFORM public\._assert_admin_or_service\(\);/g)?.length).toBe(2);
  });

  it("S-6: revenue regeneration deletes only deposit/balance lines", () => {
    expect(sql).toMatch(/payment_split IN \(''deposit'', ''balance''\);/);
  });

  it("S-7: payroll accepts the categories the generator writes", () => {
    for (const c of ["base_pay", "bar_vendor_flat", "hourly_bar_vendor"]) {
      expect(sql).toMatch(new RegExp(`'${c}'::text`));
    }
  });

  it("S-8: recalculation keeps manual and paid lines, one completion trigger", () => {
    expect(sql).toMatch(/AND pay_category NOT IN \('bonus', 'deduction'\);\$patch\$/);
    expect(sql).toMatch(/already paid; add a bonus or deduction instead of recalculating/);
    expect(sql).toMatch(/DROP TRIGGER IF EXISTS trg_populate_payroll_on_completion/);
  });

  it("S-2: open anon UPDATE policies replaced by staff-scoped RPCs", () => {
    const step2 = read("supabase/migrations/20261112120100_phase1a_drop_anon_assignment_policies.sql");
    expect(step2).toMatch(/DROP POLICY IF EXISTS "Anon can respond to own assignments"/);
    expect(step2).toMatch(/DROP POLICY IF EXISTS "Anon can update bar_service assignments"/);
    // Step 1 must not drop them (front end is published in between).
    expect(sql).not.toMatch(/DROP POLICY/);
    expect(sql).toMatch(/WHERE id = p_assignment_id\s+AND staff_id = p_staff_id/);
    // M-34: contacting the guest must not complete the bar assignment.
    const bar = sql.slice(sql.indexOf("FUNCTION public.staff_mark_bar_contacted"), sql.indexOf("REVOKE ALL ON FUNCTION public.staff_respond_to_assignment"));
    expect(bar).not.toMatch(/status\s*=\s*'completed'/);
  });

  it("S-9: guest report transition is compare-and-set, Orlando time, never cancelled", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.submit_guest_report"));
    expect(fn).toMatch(/AND lifecycle_status = 'in_progress'/);
    expect(fn).toMatch(/AND status <> 'cancelled'::booking_status/);
    expect(fn).toMatch(/AT TIME ZONE 'America\/New_York'/);
  });

  it("S-9: overnight events end the next day; resubmissions record nothing new", () => {
    const fn = sql.slice(sql.indexOf("FUNCTION public.submit_guest_report"));
    expect(fn).toMatch(/v_booking\.end_time <= v_booking\.start_time\s+THEN v_booking\.event_date \+ 1/);
    expect(fn).toMatch(/FOR UPDATE;/);
    expect(fn).toMatch(/IF NOT v_duplicate THEN\s+INSERT INTO public\.booking_host_reports/);
    expect(fn).toMatch(/END IF; -- NOT v_duplicate\s+-- Same rule/);
    // Idempotent steps run before the duplicate branch, so retries repair them.
    expect(fn.indexOf("host_report_completed_before_job_run")).toBeLessThan(fn.indexOf("IF NOT v_duplicate THEN"));
  });

  it("S-9: public writes to host reports / reviews are closed after publish", () => {
    const step2 = read("supabase/migrations/20261112120100_phase1a_drop_anon_assignment_policies.sql");
    for (const pol of [
      "Anyone can submit host reports via reservation lookup",
      "Anyone can submit host_reports",
      "Anyone can update their host report",
      "Anyone can submit reviews",
    ]) {
      expect(step2).toContain(`DROP POLICY IF EXISTS "${pol}"`);
    }
  });

  it("S-5: backfill is idempotent and refuses non-production paid invoices", () => {
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS booking_revenue_items_addon_invoice_line_uidx/);
    expect(sql).toMatch(/have non-production components; backfill them explicitly/);
  });
});

describe("front-end writes moved to RPCs (S-2, S-9)", () => {
  it("staff portal no longer updates booking_staff_assignments directly", () => {
    const src = read("src/hooks/useStaffData.ts");
    expect(src).not.toMatch(/from\("booking_staff_assignments"\)\s*\.update\(/);
    expect(src).toMatch(/"staff_respond_to_assignment"/);
    expect(src).toMatch(/"staff_mark_bar_contacted"/);
  });

  it("guest report submits through submit_guest_report only", () => {
    const src = read("src/hooks/useGuestReport.ts");
    expect(src).toMatch(/'submit_guest_report'/);
    expect(src).not.toMatch(/lifecycle_status: 'post_event'/);
    expect(src).not.toMatch(/from\('scheduled_jobs'\)/);
    expect(src).not.toMatch(/from\('maintenance_tickets'\)/);
    expect(src).not.toMatch(/!result\.duplicate/);
  });
});
