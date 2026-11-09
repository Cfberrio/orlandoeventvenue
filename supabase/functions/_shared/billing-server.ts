// Server-side helpers shared by the payment functions (Deno only).
//
// Everything that decides an amount lives in booking-pricing.ts (pure, tested);
// this file only loads data, authorizes callers and raises alerts.

import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { isServiceRoleRequest } from "./internal-auth.ts";
import {
  buildPricingRates,
  type CouponTerms,
  type DiscountTarget,
  type PricingRates,
} from "./booking-pricing.ts";

// deno-lint-ignore no-explicit-any
type Supabase = any;

export const BILLING_ALERT_EMAIL = "orlandoglobalministries@gmail.com";

export type CallerKind = "service" | "ghl" | "admin";

/**
 * Who is calling? Service role (other edge functions), the GHL backend token
 * (crons, GHL workflows) or a signed-in admin (the admin panel). Anything else
 * returns null.
 */
export async function authorizeCaller(
  req: Request,
  supabase: Supabase,
  allowed: CallerKind[],
): Promise<CallerKind | null> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (allowed.includes("service") && isServiceRoleRequest(authHeader, serviceKey)) return "service";

  if (allowed.includes("ghl")) {
    const ghlToken = req.headers.get("x-ghl-backend-token");
    const expected = Deno.env.get("GHL_BACKEND_TOKEN");
    if (ghlToken && expected && ghlToken.length === expected.length && ghlToken === expected) return "ghl";
  }

  if (allowed.includes("admin") && authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (!token) return null;
    try {
      const { data: { user }, error } = await supabase.auth.getUser(token);
      if (error || !user) return null;
      const { data: roles, error: roleError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .limit(1);
      if (roleError || !roles || roles.length === 0) return null;
      return "admin";
    } catch {
      return null;
    }
  }
  return null;
}

/** Current active venue_pricing as rates. Throws if the table can't be read. */
export async function loadPricingRates(supabase: Supabase): Promise<PricingRates> {
  const { data, error } = await supabase
    .from("venue_pricing")
    .select("item_key, price, extra_fee")
    .eq("is_active", true);
  if (error) throw new Error(`venue_pricing read failed: ${error.message}`);
  return buildPricingRates(data ?? []);
}

export interface CouponRow extends CouponTerms {
  id: string;
  is_active: boolean;
}

/** Coupon by code, active or not (service role). */
export async function loadCoupon(supabase: Supabase, code: string | null | undefined): Promise<CouponRow | null> {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return null;
  const { data, error } = await supabase
    .from("discount_coupons")
    .select("id, code, discount_type, discount_value, applies_to, applies_to_hourly, applies_to_daily, is_active")
    .eq("code", clean)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`discount_coupons read failed: ${error.message}`);
  if (!data) return null;
  return {
    id: data.id,
    code: data.code,
    discount_type: data.discount_type,
    discount_value: Number(data.discount_value),
    applies_to: data.applies_to === "total" ? "total" : "base_rental",
    applies_to_hourly: !!data.applies_to_hourly,
    applies_to_daily: !!data.applies_to_daily,
    is_active: !!data.is_active,
  };
}

export interface PriceSnapshot {
  id: string;
  booking_id: string;
  reason: string;
  discount_code: string | null;
  discount_type: "percentage" | "fixed_amount" | null;
  discount_value: number | null;
  discount_applies_to: DiscountTarget | null;
  discount_amount: number;
  gross_subtotal: number;
  total_amount: number;
  deposit_amount: number;
  balance_amount: number;
  processing_fee_pct: number | null;
  deposit_fee: number | null;
  deposit_total_charged: number | null;
  lines: unknown;
  created_at: string;
}

/** Latest price snapshot of a booking, or null when none exists. */
export async function loadLatestSnapshot(supabase: Supabase, bookingId: string): Promise<PriceSnapshot | null> {
  const { data, error } = await supabase
    .from("booking_price_snapshots")
    .select("*")
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[billing] snapshot read failed:", error.message);
    return null;
  }
  if (!data) return null;
  return {
    ...data,
    discount_value: data.discount_value == null ? null : Number(data.discount_value),
    discount_amount: Number(data.discount_amount ?? 0),
    gross_subtotal: Number(data.gross_subtotal),
    total_amount: Number(data.total_amount),
    deposit_amount: Number(data.deposit_amount),
    balance_amount: Number(data.balance_amount),
    processing_fee_pct: data.processing_fee_pct == null ? null : Number(data.processing_fee_pct),
    deposit_fee: data.deposit_fee == null ? null : Number(data.deposit_fee),
    deposit_total_charged: data.deposit_total_charged == null ? null : Number(data.deposit_total_charged),
  };
}

/** Append a booking_events row; never throws. */
export async function logBookingEvent(
  supabase: Supabase,
  bookingId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  channel = "system",
): Promise<void> {
  try {
    const { error } = await supabase.from("booking_events").insert({
      booking_id: bookingId,
      event_type: eventType,
      channel,
      metadata,
    });
    if (error) console.error(`[billing] booking_events insert failed (${eventType}):`, error.message);
  } catch (e) {
    console.error(`[billing] booking_events insert threw (${eventType}):`, e);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Email the admin about a money problem that needs a human (amount mismatch,
 * double payment, payment on a cancelled booking). Never throws.
 */
export async function sendBillingAlert(subject: string, lines: Array<[string, string]>): Promise<void> {
  try {
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailPassword) {
      console.error("[billing] alert not sent (no Gmail credentials):", subject);
      return;
    }
    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
    });
    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const rows = lines
      .map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#555;"><b>${escapeHtml(k)}</b></td><td style="padding:4px 0;">${escapeHtml(v)}</td></tr>`)
      .join("");
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#dc2626;">${escapeHtml(subject)}</h2><table>${rows}</table><p style="color:#666;">${escapeHtml(timestamp)} ET. Automated billing alert: please review in Stripe and the admin panel. No money was moved automatically.</p></body></html>`;
    await client.send({
      from: `"OEV Billing Alert" <${gmailUser}>`,
      to: BILLING_ALERT_EMAIL,
      subject: `🚨 BILLING: ${subject}`,
      content: lines.map(([k, v]) => `${k}: ${v}`).join("\n"),
      html,
    });
    await client.close();
  } catch (e) {
    console.error("[billing] alert send failed:", subject, e);
  }
}

export type ReceiptKind = "deposit" | "balance";

export type ReceiptLookup =
  // deno-lint-ignore no-explicit-any
  | { ok: true; booking: any; snapshot: PriceSnapshot | null; via: "service" | "legacy" }
  | { ok: false; status: number; error: string };

/**
 * Resolve the booking a receipt email is about. Amounts, recipient and
 * reservation number ALWAYS come from the database, never from the request.
 *
 * - Service-role callers (stripe-webhook) send { booking_id }.
 * - Older stripe-webhook builds send the whole booking with the anon key; that
 *   is accepted only when reservation_number AND email match a real booking,
 *   so the endpoint can no longer send invented invoices to arbitrary people.
 */
export async function resolveReceiptBooking(
  req: Request,
  supabase: Supabase,
  kind: ReceiptKind,
): Promise<ReceiptLookup> {
  // deno-lint-ignore no-explicit-any
  let body: any;
  try {
    body = await req.json();
  } catch {
    return { ok: false, status: 400, error: "invalid_body" };
  }
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  const isService = isServiceRoleRequest(authHeader, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

  let booking = null;
  let via: "service" | "legacy";
  if (isService && typeof body?.booking_id === "string") {
    const { data, error } = await supabase.from("bookings").select("*").eq("id", body.booking_id).maybeSingle();
    if (error) return { ok: false, status: 500, error: "booking_read_failed" };
    booking = data;
    via = "service";
  } else if (typeof body?.reservation_number === "string" && typeof body?.email === "string") {
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("reservation_number", body.reservation_number.trim())
      .maybeSingle();
    if (error) return { ok: false, status: 500, error: "booking_read_failed" };
    if (!data || String(data.email || "").trim().toLowerCase() !== body.email.trim().toLowerCase()) {
      return { ok: false, status: 401, error: "unauthorized" };
    }
    booking = data;
    via = "legacy";
  } else {
    return { ok: false, status: 401, error: "unauthorized" };
  }

  if (!booking) return { ok: false, status: 404, error: "booking_not_found" };

  const paidEnough = kind === "deposit"
    ? booking.payment_status === "deposit_paid" || booking.payment_status === "fully_paid"
    : booking.payment_status === "fully_paid";
  if (!paidEnough) return { ok: false, status: 409, error: `payment_not_recorded:${booking.payment_status}` };

  const snapshot = await loadLatestSnapshot(supabase, booking.id);
  return { ok: true, booking, snapshot, via };
}
