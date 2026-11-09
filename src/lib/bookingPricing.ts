// Single source of truth for website booking prices.
//
// MUST stay byte-identical to src/lib/bookingPricing.ts (the booking page uses
// that copy for its live preview; create-checkout uses this one to re-check the
// stored booking before charging). A test enforces the two files match.
//
// All money is computed in integer cents and returned in dollars with exactly
// two decimals, so the page, the database, Stripe and every invoice agree to
// the cent.

export type BookingType = "hourly" | "daily";
export type PackageKey = "none" | "basic" | "led" | "workshop";
export type DiscountTarget = "base_rental" | "total";
export type DiscountKind = "percentage" | "fixed_amount";

export interface PricingRates {
  hourly_rate: number;
  daily_rate: number;
  cleaning_fee: number;
  package_basic: number;
  package_led: number;
  package_workshop: number;
  setup_breakdown: number;
  tablecloth_rental: number;
  tablecloth_cleaning_fee: number;
  deposit_percentage: number;
  processing_fee: number;
}

export interface CouponTerms {
  code: string;
  discount_type: DiscountKind;
  discount_value: number;
  applies_to: DiscountTarget;
  applies_to_hourly: boolean;
  applies_to_daily: boolean;
}

export interface BookingPriceInput {
  bookingType: BookingType;
  startTime?: string | null;
  endTime?: string | null;
  package?: PackageKey | null;
  packageStartTime?: string | null;
  packageEndTime?: string | null;
  setupBreakdown?: boolean | null;
  tablecloths?: boolean | null;
  tableclothQuantity?: number | null;
  barSubtotal?: number | null;
  barLabel?: string | null;
}

export type LineKey = "base_rental" | "cleaning_fee" | "package" | "bar" | "add_ons";

export interface PriceLine {
  key: LineKey;
  label: string;
  /** Price before any discount. */
  gross: number;
  /** Portion of the discount applied to this line (positive number). */
  discount: number;
  /** gross - discount. */
  net: number;
  /** Portion of the deposit allocated to this line. Lines sum exactly to the deposit. */
  deposit: number;
  /** net - deposit. Lines sum exactly to the balance. */
  balance: number;
}

export interface AppliedDiscount {
  code: string;
  type: DiscountKind;
  /** As configured: percent (e.g. 10) or dollars (e.g. 100). */
  value: number;
  appliesTo: DiscountTarget;
  /** Dollars the discount was calculated on. */
  eligibleBase: number;
  /** Dollars actually taken off. */
  amount: number;
  /** Human sentence for invoices, e.g. "100% off base rental". */
  description: string;
}

export interface BookingPrice {
  baseRental: number;
  cleaningFee: number;
  packageCost: number;
  optionalServices: number;
  barSubtotal: number;
  grossSubtotal: number;
  discount: AppliedDiscount | null;
  /** Contract total after discount, before processing fees. */
  total: number;
  deposit: number;
  balance: number;
  depositPercentage: number;
  processingFeePct: number;
  /** Processing fee charged on the deposit. */
  depositFee: number;
  /** deposit + depositFee: what Stripe charges at checkout. */
  depositTotal: number;
  lines: PriceLine[];
}

export type CouponCheck =
  | { ok: true }
  | { ok: false; reason: "not_for_booking_type"; allowed: "hourly" | "daily" | "none" };

// ---------------------------------------------------------------------------
// Rates from venue_pricing rows
// ---------------------------------------------------------------------------

export const FALLBACK_RATES: PricingRates = {
  hourly_rate: 140,
  daily_rate: 899,
  cleaning_fee: 199,
  package_basic: 79,
  package_led: 99,
  package_workshop: 149,
  setup_breakdown: 100,
  tablecloth_rental: 5,
  tablecloth_cleaning_fee: 25,
  deposit_percentage: 50,
  processing_fee: 3.5,
};

export interface VenuePricingRow {
  item_key: string;
  price: number | string;
  extra_fee?: number | string | null;
}

/** Active venue_pricing rows -> rates. Unknown keys are ignored. */
export function buildPricingRates(rows: VenuePricingRow[]): PricingRates {
  const map: PricingRates = { ...FALLBACK_RATES };
  for (const row of rows) {
    const price = Number(row.price);
    switch (row.item_key) {
      case "hourly_rate": map.hourly_rate = price; break;
      case "daily_rate": map.daily_rate = price; break;
      case "cleaning_fee": map.cleaning_fee = price; break;
      case "package_basic": map.package_basic = price; break;
      case "package_led": map.package_led = price; break;
      case "package_workshop": map.package_workshop = price; break;
      case "setup_breakdown": map.setup_breakdown = price; break;
      case "tablecloth_rental":
        map.tablecloth_rental = price;
        map.tablecloth_cleaning_fee = Number(row.extra_fee) || 0;
        break;
      case "deposit_percentage": map.deposit_percentage = price; break;
      case "processing_fee": map.processing_fee = price; break;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Cents helpers
// ---------------------------------------------------------------------------

export function toCents(dollars: number | null | undefined): number {
  const n = Number(dollars ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100;
}

/** Processing fee in cents, identical to every Stripe session in the system. */
export function feeCentsFor(amountCents: number, feePct: number): number {
  return Math.round(amountCents * (feePct / 100));
}

/**
 * Split `totalCents` across `weights` so the parts sum EXACTLY to the total
 * (largest-remainder method). Zero or negative weights receive nothing.
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const positive = weights.map((w) => (w > 0 ? w : 0));
  const weightSum = positive.reduce((a, b) => a + b, 0);
  if (weightSum <= 0 || totalCents === 0) return weights.map(() => 0);

  const raw = positive.map((w) => (totalCents * w) / weightSum);
  const floors = raw.map((r) => Math.floor(r));
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r), w: positive[i] }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.frac - a.frac || b.w - a.w || a.i - b.i);

  const out = [...floors];
  for (let k = 0; remainder > 0 && order.length > 0; k = (k + 1) % order.length) {
    out[order[k].i] += 1;
    remainder -= 1;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Time helpers (same arithmetic the booking page has always used)
// ---------------------------------------------------------------------------

function minutesOf(time: string | null | undefined): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(String(time).trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function hoursBetween(start: string | null | undefined, end: string | null | undefined): number {
  const a = minutesOf(start);
  const b = minutesOf(end);
  if (a == null || b == null) return 0;
  return (b - a) / 60;
}

// ---------------------------------------------------------------------------
// Coupon rules
// ---------------------------------------------------------------------------

export function checkCouponForBooking(coupon: CouponTerms, bookingType: BookingType): CouponCheck {
  const ok =
    (bookingType === "hourly" && coupon.applies_to_hourly) ||
    (bookingType === "daily" && coupon.applies_to_daily);
  if (ok) return { ok: true };
  const allowed = coupon.applies_to_hourly ? "hourly" : coupon.applies_to_daily ? "daily" : "none";
  return { ok: false, reason: "not_for_booking_type", allowed };
}

export function describeDiscount(type: DiscountKind, value: number, appliesTo: DiscountTarget): string {
  const target = appliesTo === "total" ? "booking total" : "base rental";
  if (type === "percentage") return `${formatNumber(value)}% off ${target}`;
  return `$${formatMoney(value)} off ${target}`;
}

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

function formatMoney(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const PACKAGE_LABELS: Record<Exclude<PackageKey, "none">, string> = {
  basic: "Basic A/V Package",
  led: "LED Wall Package",
  workshop: "Workshop/Streaming Package",
};

// ---------------------------------------------------------------------------
// The calculation
// ---------------------------------------------------------------------------

/**
 * Price a website booking. `coupon` must already be validated as active and
 * eligible for the booking type (see checkCouponForBooking); an ineligible
 * coupon passed here is ignored.
 */
export function computeBookingPrice(
  input: BookingPriceInput,
  rates: PricingRates,
  coupon: CouponTerms | null,
  opts: { legacyWholeDollarPercent?: boolean } = {},
): BookingPrice {
  // 1. Gross lines, in cents.
  let baseCents = 0;
  if (input.bookingType === "hourly") {
    baseCents = toCents(rates.hourly_rate * hoursBetween(input.startTime, input.endTime));
  } else if (input.bookingType === "daily") {
    baseCents = toCents(rates.daily_rate);
  }

  const cleaningCents = toCents(rates.cleaning_fee);

  const pkg: PackageKey = (input.package || "none") as PackageKey;
  let packageCents = 0;
  if (pkg !== "none") {
    const hourly =
      pkg === "basic" ? rates.package_basic : pkg === "led" ? rates.package_led : rates.package_workshop;
    packageCents = toCents(hourly * hoursBetween(input.packageStartTime, input.packageEndTime));
  }

  let addOnCents = 0;
  if (input.setupBreakdown) addOnCents += toCents(rates.setup_breakdown);
  const qty = Number(input.tableclothQuantity || 0);
  if (input.tablecloths && qty > 0) {
    addOnCents += toCents(qty * rates.tablecloth_rental) + toCents(rates.tablecloth_cleaning_fee);
  }

  const barCents = Math.max(0, toCents(input.barSubtotal));

  const lineDefs: Array<{ key: LineKey; label: string; gross: number }> = [
    { key: "base_rental", label: "Base Rental", gross: baseCents },
    { key: "cleaning_fee", label: "Cleaning Fee", gross: cleaningCents },
    { key: "package", label: pkg === "none" ? "Package" : PACKAGE_LABELS[pkg], gross: packageCents },
    { key: "bar", label: input.barLabel ? `Bar Service: ${input.barLabel}` : "Bar Service", gross: barCents },
    { key: "add_ons", label: "Add-ons & Optional Services", gross: addOnCents },
  ];
  const grossCents = lineDefs.reduce((s, l) => s + l.gross, 0);

  // 2. Discount.
  let discountCents = 0;
  let discountByLine = lineDefs.map(() => 0);
  let applied: AppliedDiscount | null = null;

  if (coupon && checkCouponForBooking(coupon, input.bookingType).ok && Number(coupon.discount_value) > 0) {
    const target: DiscountTarget = coupon.applies_to === "total" ? "total" : "base_rental";
    const eligibleCents = target === "total" ? grossCents : baseCents;
    const value = Number(coupon.discount_value);

    if (coupon.discount_type === "percentage") {
      const pct = Math.min(value, 100);
      // Booking pages published before 2026-11-09 rounded percent discounts to
      // whole dollars; create-checkout accepts that variant during the rollout.
      discountCents = opts.legacyWholeDollarPercent
        ? Math.round((eligibleCents * pct) / 100 / 100) * 100
        : Math.round((eligibleCents * pct) / 100);
    } else {
      discountCents = Math.min(toCents(value), eligibleCents);
    }
    discountCents = Math.max(0, Math.min(discountCents, eligibleCents));

    discountByLine =
      target === "total"
        ? allocateCents(discountCents, lineDefs.map((l) => l.gross))
        : lineDefs.map((l) => (l.key === "base_rental" ? discountCents : 0));

    applied = {
      code: coupon.code,
      type: coupon.discount_type,
      value,
      appliesTo: target,
      eligibleBase: fromCents(eligibleCents),
      amount: fromCents(discountCents),
      description: describeDiscount(coupon.discount_type, value, target),
    };
  }

  // 3. Totals. Deposit is rounded to whole dollars (OEV convention since launch).
  const totalCents = grossCents - discountCents;
  const depositPct = Number(rates.deposit_percentage);
  const depositCents = Math.round((totalCents * depositPct) / 100 / 100) * 100;
  const balanceCents = totalCents - depositCents;
  const feePct = Number(rates.processing_fee);
  const depositFeeCents = feeCentsFor(depositCents, feePct);

  // 4. Per-line net and deposit allocation (sums are exact by construction).
  const netByLine = lineDefs.map((l, i) => l.gross - discountByLine[i]);
  const depositByLine = allocateCents(depositCents, netByLine);

  const lines: PriceLine[] = lineDefs
    .map((l, i) => ({
      key: l.key,
      label: l.label,
      gross: fromCents(l.gross),
      discount: fromCents(discountByLine[i]),
      net: fromCents(netByLine[i]),
      deposit: fromCents(depositByLine[i]),
      balance: fromCents(netByLine[i] - depositByLine[i]),
    }))
    .filter((l) => l.gross !== 0);

  return {
    baseRental: fromCents(baseCents),
    cleaningFee: fromCents(cleaningCents),
    packageCost: fromCents(packageCents),
    optionalServices: fromCents(addOnCents),
    barSubtotal: fromCents(barCents),
    grossSubtotal: fromCents(grossCents),
    discount: applied,
    total: fromCents(totalCents),
    deposit: fromCents(depositCents),
    balance: fromCents(balanceCents),
    depositPercentage: depositPct,
    processingFeePct: feePct,
    depositFee: fromCents(depositFeeCents),
    depositTotal: fromCents(depositCents + depositFeeCents),
    lines,
  };
}

// ---------------------------------------------------------------------------
// Comparing a stored booking against a fresh calculation
// ---------------------------------------------------------------------------

export interface StoredBookingAmounts {
  base_rental: number | null;
  cleaning_fee: number | null;
  package_cost: number | null;
  optional_services: number | null;
  discount_amount: number | null;
  discount_code: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  balance_amount: number | null;
}

/** Field names whose stored value differs from the calculation by more than one cent. */
export function priceMismatches(stored: StoredBookingAmounts, price: BookingPrice): string[] {
  const pairs: Array<[string, number | null, number]> = [
    ["base_rental", stored.base_rental, price.baseRental],
    ["cleaning_fee", stored.cleaning_fee, price.cleaningFee],
    ["package_cost", stored.package_cost, price.packageCost],
    ["optional_services", stored.optional_services, price.optionalServices],
    ["discount_amount", stored.discount_amount, price.discount?.amount ?? 0],
    ["total_amount", stored.total_amount, price.total],
    ["deposit_amount", stored.deposit_amount, price.deposit],
    ["balance_amount", stored.balance_amount, price.balance],
  ];
  const out = pairs
    .filter(([, s, c]) => Math.abs(toCents(s) - toCents(c)) > 1)
    .map(([k]) => k);
  const storedCode = (stored.discount_code || "").trim().toUpperCase();
  const calcCode = (price.discount?.code || "").trim().toUpperCase();
  if (storedCode !== calcCode) out.push("discount_code");
  return out;
}

// ---------------------------------------------------------------------------
// Rebuilding the invoice lines of a booking from its stored columns
// ---------------------------------------------------------------------------

export interface StoredBookingForInvoice extends StoredBookingAmounts {
  package: string | null;
  bar_subtotal: number | null;
  bar_package_label: string | null;
  taxes_fees?: number | null;
}

/**
 * Invoice lines for a booking whose price was already fixed (stored columns),
 * with the stored discount allocated to its target and the stored deposit
 * allocated so every column sums exactly. `discountTarget` comes from the
 * booking's price snapshot; when unknown, a discount no larger than the base
 * rental is shown against the base rental, otherwise spread across all lines.
 */
export function invoiceLinesFromStored(
  b: StoredBookingForInvoice,
  discountTarget: DiscountTarget | null,
): PriceLine[] {
  const pkg = (b.package || "none") as PackageKey;
  const defs: Array<{ key: LineKey; label: string; gross: number }> = [
    { key: "base_rental", label: "Base Rental", gross: toCents(b.base_rental) },
    { key: "cleaning_fee", label: "Cleaning Fee", gross: toCents(b.cleaning_fee) },
    { key: "package", label: pkg === "none" ? "Package" : PACKAGE_LABELS[pkg] ?? "Package", gross: toCents(b.package_cost) },
    { key: "bar", label: b.bar_package_label ? `Bar Service: ${b.bar_package_label}` : "Bar Service", gross: toCents(b.bar_subtotal) },
    { key: "add_ons", label: "Add-ons & Optional Services", gross: toCents(b.optional_services) + toCents(b.taxes_fees) },
  ];
  const discountCents = Math.max(0, toCents(b.discount_amount));
  const target: DiscountTarget =
    discountTarget ?? (discountCents <= defs[0].gross ? "base_rental" : "total");

  const discountByLine =
    target === "total"
      ? allocateCents(discountCents, defs.map((d) => d.gross))
      : defs.map((d) => (d.key === "base_rental" ? Math.min(discountCents, d.gross) : 0));
  // If the base rental could not absorb the whole discount, spread the rest.
  const leftover = discountCents - discountByLine.reduce((a, c) => a + c, 0);
  if (leftover > 0) {
    const rest = allocateCents(leftover, defs.map((d, i) => d.gross - discountByLine[i]));
    rest.forEach((c, i) => (discountByLine[i] += c));
  }

  const net = defs.map((d, i) => d.gross - discountByLine[i]);
  const depositByLine = allocateCents(toCents(b.deposit_amount), net);

  return defs
    .map((d, i) => ({
      key: d.key,
      label: d.label,
      gross: fromCents(d.gross),
      discount: fromCents(discountByLine[i]),
      net: fromCents(net[i]),
      deposit: fromCents(depositByLine[i]),
      balance: fromCents(net[i] - depositByLine[i]),
    }))
    .filter((l) => l.gross !== 0);
}
