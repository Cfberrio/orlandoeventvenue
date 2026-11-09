import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { buildInvoiceModel, type InvoiceBooking } from "../_shared/invoice-model.ts";
import { computeBookingPrice, type PricingRates } from "../_shared/booking-pricing.ts";

const read = (p: string) => readFileSync(p, "utf-8");
const cents = (n: number) => Math.round(n * 100);
const sum = (xs: number[]) => xs.reduce((a, b) => a + cents(b), 0) / 100;

const RATES: PricingRates = {
  hourly_rate: 139, daily_rate: 899, cleaning_fee: 199, package_basic: 89, package_led: 99,
  package_workshop: 149, setup_breakdown: 299, tablecloth_rental: 5, tablecloth_cleaning_fee: 25,
  deposit_percentage: 50, processing_fee: 3.75,
};

// OEV-JZHY9Z exactly as stored in production (2026-11-09).
const JZHY9Z: InvoiceBooking = {
  reservation_number: "OEV-JZHY9Z", full_name: "MISHAUN ROGERS", email: "guest@example.com",
  event_date: "2027-02-27", event_type: "party", number_of_guests: 50, booking_type: "hourly",
  start_time: "19:00:00", end_time: "23:00:00",
  base_rental: 556, cleaning_fee: 199, package_cost: 356, optional_services: 0, taxes_fees: 0,
  package: "basic", bar_subtotal: 0, bar_package_label: null,
  discount_amount: 556, discount_code: "MILITARYSERVICE",
  total_amount: 555, deposit_amount: 278, balance_amount: 277,
  processing_fee_pct: 3.75, deposit_fee: 10.43, deposit_total_charged: 288.43,
  balance_fee: 0, balance_total_charged: null,
};

const SNAP_BACKFILL = {
  discount_code: "MILITARYSERVICE", discount_type: "percentage" as const, discount_value: 100,
  discount_applies_to: "base_rental" as const, lines: null,
};

describe("OEV-JZHY9Z deposit invoice (after)", () => {
  const m = buildInvoiceModel("deposit", JZHY9Z, SNAP_BACKFILL, 3.75);

  it("shows the discount and the code with its real terms", () => {
    expect(m.totals.discount).toBe(556);
    expect(m.discountNote).toBe("Discount code MILITARYSERVICE: 100% off base rental (saved $556.00)");
    const rental = m.rows.find((r) => r.label === "Base Rental")!;
    expect(rental.discount).toBe(556);
    expect(rental.net).toBe(0);
    expect(rental.paid).toBe(0);
  });

  it("every column sums to its total; paid column = deposit", () => {
    expect(sum(m.rows.map((r) => r.gross))).toBe(1111);
    expect(sum(m.rows.map((r) => r.discount))).toBe(556);
    expect(sum(m.rows.map((r) => r.net))).toBe(555);
    expect(sum(m.rows.map((r) => r.paid))).toBe(278);
    expect(m.totals).toEqual({ gross: 1111, discount: 556, net: 555, paid: 278 });
  });

  it("fee and total charged are exactly what Stripe charged", () => {
    expect(m.subtotal).toBe(278);
    expect(m.fee).toBe(10.43);
    expect(m.totalCharged).toBe(288.43);
    expect(m.feePct).toBe(3.75);
    expect(m.footnote).toContain("$277.00");
  });
});

describe("balance invoice", () => {
  it("paid column sums to the balance and shows the deposit paid earlier", () => {
    const paid = { ...JZHY9Z, balance_fee: 10.39, balance_total_charged: 287.39 };
    const m = buildInvoiceModel("balance", paid, SNAP_BACKFILL, 3.75);
    expect(sum(m.rows.map((r) => r.paid))).toBe(277);
    expect(m.totalCharged).toBe(287.39);
    expect(m.footnote).toContain("Deposit of $278.00 paid earlier");
    expect(m.discountNote).toContain("MILITARYSERVICE");
  });
});

describe("checkout snapshot lines are used when they still match", () => {
  it("uses the snapshot split", () => {
    const price = computeBookingPrice(
      { bookingType: "hourly", startTime: "19:00", endTime: "23:00", package: "basic", packageStartTime: "19:00", packageEndTime: "23:00" },
      RATES,
      { code: "MILITARYSERVICE", discount_type: "fixed_amount", discount_value: 100, applies_to: "base_rental", applies_to_hourly: true, applies_to_daily: true },
    );
    const b: InvoiceBooking = {
      ...JZHY9Z, discount_amount: 100, total_amount: price.total, deposit_amount: price.deposit, balance_amount: price.balance,
      deposit_fee: price.depositFee, deposit_total_charged: price.depositTotal,
    };
    const m = buildInvoiceModel("deposit", b, { ...SNAP_BACKFILL, discount_type: "fixed_amount", lines: price.lines }, 3.75);
    expect(m.rows.map((r) => r.paid)).toEqual(price.lines.map((l) => l.deposit));
    expect(m.discountNote).toBe("Discount code MILITARYSERVICE: $100 off base rental (saved $100.00)");
  });

  it("falls back to stored columns when the snapshot no longer matches", () => {
    const bogus = [{ key: "base_rental", label: "Base Rental", gross: 1, discount: 0, net: 1, deposit: 1, balance: 0 }];
    const m = buildInvoiceModel("deposit", JZHY9Z, { ...SNAP_BACKFILL, lines: bogus }, 3.75);
    expect(sum(m.rows.map((r) => r.paid))).toBe(278);
    expect(m.totals.gross).toBe(1111);
  });
});

describe("no discount", () => {
  it("has no discount note and zero discount column", () => {
    const b = { ...JZHY9Z, discount_amount: 0, discount_code: null, total_amount: 1111, deposit_amount: 556, balance_amount: 555 };
    const m = buildInvoiceModel("deposit", b, null, 3.75);
    expect(m.discountNote).toBeNull();
    expect(m.totals.discount).toBe(0);
    expect(sum(m.rows.map((r) => r.paid))).toBe(556);
  });
});

// ---------------------------------------------------------------------------
// Source guards: the holes found in the 2026-11 audit must stay closed.
// ---------------------------------------------------------------------------

describe("source guards", () => {
  const checkout = read("supabase/functions/create-checkout/index.ts");
  const webhook = read("supabase/functions/stripe-webhook/index.ts");
  const balanceLink = read("supabase/functions/create-balance-payment-link/index.ts");
  const cancel = read("supabase/functions/cancel-booking/index.ts");
  const depositMail = read("supabase/functions/send-booking-confirmation/index.ts");
  const balanceMail = read("supabase/functions/send-balance-confirmation/index.ts");
  const summary = read("src/components/booking/SummaryStep.tsx");
  const payment = read("src/components/booking/PaymentStep.tsx");
  const discounts = read("src/pages/admin/Discounts.tsx");

  it("checkout charges the server-verified deposit, never the browser's", () => {
    expect(checkout).toContain("const depositAmountCents = toCents(price.deposit);");
    expect(checkout).not.toMatch(/Math\.round\(depositAmount \* 100\)/);
    expect(checkout).toContain("priceMismatches(booking, price)");
    expect(checkout).toContain('"PRICE_CHANGED"');
    expect(checkout).toContain('from("booking_price_snapshots").insert');
  });

  it("webhook compares Stripe's amount to the expected amount read BEFORE the update", () => {
    expect(webhook).toContain("const expectedDepositTotal = currentBooking?.deposit_total_charged;");
    expect(webhook).toContain("const expectedBalanceTotal = currentBooking?.balance_total_charged;");
    expect(webhook).not.toContain("Math.abs(amountPaid - Number(data.deposit_total_charged))");
    expect(webhook).not.toContain("Math.abs(amountPaid - Number(data.balance_total_charged))");
    expect(webhook).toContain('"duplicate_balance_payment"');
    expect(webhook).toContain('"payment_on_cancelled_booking"');
  });

  it("webhook calls receipt emails with the service role and booking_id", () => {
    const anonEmailCalls = webhook.match(/send-(booking|balance)-confirmation`[\s\S]{0,200}SUPABASE_ANON_KEY/g);
    expect(anonEmailCalls).toBeNull();
    expect(webhook.match(/booking_id: bookingId,\n\s+email: data\.email,/g)?.length).toBe(2);
  });

  it("receipt emails load amounts and recipient from the database", () => {
    for (const src of [depositMail, balanceMail]) {
      expect(src).toContain("resolveReceiptBooking(req, supabase");
      expect(src).toContain("to: booking.email");
      expect(src).not.toMatch(/const booking: \w+ = await req\.json\(\)/);
      expect(src).toContain("buildInvoiceModel(");
    }
  });

  it("balance links: real auth, no cancelled bookings, one payable link", () => {
    expect(balanceLink).not.toContain("const supabaseAuthed = !!authHeader;");
    expect(balanceLink).toContain('authorizeCaller(req, authClient, ["ghl", "service", "admin"])');
    expect(balanceLink).toContain('booking.status === "cancelled"');
    expect(balanceLink).toContain("stripe.checkout.sessions.expire(staleId)");
    expect(balanceLink).toContain("balance_session_id: session.id");
  });

  it("cancel requires an authorized caller and voids the balance link", () => {
    expect(cancel).toContain('authorizeCaller(req, authClient, ["admin", "service", "ghl"])');
    expect(cancel).toContain("balance_payment_url: null");
  });

  it("booking page has no hardcoded codes and validates via RPC", () => {
    expect(summary).not.toContain("discountCodes");
    expect(summary).toContain('"validate_discount_code"');
    expect(summary).not.toContain('.from("discount_coupons")');
    expect(summary).toContain("computeBookingPrice(");
  });

  it("payment page shows the same fee Stripe charges", () => {
    expect(payment).toContain("feeCentsFor(toCents(depositBase), p.processing_fee)");
    expect(payment).not.toContain("Math.round(depositBase * feeRate * 100)");
  });

  it("admin coupon form has no default type and confirms large discounts", () => {
    expect(discounts).toContain("useState<DiscountType | null>(null)");
    expect(discounts).not.toContain('useState<"percentage" | "fixed_amount">("percentage")');
    expect(discounts).toContain("isLargeDiscount(");
    expect(discounts).toContain("confirmText.trim() !== formCode.trim()");
  });
});
