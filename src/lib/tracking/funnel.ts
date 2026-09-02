// Funnel-specific helpers. Each one fires the internal ledger event and, where
// there is a Meta twin, the browser Pixel event with a SHARED event id — so
// Pixel and CAPI deduplicate into a single action inside Meta.
//
// Lifecycle map (see docs/meta-tracking.md):
//   /book loaded              → book_landing_viewed        (internal)
//   booking type picked       → booking_started + ViewContent
//   contact step completed    → contact_info_completed     (internal)
//   bookings row persisted    → CompleteRegistration       (Pixel + CAPI)
//   Stripe session created    → InitiateCheckout           (Pixel; CAPI from create-checkout)
//   deposit cleared           → Purchase                   (Pixel; CAPI from stripe-webhook)
//   lead form submitted       → Lead                       (Pixel + CAPI)
//
// The server half is authoritative for InitiateCheckout and Purchase: only the
// edge functions know the amount actually charged, and a browser cannot be
// trusted to report a sale.
import {
  bookingCreatedEventId,
  checkoutEventId,
  leadEventId,
  purchaseEventId,
  randomId,
} from "./core";
import { pixelTrack } from "./pixel";
import { track } from "./track";

/* ---------------------------------------------------------------- discovery */

export function trackBookLandingViewed(typeParam?: string | null): void {
  track("book_landing_viewed", {
    props: typeParam ? { type_param: typeParam } : undefined,
  });
}

export function trackVirtualTourViewed(): void {
  track("virtual_tour_viewed");
}

export function trackTourPageViewed(): void {
  track("tour_page_viewed");
}

export function trackPlanningKitViewed(): void {
  track("planning_kit_viewed");
}

/* ------------------------------------------------------------------ booking */

// "Meaningfully began" milestone: the guest picked a booking type, not merely
// loaded /book. Once per tab, so a back-navigation does not re-count them.
const STARTED_KEY = "oev_booking_started";

function markBookingStarted(props: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  try {
    if (window.sessionStorage.getItem(STARTED_KEY)) return;
    window.sessionStorage.setItem(STARTED_KEY, "1");
  } catch {
    /* private mode — fall through and send once per page load */
  }
  track("booking_started", { props });
}

/**
 * Booking type chosen (hourly / full day) → ViewContent. This is the first
 * signal of real intent and the first thing Meta can build an audience on.
 */
export function trackBookingTypeSelected(bookingType: string, price?: number | null): void {
  const eventId = randomId("evt_vc");
  track("booking_type_selected", {
    event_id: eventId,
    props: { booking_type: bookingType, price: price ?? null },
  });
  pixelTrack(
    "ViewContent",
    {
      content_type: "product",
      content_ids: [bookingType],
      content_name: bookingType === "daily" ? "Full Day Rental" : "Hourly Rental",
      value: price ?? undefined,
      currency: price != null ? "USD" : undefined,
    },
    eventId,
  );
  markBookingStarted({ trigger: "booking_type_selected", booking_type: bookingType });
}

export function trackEventDetailsCompleted(details: {
  eventType?: string | null;
  guests?: number | null;
  eventDate?: string | null;
}): void {
  track("event_details_completed", {
    props: {
      event_type: details.eventType ?? null,
      guests: details.guests ?? null,
      event_date: details.eventDate ?? null,
    },
  });
}

export function trackAddonsSelected(props: Record<string, unknown>): void {
  track("addons_selected", { props });
}

export function trackSummaryViewed(total?: number | null): void {
  track("summary_viewed", { props: { total: total ?? null } });
}

export function trackContactInfoCompleted(email?: string | null): void {
  track("contact_info_completed", { email: email ?? null });
}

/**
 * The bookings row was persisted (step 6 submit, before payment) →
 * CompleteRegistration. Diagnostic funnel milestone only: the campaign
 * optimizes for Purchase, and a guest can create a booking and never pay.
 *
 * This is also the moment the anonymous browser is stitched to a real person:
 * booking_id + email go onto the visitor row, so a return from a different
 * device still resolves to the same guest.
 */
export function trackBookingCreated(
  bookingId: string,
  info: {
    email?: string | null;
    eventType?: string | null;
    bookingType?: string | null;
    depositTotal?: number | null;
    contractTotal?: number | null;
  },
): void {
  const eventId = bookingCreatedEventId(bookingId);
  const customData = {
    value: info.depositTotal ?? 0,
    currency: "USD",
    content_type: "product",
    content_ids: [bookingId],
    content_name: `${info.eventType ?? "Event"} — ${info.bookingType === "daily" ? "Full Day" : "Hourly"}`,
    content_category: info.eventType ?? undefined,
    status: true,
  };
  track("booking_created", {
    event_id: eventId,
    meta: "CompleteRegistration",
    booking_id: bookingId,
    email: info.email ?? null,
    custom_data: customData,
    props: {
      deposit_total: info.depositTotal ?? null,
      contract_total: info.contractTotal ?? null,
      event_type: info.eventType ?? null,
      booking_type: info.bookingType ?? null,
    },
  });
  pixelTrack("CompleteRegistration", customData, eventId);
}

/**
 * The Stripe Checkout Session really exists → InitiateCheckout, browser half.
 * The server half is sent by create-checkout with this same id, derived from
 * the booking, so re-entering checkout never inflates the metric.
 *
 * Fired immediately before window.location.href = checkoutData.url. That is
 * why track.ts posts with keepalive.
 */
export function trackCheckoutStarted(
  bookingId: string,
  amount: number,
  info: { email?: string | null; eventType?: string | null } = {},
): void {
  const eventId = checkoutEventId(bookingId);
  pixelTrack(
    "InitiateCheckout",
    {
      value: amount,
      currency: "USD",
      content_type: "product",
      content_ids: [bookingId],
      content_name: info.eventType ?? "Venue Deposit",
      num_items: 1,
    },
    eventId,
  );
  track("checkout_session_created", {
    booking_id: bookingId,
    email: info.email ?? null,
    props: { amount },
  });
  track("payment_redirected", { booking_id: bookingId });
}

/**
 * Browser half of Purchase, fired on /booking-confirmation ONLY after the
 * server confirmed the deposit. The authoritative half is the CAPI event sent
 * by stripe-webhook; both carry evt_purchase_<booking_id>, so Meta dedupes.
 * A localStorage guard keeps success-page reloads from re-firing at all.
 *
 * Balance and add-on payments land on the same page and must NOT call this —
 * one booking is one conversion.
 */
export function trackPurchase(
  bookingId: string,
  value: number,
  info: { email?: string | null; eventType?: string | null } = {},
): void {
  if (typeof window === "undefined") return;
  const key = `oev_meta_purchase_${bookingId}`;
  try {
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, "1");
  } catch {
    /* private mode — Meta still dedupes on event_id */
  }
  pixelTrack(
    "Purchase",
    {
      value,
      currency: "USD",
      content_type: "product",
      content_ids: [bookingId],
      content_name: info.eventType ?? "Venue Deposit",
      num_items: 1,
    },
    purchaseEventId(bookingId),
  );
  track("payment_confirmed_client", { booking_id: bookingId, email: info.email ?? null });
}

/* --------------------------------------------------------------------- leads */

/**
 * Event Planning Kit / PLAN50 popup lead → Lead.
 *
 * `leadId` is the popup_leads row id. track-event refuses to mirror a Lead to
 * Meta unless that row really exists, so a duplicate-email submission (which
 * inserts nothing) correctly reports no new Lead.
 */
export function trackPopupLead(leadId: string, email: string): void {
  const eventId = leadEventId(leadId);
  track("popup_lead_submitted", {
    event_id: eventId,
    meta: "Lead",
    lead_id: leadId,
    email,
    custom_data: { content_name: "Event Planning Kit", content_category: "lead_magnet" },
    props: { source: "website_popup" },
  });
  pixelTrack(
    "Lead",
    { content_name: "Event Planning Kit", content_category: "lead_magnet" },
    eventId,
  );
}

/**
 * Contact form → Lead. The contact form writes no DB row, so there is nothing
 * for track-event to verify; instead the browser mints the id, fires the Pixel
 * half with it, and hands the SAME id to send-contact-form, which sends the
 * CAPI half server-side after the honeypot and validation have passed.
 *
 * Returns the id so the caller can put it in the edge-function payload.
 */
export function trackContactFormLead(email: string, subject?: string | null): string {
  const eventId = randomId("evt_lead");
  track("lead_submitted", {
    event_id: eventId,
    email,
    props: { source: "contact_form", subject: subject ?? null },
  });
  pixelTrack("Lead", { content_name: "Contact Form", content_category: "contact" }, eventId);
  return eventId;
}
