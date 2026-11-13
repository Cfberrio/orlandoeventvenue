import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — M-13, M-15, M-17, M-18, M-21.
const read = (p: string) => readFileSync(p, "utf-8");
const DETAIL = read("src/pages/admin/BookingDetail.tsx");
const CONFIRM = read("src/pages/BookingConfirmation.tsx");
const BALANCE = read("supabase/functions/create-balance-payment-link/index.ts");
const ADDON = read("supabase/functions/create-addon-invoice/index.ts");
const COUPONS = read("supabase/migrations/20261113200000_phase1b_coupons.sql");
const BILLING = read("supabase/functions/_shared/billing-server.ts");
const CHECKOUT = read("supabase/functions/create-checkout/index.ts");
const DISCOUNTS = read("src/pages/admin/Discounts.tsx");

describe("M-13 / M-15 payment display", () => {
  it("admin shows charged amounts per payment and Total charged, no hardcoded fee row", () => {
    expect(DETAIL).not.toMatch(/Applied per transaction/);
    expect(DETAIL).toMatch(/Total charged/);
    expect(DETAIL).not.toMatch(/processing_fee \|\| 3\.5/);
  });
  it("confirmation page shows the deposit the same way as the balance (charged, fee incl.)", () => {
    expect(CONFIRM).toMatch(/booking\.deposit_total_charged \?\? booking\.deposit_amount/);
    expect(CONFIRM).not.toMatch(/Deposit Paid \(50%\)/);
  });
});

describe("M-17 balance fee", () => {
  it("uses the % stored on the booking, live % only as fallback, never 3.5 hardcoded", () => {
    expect(BALANCE).toMatch(/booking\.processing_fee_pct != null/);
    expect(BALANCE).not.toMatch(/feeRow\?\.price \?\? 3\.5/);
  });
});

describe("M-18 add-on prices on the server", () => {
  it("re-prices package and bar from venue_pricing and refuses a mismatch", () => {
    expect(ADDON).toMatch(/pricingMap\[`package_\$\{invoice\.package\}`\]/);
    expect(ADDON).toMatch(/pricingMap\[invBarPackage\]/);
    expect(ADDON).toMatch(/Prices do not match the current price list/);
  });
});

describe("M-21 coupons", () => {
  it("expiry and paid-use limit, same rule in validator and checkout", () => {
    expect(COUPONS).toMatch(/ADD COLUMN IF NOT EXISTS expires_at timestamptz/);
    expect(COUPONS).toMatch(/ADD COLUMN IF NOT EXISTS max_uses integer/);
    expect(COUPONS).toMatch(/b\.deposit_paid_at IS NOT NULL OR b\.balance_paid_at IS NOT NULL/);
    expect(COUPONS).toMatch(/public\.coupon_unusable_reason\(p_code\) IS NULL/);
    expect(BILLING).toMatch(/rpc\("coupon_unusable_reason"/);
    expect(CHECKOUT).toMatch(/coupon\.unusable_reason\s+\? `code_\$\{coupon\.unusable_reason\}`/);
  });
  it("validator throttles failed lookups per IP, never a shared unknown bucket", () => {
    expect(COUPONS).toMatch(/IF v_ip <> 'unknown' AND v_failed >= 15 THEN/);
    expect(COUPONS).toMatch(/cf-connecting-ip/);
  });
  it("admin can set expiry and max uses", () => {
    expect(DISCOUNTS).toMatch(/Max paid uses/);
    expect(DISCOUNTS).toMatch(/expires_at: formExpiresOn/);
  });
});

describe("M-16 checkout refuses inactive services", () => {
  it("checks the booking's required price keys against active venue_pricing", () => {
    expect(BILLING).toMatch(/export function requiredPriceKeys/);
    expect(CHECKOUT).toMatch(/requiredPriceKeys\(booking\)\.filter\(\(k\) => !activeKeys\.has\(k\)\)/);
    expect(CHECKOUT).toMatch(/error: "PRICE_UNAVAILABLE"/);
  });
  it("Stripe line item label comes from the stored booking (incl. typed Other)", () => {
    expect(CHECKOUT).toMatch(/eventTypeLabel\(booking\.event_type, booking\.event_type_other\)/);
  });
});

describe("Codex review round (coupons, recurring, add-on bar, GHL)", () => {
  const RECURRING = read("supabase/functions/process-recurring-invoices/index.ts");
  const INVOICE = read("supabase/functions/create-invoice/index.ts");
  const JOBS = read("supabase/functions/process-scheduled-jobs/index.ts");
  const DIALOG = read("src/components/admin/CreateAddonInvoiceDialog.tsx");
  it("checkout reserves a limited coupon use under a per-code lock", () => {
    expect(COUPONS).toMatch(/pg_advisory_xact_lock\(hashtext\('oev_coupon:' \|\| v_code\)\)/);
    expect(CHECKOUT).toMatch(/rpc\("reserve_coupon_use"/);
  });
  it("recurring advances only after the email went out and rechecks the parent before sending", () => {
    expect(INVOICE).toMatch(/email_sent: emailSent,/);
    expect(RECURRING).toMatch(/if \(!child\.email_sent_at\) \{/);
    expect(RECURRING).toMatch(/body\?\.email_sent !== true/);
    expect(RECURRING).toMatch(/paused or rescheduled; not sending/);
  });
  it("add-on dialog uses live bar rates", () => {
    expect(DIALOG).toMatch(/liveBarRate\(barPackage\)/);
  });
  it("event-start job keeps a failed GHL sync retryable", () => {
    expect(JOBS).toMatch(/last_error: GHL_SYNC_PENDING/);
    expect(JOBS).toMatch(/booking\.lifecycle_status === "in_progress" && job\.last_error === GHL_SYNC_PENDING/);
  });
});
