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
  purchaseCustomData,
  splitFullName,
  type MatchSignals,
  type MetaUserData,
  type VisitorSignals,
} from "./meta-core.ts";

const GRAPH_VERSION = "v23.0";

/**
 * Hard ceiling on the Graph API call.
 *
 * sendCheckoutStarted and sendPurchase are awaited inside the payment path:
 * create-checkout blocks on it before handing the guest their Stripe URL, and
 * stripe-webhook blocks on it before acking Stripe. try/catch covers a Graph
 * API that FAILS; it does nothing for one that HANGS. Without this, a stalled
 * Meta request shows the guest "Failed to process payment" for a checkout
 * session that was in fact created, and delays the webhook ack past Stripe's
 * own timeout into a redelivery.
 *
 * An abort is journaled as 'error', which the 23505 branch above treats as
 * retryable — so the event is recoverable, while the sale never waits on Meta.
 */
const GRAPH_TIMEOUT_MS = 5000;

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

export type DeliveryStatus =
  | "sent"
  | "duplicate"
  | "skipped_no_secrets"
  | "skipped_consent"
  | "error";

const MAX_ATTEMPTS = 5;
const STALE_PENDING_MS = 10 * 60 * 1000;

type StoredRequest = { data: [ReturnType<typeof buildServerEvent>] };

function isStoredRequest(value: unknown): value is StoredRequest {
  if (!value || typeof value !== "object") return false;
  const data = (value as { data?: unknown }).data;
  return Array.isArray(data) && data.length === 1 && typeof data[0] === "object";
}

async function postMetaRequest(
  body: StoredRequest,
  pixelId: string,
  token: string,
  testCode: string,
): Promise<{ ok: boolean; response: unknown; error: string | null }> {
  const payload: Record<string, unknown> = { ...body };
  if (testCode) payload.test_event_code = testCode;

  try {
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
      },
    );
    const response = await res.json().catch(() => ({}));
    return {
      ok: res.ok,
      response,
      error: res.ok ? null : JSON.stringify(response).slice(0, 2000),
    };
  } catch (error) {
    return { ok: false, response: null, error: String(error).slice(0, 2000) };
  }
}

/**
 * Post one server event to Meta, journaling the attempt first.
 *
 * The insert into meta_event_delivery happens BEFORE the network call and its
 * error is checked: claiming the UNIQUE meta_event_id is what makes this
 * idempotent. A concurrent caller loses the race with 23505 and returns
 * "duplicate" without posting. Only an error or a >10-minute pending claim is
 * retried, and both paths use a conditional update before posting.
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
  /** null/undefined means the visitor has not answered and preserves sending. */
  adConsent?: boolean | null;
}): Promise<DeliveryStatus> {
  const database = db();
  const eventTimeSec = opts.eventTimeSec ?? Math.floor(Date.now() / 1000);
  const event = buildServerEvent({
    eventName: opts.eventName,
    eventId: opts.eventId,
    eventTimeSec,
    sourceUrl: opts.sourceUrl ?? sourceUrl(),
    userData: opts.userData,
    customData: opts.customData,
  });
  // Hashes are required for a real retry after the original isolate exits;
  // no raw contact or reservation details are stored in this payload.
  const request: StoredRequest = { data: [event] };
  let claimedRequest = request;
  const { pixelId, token, testCode } = metaEnv();
  const secretsAvailable = Boolean(pixelId && token);

  const { error: insErr } = await database.from("meta_event_delivery").insert({
    meta_event_id: opts.eventId,
    event_name: opts.eventName,
    booking_id: opts.bookingId ?? null,
    lead_id: opts.leadId ?? null,
    status: opts.adConsent === false
      ? "skipped_consent"
      : secretsAvailable
        ? "pending"
        : "skipped_no_secrets",
    event_time: new Date(eventTimeSec * 1000).toISOString(),
    value: opts.value ?? null,
    currency: opts.currency ?? null,
    attempts: opts.adConsent === false || !secretsAvailable ? 0 : 1,
    request: opts.adConsent === false ? null : request,
  });
  if (insErr) {
    if ((insErr as { code?: string }).code === "23505") {
      if (opts.adConsent === false) return "duplicate";
      const { data: existing, error: readError } = await database
        .from("meta_event_delivery")
        .select("status,attempts,updated_at,request")
        .eq("meta_event_id", opts.eventId)
        .maybeSingle();
      if (readError) throw readError;
      const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString();
      const retryable =
        secretsAvailable &&
        existing &&
        existing.attempts < MAX_ATTEMPTS &&
        isStoredRequest(existing.request) &&
        (existing.status === "error" ||
          existing.status === "skipped_no_secrets" ||
          (existing.status === "pending" && existing.updated_at < staleBefore));
      if (!retryable) {
        return !secretsAvailable && isStoredRequest(existing?.request)
          ? "skipped_no_secrets"
          : "duplicate";
      }
      claimedRequest = existing.request;

      const nextAttempts = existing.attempts + 1;
      let claim = database
        .from("meta_event_delivery")
        .update({
          status: "pending",
          attempts: nextAttempts,
          updated_at: new Date().toISOString(),
          error: null,
        })
        .eq("meta_event_id", opts.eventId)
        .eq("status", existing.status)
        .eq("attempts", existing.attempts);
      if (existing.status === "pending") claim = claim.lt("updated_at", staleBefore);
      const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
      if (claimError) throw claimError;
      if (!claimed) return "duplicate";
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

  if (opts.adConsent === false) {
    return "skipped_consent";
  }

  if (!pixelId || !token) {
    console.warn("[meta-capi] secrets missing — event journaled, not sent", opts.eventId);
    return "skipped_no_secrets";
  }

  const result = await postMetaRequest(claimedRequest, pixelId, token, testCode);
  await patch({
    status: result.ok ? "sent" : "error",
    response: result.response,
    error: result.error,
  });
  if (!result.ok) console.error("[meta-capi] delivery failed", opts.eventId, result.error);
  return result.ok ? "sent" : "error";
}

/** Retry failed or abandoned sends. Each row is claimed with an optimistic,
 * conditional UPDATE so overlapping cron invocations cannot both post it. */
export async function retryFailedMetaEvents(): Promise<{
  claimed: number;
  sent: number;
  failed: number;
}> {
  const { pixelId, token, testCode } = metaEnv();
  // Missing configuration is not a delivery attempt. Leave every row and its
  // counter untouched until a later cron sees both credentials available.
  if (!pixelId || !token) return { claimed: 0, sent: 0, failed: 0 };

  const database = db();
  const staleBefore = new Date(Date.now() - STALE_PENDING_MS).toISOString();
  const { data: rows, error } = await database
    .from("meta_event_delivery")
    .select("id,meta_event_id,booking_id,status,attempts,updated_at,request")
    .lt("attempts", MAX_ATTEMPTS)
    .not("request", "is", null)
    .or(
      `status.eq.error,status.eq.skipped_no_secrets,and(status.eq.pending,updated_at.lt.${staleBefore})`,
    )
    .order("updated_at", { ascending: true })
    .limit(20);
  if (error) throw error;

  const counts = { claimed: 0, sent: 0, failed: 0 };
  for (const row of rows ?? []) {
    if (!isStoredRequest(row.request)) continue;

    if (row.booking_id) {
      const ctx = await loadBooking(row.booking_id);
      if (ctx && await bookingAdConsent(ctx) === false) {
        let skip = database
          .from("meta_event_delivery")
          .update({
            status: "skipped_consent",
            request: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("status", row.status)
          .eq("attempts", row.attempts);
        if (row.status === "pending") skip = skip.lt("updated_at", staleBefore);
        const { error: skipError } = await skip;
        if (skipError) {
          console.error("[meta-capi] consent skip update failed", row.meta_event_id, skipError);
        }
        continue;
      }
    }

    const nextAttempts = row.attempts + 1;
    let claim = database
      .from("meta_event_delivery")
      .update({
        status: "pending",
        attempts: nextAttempts,
        updated_at: new Date().toISOString(),
        error: null,
      })
      .eq("id", row.id)
      .eq("status", row.status)
      .eq("attempts", row.attempts);
    if (row.status === "pending") claim = claim.lt("updated_at", staleBefore);
    const { data: claimed, error: claimError } = await claim.select("id").maybeSingle();
    if (claimError) {
      console.error("[meta-capi] retry claim failed", row.meta_event_id, claimError);
      continue;
    }
    if (!claimed) continue;
    counts.claimed += 1;

    const result = await postMetaRequest(row.request, pixelId, token, testCode);
    const { error: patchError } = await database
      .from("meta_event_delivery")
      .update({
        status: result.ok ? "sent" : "error",
        response: result.response,
        error: result.error,
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id)
      .eq("attempts", nextAttempts);
    if (patchError) console.error("[meta-capi] retry journal update failed", row.meta_event_id, patchError);
    if (result.ok) counts.sent += 1;
    else counts.failed += 1;
  }
  return counts;
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
  adConsent?: boolean | null;
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
    adConsent: opts.adConsent,
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
 * browser identifiers, and the amount. Reservation attributes stay internal.
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
  adConsent: boolean | null;
};

async function loadBooking(bookingId: string): Promise<BookingContext | null> {
  const { data } = await db()
    .from("bookings")
    .select(
      "id,reservation_number,event_type,event_type_other,event_date,booking_type,number_of_guests,total_amount,deposit_amount,deposit_total_charged,deposit_paid_at,full_name,email,phone,ad_consent",
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
    adConsent: typeof row.ad_consent === "boolean" ? row.ad_consent : null,
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

/** Latest explicit choice across browser contexts linked to this booking.
 * null means no banner answer is known and preserves the existing send. */
async function bookingAdConsent(ctx: BookingContext): Promise<boolean | null> {
  if (ctx.adConsent === false) return false;
  const filters = [`booking_id.eq.${ctx.id}`];
  const normalized = (ctx.email ?? "").trim().toLowerCase();
  if (normalized && !/[(),]/.test(normalized)) filters.push(`email.eq.${normalized}`);
  const { data, error } = await db()
    .from("tracking_visitor")
    .select("ad_consent")
    .or(filters.join(","))
    .not("ad_consent", "is", null)
    .order("consent_updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.warn("[meta-capi] consent lookup failed", ctx.id, error);
    return null;
  }
  return typeof data?.ad_consent === "boolean" ? data.ad_consent : ctx.adConsent;
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
export async function sendCheckoutStarted(
  bookingId: string,
  requestConsent?: boolean | null,
): Promise<void> {
  const ctx = await loadBooking(bookingId);
  if (!ctx) return;

  const value = conversionValue(ctx.depositTotalCharged, ctx.depositAmount);
  // The checkout is happening now, so every visit already on file predates it.
  const signals = await matchSignals(ctx.id, ctx.email, new Date());
  const storedConsent = await bookingAdConsent(ctx);
  // A persisted opt-out always wins. The request snapshot covers the small
  // race before track-event has stitched the just-created booking.
  const adConsent = storedConsent === false ? false : (storedConsent ?? requestConsent);

  await deliverMetaEvent({
    eventName: "InitiateCheckout",
    eventId: checkoutEventId(ctx.id),
    userData: await bookingUserData(ctx, signals),
    customData: purchaseCustomData(value),
    bookingId: ctx.id,
    value,
    currency: "USD",
    adConsent,
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
  const adConsent = await bookingAdConsent(ctx);

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
    customData: purchaseCustomData(value),
    bookingId: ctx.id,
    value,
    currency: "USD",
    adConsent,
  });
}
