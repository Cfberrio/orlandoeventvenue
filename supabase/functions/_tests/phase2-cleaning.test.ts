import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("E-10/E-11/E-12 cleaning reports go through server functions", () => {
  const form = read("src/pages/staff/CleaningReportForm.tsx");
  const staffHooks = read("src/hooks/useStaffData.ts");
  const standaloneHooks = read("src/hooks/useStandaloneCleaningData.ts");
  const mig = read("supabase/migrations/20261117130000_phase2b_cleaning_submit.sql");
  const lockdown = read("supabase/migrations/20261117130100_phase2b_cleaning_lockdown.sql");

  it("booking report submits through staff_submit_cleaning_report", () => {
    expect(staffHooks).toMatch(/rpc\("staff_submit_cleaning_report"/);
    expect(staffHooks).not.toMatch(/from\("booking_cleaning_reports"\)\s*\.(insert|update)/);
  });

  it("the form no longer writes tickets or inventory from the browser", () => {
    expect(form).not.toMatch(/createTicket|from\("inventory_stock"\)/);
    expect(form).toMatch(/description: error instanceof Error/);
  });

  it("the role gate runs after every hook", () => {
    const gate = form.indexOf("Block access for Production and Assistant roles");
    const lastHook = Math.max(form.lastIndexOf("useState("), form.lastIndexOf("useInventoryStock()"));
    expect(gate).toBeGreaterThan(lastHook);
  });

  it("standalone report submits through staff_submit_standalone_cleaning_report", () => {
    expect(standaloneHooks).toMatch(/rpc\("staff_submit_standalone_cleaning_report"/);
    expect(standaloneHooks).not.toMatch(/standaloneReportsTable\(\)\s*\.(insert|update)/);
  });

  it("server functions check identity, media and dedupe tickets", () => {
    expect(mig).toMatch(/You are not assigned to this booking/);
    expect(mig).toMatch(/This assignment is not yours/);
    expect(mig).toMatch(/At least 2 bathroom photos are required/);
    expect(mig).toMatch(/NOT EXISTS \(\s*SELECT 1 FROM public\.maintenance_tickets/);
    expect(mig).toMatch(/REVOKE ALL ON FUNCTION public\._apply_cleaning_inventory\(jsonb, text\) FROM PUBLIC, anon, authenticated/);
  });

  it("lockdown removes the open anon write policies", () => {
    expect(lockdown).toMatch(/DROP POLICY IF EXISTS "Allow anon to insert cleaning reports"/);
    expect(lockdown).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.booking_cleaning_reports FROM anon/);
  });
});
