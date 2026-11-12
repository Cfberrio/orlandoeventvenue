import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — Phase 1B quick wins (M-28, M-29, M-30, example #4).
const read = (p: string) => readFileSync(p, "utf-8");

describe("M-28: date-only values are read as local dates", () => {
  const files = [
    "src/components/admin/payroll/AssignmentDetailsTable.tsx",
    "src/components/admin/payroll/StandaloneAssignmentsView.tsx",
    "src/pages/staff/StaffStandaloneList.tsx",
    "src/pages/staff/StandaloneCleaningReportForm.tsx",
    "src/components/admin/InternalBookingWizard.tsx",
    "src/components/admin/ExternalBookingWizard.tsx",
  ];
  it.each(files)("%s never builds a Date from a yyyy-MM-dd string", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/new Date\((assignment\.scheduled_date|item\.assignment_date|effectiveEndDate)\)/);
    expect(src).toMatch(/parseISO\(/);
  });
});

describe("M-29: month grid starts on the Sunday before the 1st", () => {
  const src = read("src/pages/admin/Schedule.tsx");
  it("pads the month view to whole weeks", () => {
    expect(src).toMatch(/startOfWeek\(startOfMonth\(currentDate\)\)/);
    expect(src).toMatch(/endOfWeek\(endOfMonth\(currentDate\)\)/);
    expect(src).toMatch(/eachDayOfInterval\(\{ start: gridStart, end: gridEnd \}\)/);
  });
});

describe("example #4: no stray 0 from numeric && in JSX", () => {
  const files = [
    "src/pages/admin/BookingDetail.tsx",
    "src/components/booking/SummaryStep.tsx",
    "src/components/admin/payroll/PayrollItemEditModal.tsx",
    "src/pages/staff/StaffPayments.tsx",
    "src/pages/staff/StaffStandaloneList.tsx",
  ];
  it.each(files)("%s guards numbers with Number(x) > 0", (f) => {
    const src = read(f);
    expect(src).not.toMatch(/\{\s*[\w.?]*(discount_amount|celebration_surcharge|pricing\.discount|item\.hours|item\.rate)\s*&&/);
  });
});

describe("M-30: dead or duplicate add-on payment links", () => {
  const webhook = read("supabase/functions/stripe-webhook/index.ts");
  const create = read("supabase/functions/create-addon-invoice/index.ts");
  const migration = read("supabase/migrations/20261113120000_phase1b_addon_link_expiry.sql");
  const detail = read("src/pages/admin/BookingDetail.tsx");

  it("webhook marks the add-on row expired only for its own unpaid session", () => {
    const expiredBlock = webhook.slice(webhook.indexOf('event.type === "checkout.session.expired"'));
    expect(expiredBlock).toMatch(/paymentType === "addon_invoice"/);
    expect(expiredBlock).toMatch(/\.eq\("stripe_session_id", session\.id\)/);
    expect(expiredBlock).toMatch(/\.eq\("payment_status", "pending"\)/);
    expect(expiredBlock).toMatch(/\.is\("paid_at", null\)/);
  });

  it("webhook still records a late payment on an expired row (claims on paid_at only)", () => {
    const paidClaim = webhook.slice(webhook.indexOf('paymentType === "addon_invoice"'), webhook.indexOf("Addon invoice marked as paid"));
    expect(paidClaim).toMatch(/\.is\("paid_at", null\)/);
    expect(paidClaim).not.toMatch(/\.eq\("payment_status", "pending"\)/);
  });

  it("create-addon-invoice refuses a second session for the same row", () => {
    expect(create).toMatch(/invoice\.paid_at \|\| invoice\.payment_status !== "pending" \|\| invoice\.stripe_session_id/);
    expect(create).toMatch(/status: 409/);
  });

  it("a new link supersedes unpaid twins, Stripe first, never a completed session", () => {
    expect(create).toMatch(/await supersedeAddonTwins\(supabase, stripe, invoice\)/);
    expect(create).toMatch(/live\.status === "complete"/);
    expect(create).toMatch(/stripe\.checkout\.sessions\.expire\(sessionId\)/);
    const fnBody = create.slice(create.indexOf("async function supersedeAddonTwins"));
    expect(fnBody.indexOf("sessions.expire")).toBeLessThan(fnBody.indexOf('payment_status: "expired"'));
  });

  it("expiry job only touches unpaid rows with a session older than 25h, hourly", () => {
    expect(migration).toMatch(/payment_status = 'pending'/);
    expect(migration).toMatch(/paid_at IS NULL/);
    expect(migration).toMatch(/stripe_session_id IS NOT NULL/);
    expect(migration).toMatch(/interval '25 hours'/);
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.expire_stale_addon_invoices\(\) FROM PUBLIC, anon, authenticated/);
    expect(migration).toMatch(/cron\.schedule\(\s*'expire-stale-addon-invoices-hourly'/);
  });

  it("admin never offers a link older than 24h and shows paid add-ons in the total", () => {
    expect(detail).toMatch(/linkExpired/);
    expect(detail).toMatch(/shownStatus === "pending" && invoice\.payment_url/);
    expect(detail).toMatch(/Total incl\. paid add-ons/);
  });
});
