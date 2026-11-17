import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { refuseAction, sessionMustBeClosed, stopsRecurring } from "../_shared/invoice-actions";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const pending = { payment_status: "pending", paid_at: null, stripe_session_id: "cs_1" };

describe("E-8/E-9 invoice actions", () => {
  it("never acts on paid or void invoices", () => {
    expect(refuseAction({ ...pending, paid_at: "2026-11-01" }, { action: "void", kind: "invoice", reason: "x" })).toMatch(/already paid/);
    expect(refuseAction({ ...pending, payment_status: "void" }, { action: "resend", kind: "invoice" })).toMatch(/already void/);
  });

  it("add-ons can only be voided", () => {
    expect(refuseAction(pending, { action: "mark_paid", kind: "addon", method: "cash", reference: "1" })).toMatch(/only be voided/);
    expect(refuseAction(pending, { action: "void", kind: "addon", reason: "duplicate" })).toBeNull();
  });

  it("requires reason / method / reference", () => {
    expect(refuseAction(pending, { action: "void", kind: "invoice", reason: "  " })).toMatch(/why/);
    expect(refuseAction(pending, { action: "mark_paid", kind: "invoice", method: "venmo", reference: "1" })).toMatch(/how/);
    expect(refuseAction(pending, { action: "mark_paid", kind: "invoice", method: "zelle", reference: "" })).toMatch(/reference/);
    expect(refuseAction(pending, { action: "mark_paid", kind: "invoice", method: "zelle", reference: "Z123" })).toBeNull();
  });

  it("does not resend a recurring schedule template", () => {
    expect(refuseAction({ ...pending, recurring_template_only: true }, { action: "resend", kind: "invoice" })).toMatch(/nothing to resend/);
  });

  it("recurring parents stop when voided; only open sessions are expired", () => {
    expect(stopsRecurring({ ...pending, is_recurring: true, recurring_parent_id: null })).toBe(true);
    expect(stopsRecurring({ ...pending, is_recurring: true, recurring_parent_id: "p" })).toBe(false);
    expect(sessionMustBeClosed("open")).toBe(true);
    expect(sessionMustBeClosed("expired")).toBe(false);
  });

  it("manage-invoice closes Stripe before writing, and writes only while unpaid", () => {
    const fn = read("supabase/functions/manage-invoice/index.ts");
    expect(fn.indexOf("sessions.expire")).toBeLessThan(fn.indexOf('payment_status: "void"'));
    expect(fn).toMatch(/\.is\("paid_at", null\)\.neq\("payment_status", "paid"\)/);
    expect(fn).toMatch(/authorizeAdminOrService/);
    expect(fn).toMatch(/Deno\.env\.get\("Stripe_Secret_Key"\)/);
    expect(read("supabase/config.toml")).toMatch(/\[functions\.manage-invoice\]\nverify_jwt = false/);
  });

  it("create-invoice refuses paid or void invoices; the UI no longer deletes", () => {
    expect(read("supabase/functions/create-invoice/index.ts")).toMatch(/invoice\.payment_status === "void"/);
    expect(read("src/pages/admin/Invoices.tsx")).not.toMatch(/\.delete\(\)/);
  });

  it("Codex fixes: claim before acting, CAS session persist, late expiry guarded", () => {
    const fn = read("supabase/functions/manage-invoice/index.ts");
    expect(fn).toMatch(/admin_action_claimed_at: new Date\(\)\.toISOString\(\)/);
    expect(fn).toMatch(/finally \{\s+await release\(\);/);
    const ci = read("supabase/functions/create-invoice/index.ts");
    expect(ci).toMatch(/rpc\("persist_invoice_session"/);
    expect(ci.indexOf("persist_invoice_session")).toBeLessThan(ci.indexOf("client.send("));
    expect(ci).toMatch(/sessions\.expire\(session\.id\)/);
    expect(ci).not.toMatch(/\.update\(\{\s+payment_url: session\.url/);
    const wh = read("supabase/functions/stripe-webhook/index.ts");
    expect(wh).toMatch(/\.eq\("stripe_session_id", session\.id\)\s+\.is\("paid_at", null\);/);
    const mig = read("supabase/migrations/20261117140100_phase2c_invoice_races.sql");
    expect(mig).toMatch(/v_parent\.recurring_active/);
    expect(mig).toMatch(/stripe_session_id IS DISTINCT FROM p_expected_session/);
  });
});
