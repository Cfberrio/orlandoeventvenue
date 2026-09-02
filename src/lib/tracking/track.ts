// Ships internal funnel events to the track-event edge function, which owns
// every DB write (service role) and mirrors Lead / CompleteRegistration to
// Meta CAPI.
//
// Fire-and-forget by design: tracking must never block, delay or break a
// booking. Every failure path here ends in a swallowed promise.
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "./config";
import { analyticsAllowed, getConsent, type ConsentAction, type ConsentPrefs } from "./consent";
import { getAnonymousId, getSessionId, visitorSnapshot } from "./identity";

export type TrackExtra = {
  event_id?: string;
  /** Set to mirror this event to Meta CAPI server-side (same event_id). */
  meta?: "Lead" | "CompleteRegistration";
  props?: Record<string, unknown>;
  /** Identity anchors — what stitches this browser to a real person. */
  booking_id?: string | null;
  lead_id?: string | null;
  email?: string | null;
  custom_data?: Record<string, unknown>;
};

async function post(body: Record<string, unknown>): Promise<void> {
  await fetch(`${SUPABASE_URL}/functions/v1/track-event`, {
    method: "POST",
    // Survives the redirect to Stripe. Without it the browser cancels the
    // request mid-flight and the checkout event is lost exactly when it
    // matters most.
    keepalive: true,
    headers: {
      "content-type": "application/json",
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
}

export function track(name: string, extra: TrackExtra = {}): void {
  if (typeof window === "undefined" || !analyticsAllowed()) return;
  const anonymous_id = getAnonymousId();
  if (!anonymous_id) return;

  const { booking_id, lead_id, email, ...event } = extra;
  const body = {
    anonymous_id,
    session_id: getSessionId(),
    page_url: window.location.href.slice(0, 500),
    referrer: document.referrer ? document.referrer.slice(0, 500) : null,
    visitor: visitorSnapshot(),
    consent: getConsent(),
    // Envelope-level anchors: written onto the visitor row so they persist
    // across every later event from this browser, not just this one.
    booking_id: booking_id ?? null,
    lead_id: lead_id ?? null,
    email: email ?? null,
    events: [{ name, booking_id, lead_id, email, ...event }],
  };
  void post(body).catch(() => {});
}

/** Consent choices are always logged for the audit trail, even a rejection. */
export function recordConsent(prefs: ConsentPrefs, action: ConsentAction): void {
  if (typeof window === "undefined") return;
  const body = {
    anonymous_id: getAnonymousId(),
    page_url: window.location.href.slice(0, 500),
    consent: { ...prefs, action },
    events: [],
  };
  void post(body).catch(() => {});
}
