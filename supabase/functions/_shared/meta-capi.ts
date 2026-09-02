// Meta Conversions API delivery + the server-confirmed conversion flows.
//
// Every send is journaled in meta_event_delivery with a UNIQUE meta_event_id,
// so a Stripe webhook retry or a double-submit can never double-send. Without
// the META_PIXEL_ID + META_CAPI_TOKEN secrets everything degrades to a logged
// no-op — safe to deploy before the Meta assets exist.
//
// Ported from Discipline Rift; re-anchored on bookings.id.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { getFrontendUrl } from "./config.ts";
import {
  buildServerEvent,
  checkoutEventId,
  conversionValue,
  hashedUserData,
  pickMatchSignals,
  purchaseEventId,
  splitFullName,
  type MatchSignals,
  type MetaUserData,
  type VisitorSignals,
} from "./meta-core.ts";

const GRAPH_VERSION = "v23.0";

function sourceUrl(path = "/book"): string {
  return `${getFrontendUrl()}${path}`;
}

function db() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false } },
  );
}

export function metaEnv() {
  return {
    pixelId: Deno.env.get("META_PIXEL_ID") ?? "",
    token: Deno.env.get("META_CAPI_TOKEN") ?? "",
    // QA only. Set it to see events land in Events Manager > Test Events,
    // then REMOVE it — while it is set, events do not count as conversions.
    testCode: Deno.env.get("META_TEST_EVENT_CODE") ?? "",
  };
}

export type DeliveryStatus = "sent" | "duplicate" | "skipped_no_secrets" | "error";

/**
 * Post one server event to Meta, journaling the attempt first.
 *
 * The insert into meta_event_delivery happens BEFORE the network call and its
 * error is checked: claiming the UNIQUE meta_event_id is what makes this
 * idempotent. A concurrent caller loses the race with 23505 and returns
 * "duplicate" without posting. Only a previous hard failure is ever retried.
 */
export async function deliverMetaEvent(opts: {
  eventName: string;
  eventId: string;
  eventTimeSec?: number;
  sourceUrl?: string | null;
  userData: MetaUserData;
  customData?: Record<string, unknown>;
  bookingId?: string | null;
  leadId?: string | null;
  value?: number | null;
  currency?: string | null;
}): Promise<DeliveryStatus> {
  const database = db();
  const eventTimeSec = opts.eventTimeSec ?? Math.floor(Date.now() / 1000);

  const { error: insErr } = await database.from("meta_event_delivery").insert({
    meta_event_id: opts.eventId,
    event_name: opts.eventName,
    booking_id: opts.bookingId ?? null,
    lead_id: opts.leadId ?? null,
    status: "pending",
    event_time: new Date(eventTimeSec * 1000).toISOString(),
    value: opts.value ?? null,
    currency: opts.currency ?? null,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      const { data: existing } = await database
        .from("meta_event_delivery")
        .select("status")
        .eq("meta_event_id", opts.eventId)
        .maybeSingle();
      // Only a previous hard failure gets retried; anything else is a dup.
      if (existing && existing.status !== "error" && existing.status !== "skipped_no_secrets") {
        return "duplicate";
      }
    } else {
      // A journal we cannot write is a journal we cannot trust. Refusing to
      // send is the safe failure: a missed conversion is recoverable, a
      // silently double-counted Purchase is not.
      console.error("[meta-capi] journal insert failed", opts.eventId, insErr);
      throw insErr;
    }
  }

  const patch = async (fields: Record<string, unknown>) => {
    const { error } = await database
      .from("meta_event_delivery")
      .update({ ...fields, updated_at: new Date().toISOString() })
      .eq("meta_event_id", opts.eventId);
    if (error) console.error("[meta-capi] journal update failed", opts.eventId, error);
  };

  const { pixelId, token, testCode } = metaEnv();
  if (!pixelId || !token) {
    await patch({ status: "skipped_no_secrets" });
    console.warn("[meta-capi] secrets missing — event journaled, not sent", opts.eventId);
    return "skipped_no_secrets";
  }

  const event = buildServerEvent({
    eventName: opts.eventName,
    eventId: opts.eventId,
    eventTimeSec,
    sourceUrl: opts.sourceUrl ?? sourceUrl(),
    userData: opts.userData,
    customData: opts.customData,
  });
  const body: Record<string, unknown> = { data: [event] };
  if (testCode) body.test_event_code = testCode;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = await res.json().catch(() => ({}));
    await patch({
      status: res.ok ? "sent" : "error",
      attempts: 1,
      request: { ...event, user_data: undefined }, // hashes stay out of the logs
      response: json,
      error: res.ok ? null : JSON.stringify(json).slice(0, 2000),
    });
    if (!res.ok) console.error("[meta-capi] graph error", opts.eventId, json);
    return res.ok ? "sent" : "error";
  } catch (e) {
    await patch({ status: "error", attempts: 1, error: String(e).slice(0, 2000) });
    console.error("[meta-capi] network error", opts.eventId, e);
    return "error";
  }
}

/**
 * Standalone Lead, for a form that writes no DB row of its own (the website
 * contact form). The browser mints `eventId`, fires the Pixel half with it and
 * passes it here, so the two halves deduplicate exactly as the booking events
 * do.
 *
 * Called only AFTER the caller's honeypot and validation have passed — that is
 * what keeps a bot from writing into the ad account.
 */
export async function sendLead(opts: {
  eventId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  contentName?: string;
  sourcePath?: string;
}): Promise<void> {
  const { firstName, lastName } = splitFullName(opts.fullName);
  const userData = await hashedUserData({
    email: opts.email,
    phone: opts.phone,
    firstName,
    lastName,
    city: "Orlando",
    state: "FL",
    country: "us",
  });

  await deliverMetaEvent({
    eventName: "Lead",
    eventId: opts.eventId,
    sourceUrl: sourceUrl(opts.sourcePath ?? "/#contact"),
    userData,
    customData: {
      content_name: opts.contentName ?? "Contact Form",
      content_category: "contact",
    },
  });
}

/* ============================================================================
 * Booking-anchored conversions (CompleteRegistration, InitiateCheckout,
 * Purchase).
 *
 * All three derive their event id from bookings.id, so the whole chain is
 * idempotent: a Stripe webhook retry, a success-page reload or a re-entered
 * checkout all recompute the same id and the UNIQUE meta_event_id blocks the
 * resend.
 *
 * PRIVACY: the payload carries the guest's contact identifiers (hashed),
 * browser identifiers, the amount, and the event type / guest count of the
 * booking. It never carries the signature, the initials, the signed contract
 * text, internal notes, or card data.
 * ==========================================================================*/

type BookingContext = {
  id: string;
  reservationNumber: string | null;
  eventType: string | null;
  eventDate: string | null;
  bookingType: string | null;
  numberOfGuests: number | null;
  totalAmount: number | null;
  depositAmount: number | null;
  depositTotalCharged: number | null;
  depositPaidAt: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
};

async function loadBooking(bookingId: string): Promise<BookingContext | null> {
  const { data } = await db()
    .from("bookings")
    .select(
      "id,reservation_number,event_type,event_type_other,event_date,booking_type,number_of_guests,total_amount,deposit_amount,deposit_total_charged,deposit_paid_at,full_name,email,phone",
    )
    .eq("id", bookingId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Record<string, unknown>;
  const eventType =
    (row.event_type as string) === "other" && row.event_type_other
      ? (row.event_type_other as string)
      : ((row.event_type as string) ?? null);
  return {
    id: String(row.id),
    reservationNumber: (row.reservation_number as string) ?? null,
    eventType,
    eventDate: (row.event_date as string) ?? null,
    bookingType: (row.booking_type as string) ?? null,
    numberOfGuests: (row.number_of_guests as number) ?? null,
    totalAmount: (row.total_amount as number) ?? null,
    depositAmount: (row.deposit_amount as number) ?? null,
    depositTotalCharged: (row.deposit_total_charged as number) ?? null,
    depositPaidAt: (row.deposit_paid_at as string) ?? null,
    fullName: (row.full_name as string) ?? null,
    email: (row.email as string) ?? null,
    phone: (row.phone as string) ?? null,
  };
}

/**
 * How many of a guest's visitor rows to consider. One accumulates per browser
 * context (Instagram in-app, Safari, the Stripe return); a dozen is far past
 * any real case and keeps the query bounded.
 */
const VISITOR_ROWS = 12;

/**
 * Browser-side match signals for this guest, assembled across ALL their
 * visitor rows rather than read off the newest one — see pickMatchSignals.
 *
 * Rows are found by booking id OR by email: OEV has no guest login, so the
 * email is the only thing that ties "clicked the ad on Instagram Monday" to
 * "booked from a laptop Thursday". `notAfter` is the moment of the event being
 * reported, so a click that happened after the booking can never be sent as if
 * it caused it.
 */
async function matchSignals(
  bookingId: string,
  email: string | null,
  notAfter: Date,
): Promise<MatchSignals> {
  const filters = [`booking_id.eq.${bookingId}`];
  const normalized = (email ?? "").trim().toLowerCase();
  // Commas and parens would break PostgREST's `or` filter grammar; a real
  // address contains neither, so a hit here means malformed input to skip.
  if (normalized && !/[(),]/.test(normalized)) filters.push(`email.eq.${normalized}`);

  const { data, error } = await db()
    .from("tracking_visitor")
    .select("id,fbp,fbc,last_ip,last_user_agent,first_touch_at,first_seen_at")
    .or(filters.join(","))
    .order("last_seen_at", { ascending: false })
    .limit(VISITOR_ROWS);
  if (error) console.warn("[meta-capi] visitor lookup failed", bookingId, error);
  return pickMatchSignals((data ?? []) as VisitorSignals[], notAfter);
}

/** custom_data shared by the booking conversions. */
function conversionCustomData(ctx: BookingContext, value: number): Record<string, unknown> {
  const eventType = ctx.eventType ?? "Event";
  const dayType = ctx.bookingType === "daily" ? "Full Day" : "Hourly";
  return {
    value,
    currency: "USD",
    content_type: "product",
    content_ids: [ctx.id],
    content_name: `${eventType} — ${dayType}`,
    content_category: eventType,
    num_items: 1,
    // Contract value alongside the reported deposit, so Ads Manager custom
    // reporting can see the real ticket size without inflating the conversion.
    contract_total: ctx.totalAmount ?? undefined,
    guests: ctx.numberOfGuests ?? undefined,
  };
}

async function bookingUserData(
  ctx: BookingContext,
  signals: MatchSignals,
): Promise<MetaUserData> {
  const { firstName, lastName } = splitFullName(ctx.fullName);
  return await hashedUserData({
    email: ctx.email,
    phone: ctx.phone,
    firstName,
    lastName,
    // Every OEV booking happens at the one venue in Orlando, FL. This is a
    // fact about the business, not a guess about the guest, and it lifts match
    // quality materially on a small dataset.
    city: "Orlando",
    state: "FL",
    country: "us",
    externalId: ctx.id,
    ...signals,
  });
}

// CompleteRegistration has no function here on purpose. It is sent by
// track-event's mirror, which already verifies the bookings row exists and
// reads the contact details from it — a second server path would be a second
// thing to keep in sync for no gain.

/**
 * The Stripe Checkout Session really exists → InitiateCheckout, server half.
 * Called by create-checkout right after the session is created. The event id
 * is the same one the browser Pixel sends, so re-entering checkout for the
 * same booking never inflates the metric.
 */
export async function sendCheckoutStarted(bookingId: string): Promise<void> {
  const ctx = await loadBooking(bookingId);
  if (!ctx) return;

  const value = conversionValue(ctx.depositTotalCharged, ctx.depositAmount);
  // The checkout is happening now, so every visit already on file predates it.
  const signals = await matchSignals(ctx.id, ctx.email, new Date());

  await deliverMetaEvent({
    eventName: "InitiateCheckout",
    eventId: checkoutEventId(ctx.id),
    userData: await bookingUserData(ctx, signals),
    customData: conversionCustomData(ctx, value),
    bookingId: ctx.id,
    value,
    currency: "USD",
  });
}

/**
 * Called exactly once per real deposit, from the stripe-webhook branch that
 * flipped payment_status to 'deposit_paid'. That DB transition is the only
 * thing that proves money moved.
 *
 * Value = the deposit actually charged (base + processing fee), matching the
 * GA4 purchase event. The balance payment and add-on invoices deliberately do
 * NOT send a second Purchase: one booking is one conversion, or every channel
 * would look twice as efficient as it is.
 *
 * Also writes the internal payment_confirmed ledger row, which is first-party
 * truth and independent of whether Meta is configured at all.
 */
export async function sendPurchase(bookingId: string): Promise<void> {
  const database = db();
  const ctx = await loadBooking(bookingId);
  if (!ctx) return;

  const value = conversionValue(ctx.depositTotalCharged, ctx.depositAmount);
  const eventId = purchaseEventId(ctx.id);

  // Internal ledger first — it must land even if Meta is unconfigured.
  const { error: ledgerErr } = await database.from("tracking_event").insert({
    event_name: "payment_confirmed",
    event_id: `int_${eventId}`,
    booking_id: ctx.id,
    email: ctx.email ? ctx.email.trim().toLowerCase() : null,
    props: {
      value,
      contract_total: ctx.totalAmount,
      event_type: ctx.eventType,
      booking_type: ctx.bookingType,
      guests: ctx.numberOfGuests,
      reservation_number: ctx.reservationNumber,
    },
  });
  // 23505 = this deposit was already journaled; anything else is a real fault.
  if (ledgerErr && (ledgerErr as { code?: string }).code !== "23505") {
    console.warn("[meta-capi] ledger insert failed", ctx.id, ledgerErr);
  }

  // Anchored on deposit_paid_at, not "now": someone who clicks an ad the day
  // AFTER paying must not have that click reported as the cause of the sale.
  const signals = await matchSignals(
    ctx.id,
    ctx.email,
    ctx.depositPaidAt ? new Date(ctx.depositPaidAt) : new Date(),
  );

  await deliverMetaEvent({
    eventName: "Purchase",
    eventId,
    userData: await bookingUserData(ctx, signals),
    customData: conversionCustomData(ctx, value),
    bookingId: ctx.id,
    value,
    currency: "USD",
  });
}
