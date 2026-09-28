// Meta Test Events for ONE controlled browser session.
//
// Open the site with ?oev_test_event_code=TEST12345 (the code shown in Events
// Manager > Test Events) and this tab forwards that code to every server-side
// Meta send it triggers: Lead / CompleteRegistration (track-event),
// InitiateCheckout (create-checkout) and Purchase (stripe-webhook, via the
// Stripe session metadata). ?oev_test_event_code=off ends it; closing the tab
// ends it too, because it lives in sessionStorage.
//
// The browser only REQUESTS test mode. The server honors the code only when it
// equals the META_TEST_EVENT_CODE secret, so a visitor who guesses the
// parameter cannot move real conversions out of production reporting, and
// normal traffic never carries a code at all.
//
// This tags the SERVER half only. The browser Pixel half is tagged by Meta
// itself, and only when Events Manager > Test Events > "Open website" opened
// the tab. So a QA session must always be launched from there, with this
// parameter already in the URL; pasted into a plain tab, the browser events
// would count as real conversions (docs/META-PIXEL-CAPI-SETUP.md, 5.3).
const PARAM = "oev_test_event_code";
const STORAGE_KEY = "oev_meta_test_event_code";
const CODE_RE = /^TEST[A-Z0-9]{1,32}$/i;

/** Reads the URL once per page load; call early (TrackingRoot does). */
export function captureTestEventCode(search: string = window.location.search): void {
  if (typeof window === "undefined") return;
  const raw = new URLSearchParams(search).get(PARAM);
  if (raw === null) return;
  try {
    const code = raw.trim();
    if (code.toLowerCase() === "off" || !CODE_RE.test(code)) {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } else {
      window.sessionStorage.setItem(STORAGE_KEY, code);
    }
  } catch {
    /* storage blocked — test mode simply stays off */
  }
}

export function getTestEventCode(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const code = window.sessionStorage.getItem(STORAGE_KEY);
    return code && CODE_RE.test(code) ? code : null;
  } catch {
    return null;
  }
}
