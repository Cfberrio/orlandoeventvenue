// Anonymous first-party identity: the oev_aid cookie (browser) plus a per-tab
// session id. Neither ever contains personal data — the cookie is a random
// opaque token. Linkage to a real person happens server-side, when the guest
// reaches a step that produces a booking id, a lead id or an email.
import { buildFbc, parseUtm, randomId } from "./core";
import { analyticsAllowed, deleteCookie, readCookie, writeCookie } from "./consent";

const ANON_COOKIE = "oev_aid";
const SESSION_KEY = "oev_sid";

export function getAnonymousId(): string | null {
  if (typeof document === "undefined" || !analyticsAllowed()) return null;
  let id = readCookie(ANON_COOKIE);
  if (!id || !/^anon_[a-z0-9]{8,64}$/i.test(id)) id = randomId("anon");
  writeCookie(ANON_COOKIE, id, 400 * 24 * 3600); // refresh the 400-day window
  return id;
}

export function getSessionId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    let id = window.sessionStorage.getItem(SESSION_KEY);
    if (!id || !/^sess_[a-z0-9]{8,64}$/i.test(id)) {
      id = randomId("sess");
      window.sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage blocked. Sessions stop being stitched, events
    // still flow — degrade, never throw.
    return null;
  }
}

export function clearIdentity(): void {
  deleteCookie(ANON_COOKIE);
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export type VisitorPatch = {
  utm?: Record<string, string> | null;
  landing_page?: string;
  referrer?: string | null;
  fbp?: string | null;
  fbc?: string | null;
};

let attributionSent = false;

/**
 * UTM / click-id capture. The full attribution payload is sent once per page
 * load (it cannot change without a navigation); the Meta cookies are read on
 * every call, because the Pixel mints _fbp asynchronously and it may not exist
 * yet on the first event.
 */
export function visitorSnapshot(): VisitorPatch {
  if (typeof window === "undefined") return {};
  const snap: VisitorPatch = {
    fbp: readCookie("_fbp"),
    fbc: readCookie("_fbc"),
  };
  if (!attributionSent) {
    attributionSent = true;
    snap.utm = parseUtm(window.location.search);
    snap.landing_page = window.location.href.slice(0, 500);
    snap.referrer = document.referrer ? document.referrer.slice(0, 500) : null;
    // Persist the click id the way the Pixel would. This is THE key that ties
    // a booking days later back to the ad that paid for it, so it is written
    // on every ad click even when the Pixel script has not loaded yet.
    const fbclid = new URLSearchParams(window.location.search).get("fbclid");
    if (fbclid && !snap.fbc) {
      snap.fbc = buildFbc(fbclid, Date.now());
      writeCookie("_fbc", snap.fbc, 90 * 24 * 3600);
    }
  }
  return snap;
}

/** Test seam: lets a test exercise the once-per-load attribution branch. */
export function __resetAttributionForTests(): void {
  attributionSent = false;
}
