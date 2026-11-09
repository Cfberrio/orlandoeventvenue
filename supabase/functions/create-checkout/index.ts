import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { sendCheckoutStarted } from "../_shared/meta-capi.ts";
import { getFrontendUrl } from "../_shared/config.ts";
import {
  checkCouponForBooking,
  computeBookingPrice,
  feeCentsFor,
  priceMismatches,
  toCents,
  type BookingPrice,
} from "../_shared/booking-pricing.ts";
import {
  loadCoupon,
  loadPricingRates,
  logBookingEvent,
  sendBillingAlert,
} from "../_shared/billing-server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CheckoutRequest {
  bookingId: string;
  /** Ignored for the charge (kept for older booking pages); logged if it disagrees. */
  depositAmount?: number;
  customerEmail?: string;
  customerName?: string;
  eventDate: string;
  eventType: string;
  successUrl: string;
  cancelUrl: string;
  adConsent?: boolean | null;
  /** Meta Test Events code of a QA session (see docs/meta-tracking.md). */
  metaTestEventCode?: string | null;
}

// Only ever Meta's own "TEST<digits/letters>" shape. Whether the code is
// honored is decided in meta-capi.ts against META_TEST_EVENT_CODE.
const META_TEST_CODE_RE = /^TEST[A-Z0-9]{1,32}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRIPE_MIN_CENTS = 50;

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

/** Only redirect back to our own site (protects against open redirects). */
function safeReturnUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const allowed =
      host === "orlandoeventvenue.org" ||
      host === "www.orlandoeventvenue.org" ||
      host.endsWith(".lovable.app") ||
      host.endsWith(".lovableproject.com") ||
      host.endsWith(".lovable.dev") ||
      host === "localhost";
    if (!allowed) return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("Stripe_Secret_Key");
    if (!stripeSecretKey) {
      console.error("Stripe_Secret_Key not found in environment");
      throw new Error("Stripe configuration error");
    }
    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    const body: CheckoutRequest = await req.json();
    const { bookingId, eventDate, eventType, adConsent, metaTestEventCode } = body;

    if (typeof bookingId !== "string" || !UUID_RE.test(bookingId)) {
      return json({ error: "INVALID_BOOKING", message: "Invalid booking reference." }, 400);
    }
    const fallbackReturn = `${getFrontendUrl()}/booking-confirmation`;
    const successUrl = safeReturnUrl(body.successUrl) ?? fallbackReturn;
    const cancelUrl = safeReturnUrl(body.cancelUrl) ?? fallbackReturn;

    const adConsentSnapshot = typeof adConsent === "boolean" ? adConsent : null;
    // Carried on the Stripe session so the webhook — which runs even if the
    // guest closes the tab — can send the QA Purchase to Test Events too.
    const metaTestCode =
      typeof metaTestEventCode === "string" && META_TEST_CODE_RE.test(metaTestEventCode.trim())
        ? metaTestEventCode.trim()
        : null;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // ------------------------------------------------------------------
    // 1. The booking as stored — the only source of the amount charged.
    // ------------------------------------------------------------------
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      console.error("[create-checkout] booking read failed:", bookingError.message);
      return json({ error: "TEMPORARY", message: "We couldn't load your booking. Please try again." }, 500);
    }
    if (!booking) {
      return json({ error: "INVALID_BOOKING", message: "Booking not found." }, 404);
    }
    if (booking.status === "cancelled") {
      return json({ error: "BOOKING_CANCELLED", message: "This booking was cancelled." }, 409);
    }
    if (booking.payment_status !== "pending") {
      return json({ error: "ALREADY_PAID", message: "The deposit for this booking was already received." }, 409);
    }

    // ------------------------------------------------------------------
    // 2. Re-price it on the server and compare to what was stored.
    // ------------------------------------------------------------------
    const rates = await loadPricingRates(supabase);
    const storedCode = (booking.discount_code || "").trim().toUpperCase();
    const coupon = storedCode ? await loadCoupon(supabase, storedCode) : null;

    const couponProblem = !storedCode
      ? null
      : !coupon
        ? "code_not_found"
        : !coupon.is_active
          ? "code_inactive"
          : !checkCouponForBooking(coupon, booking.booking_type).ok
            ? "code_not_for_booking_type"
            : null;

    const priceInput = {
      bookingType: booking.booking_type,
      startTime: booking.start_time,
      endTime: booking.end_time,
      package: booking.package,
      packageStartTime: booking.package_start_time,
      packageEndTime: booking.package_end_time,
      setupBreakdown: booking.setup_breakdown,
      tablecloths: booking.tablecloths,
      tableclothQuantity: booking.tablecloth_quantity,
      barSubtotal: Number(booking.bar_subtotal ?? 0),
      barLabel: booking.bar_package_label,
    };

    let price: BookingPrice = computeBookingPrice(priceInput, rates, couponProblem ? null : coupon);
    let mismatches = couponProblem ? [couponProblem] : priceMismatches(booking, price);

    // Booking pages published before this release rounded percent discounts to
    // whole dollars. Accept that variant so nobody is blocked mid-rollout.
    if (!couponProblem && mismatches.length > 0 && coupon?.discount_type === "percentage") {
      const legacy = computeBookingPrice(priceInput, rates, coupon, { legacyWholeDollarPercent: true });
      if (priceMismatches(booking, legacy).length === 0) {
        price = legacy;
        mismatches = [];
      }
    }

    if (mismatches.length > 0) {
      const detail = {
        mismatches,
        stored: {
          total_amount: booking.total_amount,
          deposit_amount: booking.deposit_amount,
          discount_code: booking.discount_code,
          discount_amount: booking.discount_amount,
        },
        expected: {
          total_amount: price.total,
          deposit_amount: price.deposit,
          discount_amount: price.discount?.amount ?? 0,
        },
      };
      console.error("[create-checkout] price mismatch, checkout refused:", bookingId, JSON.stringify(detail));
      await logBookingEvent(supabase, bookingId, "checkout_price_mismatch", detail);
      await sendBillingAlert(`Checkout blocked: price mismatch on ${booking.reservation_number || bookingId}`, [
        ["Booking", `${booking.reservation_number || ""} (${bookingId})`],
        ["Customer", `${booking.full_name || ""} <${booking.email || ""}>`],
        ["Fields", mismatches.join(", ")],
        ["Stored total / deposit", `$${booking.total_amount} / $${booking.deposit_amount}`],
        ["Expected total / deposit", `$${price.total} / $${price.deposit}`],
        ["Discount code", booking.discount_code || "none"],
        ["What happened", "Nothing was charged. The guest was asked to review their booking. Prices or the code may have changed while they were booking, or the request was altered."],
      ]);
      const message = couponProblem
        ? "The discount code on this booking is no longer valid. Please go back, remove it and review your total."
        : "Our prices were just updated. Please go back one step to review your total before paying.";
      return json({ error: couponProblem ? "DISCOUNT_INVALID" : "PRICE_CHANGED", message }, 409);
    }

    const depositAmountCents = toCents(price.deposit);
    if (depositAmountCents < STRIPE_MIN_CENTS) {
      await logBookingEvent(supabase, bookingId, "checkout_below_minimum", { deposit: price.deposit, total: price.total });
      return json({
        error: "AMOUNT_TOO_LOW",
        message: "This booking's deposit is under $0.50, so it can't be paid online. Please contact us at (407) 974-5979 to confirm it.",
      }, 409);
    }

    if (typeof body.depositAmount === "number" && toCents(body.depositAmount) !== depositAmountCents) {
      console.warn(`[create-checkout] client deposit ${body.depositAmount} ignored; charging stored ${price.deposit} (${bookingId})`);
      await logBookingEvent(supabase, bookingId, "checkout_client_amount_ignored", {
        client_deposit: body.depositAmount,
        charged_deposit: price.deposit,
      });
    }

    // ------------------------------------------------------------------
    // 3. Stripe session for exactly the verified deposit + fee.
    // ------------------------------------------------------------------
    const FEE_PCT = Number(rates.processing_fee);
    const FEE_LABEL = `Processing Fee (${FEE_PCT}%)`;
    const feeCents = feeCentsFor(depositAmountCents, FEE_PCT);
    const totalChargeCents = depositAmountCents + feeCents;
    console.log(`Deposit: base=${depositAmountCents}c, fee=${feeCents}c (${FEE_PCT}%), total=${totalChargeCents}c`);

    const customerEmail = booking.email;
    const customerName = booking.full_name;
    const existingCustomers = await stripe.customers.list({ email: customerEmail, limit: 1 });
    let customerId: string;
    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
    } else {
      const newCustomer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: { booking_id: bookingId },
      });
      customerId = newCustomer.id;
    }

    const connectedAccountId = Deno.env.get("STRIPE_CONNECTED_ACCOUNT_ID");
    const displayDate = typeof eventDate === "string" && eventDate ? eventDate : booking.event_date;
    const displayType = typeof eventType === "string" && eventType ? eventType : booking.event_type || "Event";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: bookingId,
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Event Venue Deposit - ${displayType}`,
              description: `50% deposit for event on ${displayDate}. Booking ID: ${bookingId.slice(0, 8).toUpperCase()}`,
            },
            unit_amount: depositAmountCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: { name: FEE_LABEL },
            unit_amount: feeCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
      cancel_url: `${cancelUrl}?cancelled=true&booking_id=${bookingId}`,
      metadata: {
        booking_id: bookingId,
        bookingId: bookingId,
        payment_type: "deposit",
        expected_total_cents: String(totalChargeCents),
        ...(adConsentSnapshot !== null ? { ad_consent: String(adConsentSnapshot) } : {}),
        ...(metaTestCode ? { meta_test_event_code: metaTestCode } : {}),
      },
      payment_intent_data: {
        metadata: {
          booking_id: bookingId,
          payment_type: "deposit",
        },
        setup_future_usage: "off_session",
        ...(connectedAccountId ? {
          transfer_data: {
            destination: connectedAccountId,
            amount: Math.round(depositAmountCents * 0.20),
          },
        } : {}),
      },
    });

    console.log("Checkout session created:", session.id);

    // ------------------------------------------------------------------
    // 4. Persist the expected charge and the price snapshot. If either fails,
    //    the session is expired so nobody pays against an unrecorded price.
    // ------------------------------------------------------------------
    const abort = async (why: string) => {
      console.error(`[create-checkout] ${why}; expiring session ${session.id}`);
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (e) {
        console.error("[create-checkout] could not expire session:", e);
      }
      return json({ error: "TEMPORARY", message: "We couldn't start the payment. Please try again in a moment." }, 500);
    };

    const { data: claimed, error: feeUpdateError } = await supabase
      .from("bookings")
      .update({
        processing_fee_pct: FEE_PCT,
        deposit_fee: feeCents / 100,
        deposit_total_charged: totalChargeCents / 100,
        ...(adConsentSnapshot !== null ? { ad_consent: adConsentSnapshot } : {}),
      })
      .eq("id", bookingId)
      .eq("payment_status", "pending")
      .neq("status", "cancelled")
      .select("id");
    if (feeUpdateError) return await abort(`fee persist failed: ${feeUpdateError.message}`);
    // Zero rows = the booking was paid or cancelled while this session was being
    // created. Never leave a payable session behind in that case.
    if (!claimed || claimed.length === 0) {
      console.warn(`[create-checkout] booking ${bookingId} no longer pending; expiring ${session.id}`);
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (e) {
        console.error("[create-checkout] could not expire session:", e);
      }
      return json({ error: "ALREADY_PAID", message: "The deposit for this booking was already received." }, 409);
    }

    const { error: snapshotError } = await supabase.from("booking_price_snapshots").insert({
      booking_id: bookingId,
      reason: "checkout",
      coupon_id: coupon && !couponProblem ? coupon.id : null,
      discount_code: price.discount?.code ?? null,
      discount_type: price.discount?.type ?? null,
      discount_value: price.discount?.value ?? null,
      discount_applies_to: price.discount?.appliesTo ?? null,
      discount_eligible_base: price.discount?.eligibleBase ?? null,
      discount_amount: price.discount?.amount ?? 0,
      gross_subtotal: price.grossSubtotal,
      total_amount: price.total,
      deposit_amount: price.deposit,
      balance_amount: price.balance,
      processing_fee_pct: FEE_PCT,
      deposit_fee: feeCents / 100,
      deposit_total_charged: totalChargeCents / 100,
      lines: price.lines,
      pricing_rates: rates,
      note: `stripe_session=${session.id}`,
      created_by: "create-checkout",
    });
    if (snapshotError) return await abort(`snapshot insert failed: ${snapshotError.message}`);

    // Only one payable deposit link per booking: a guest who went back and
    // re-entered checkout (or double-clicked) must not be able to pay twice.
    try {
      const open = await stripe.checkout.sessions.list({ customer: customerId, status: "open", limit: 100 });
      for (const old of open.data) {
        // Only sessions OLDER than this one: with two concurrent checkouts the
        // newest always survives instead of both expiring each other.
        if (
          old.id !== session.id &&
          old.created <= session.created &&
          old.metadata?.booking_id === bookingId &&
          old.metadata?.payment_type === "deposit"
        ) {
          try {
            await stripe.checkout.sessions.expire(old.id);
            console.log("[create-checkout] expired previous deposit session:", old.id);
          } catch (e) {
            console.error("[create-checkout] could not expire previous session:", old.id, e);
          }
        }
      }
    } catch (e) {
      console.error("[create-checkout] could not list open sessions:", e);
    }

    // Meta InitiateCheckout, server half. Deliberately AFTER the fee update so
    // the reported value is the amount actually being charged. The event id is
    // derived from the booking id, so re-entering checkout for the same
    // booking is deduplicated by Meta rather than counted twice.
    // Never allowed to break checkout: a missed ad event is recoverable, a
    // customer who cannot pay is not.
    try {
      await sendCheckoutStarted(bookingId, adConsentSnapshot, metaTestCode);
    } catch {
      console.error("[create-checkout] Meta InitiateCheckout failed", bookingId);
    }

    return json({ sessionId: session.id, url: session.url });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error creating checkout session:", errorMessage);
    return json({ error: "TEMPORARY", message: "We couldn't start the payment. Please try again in a moment." }, 500);
  }
});
