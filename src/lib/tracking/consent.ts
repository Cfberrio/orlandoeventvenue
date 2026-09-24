// Consent state lives in a first-party cookie (oev_consent).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS SITE ACTUALLY DOES — read before changing anything here
// ─────────────────────────────────────────────────────────────────────────────
// OEV records the choice in both the cookie and consent_record. An explicit
// advertising opt-out gates Pixel and CAPI; an unanswered banner preserves the
// prior default and allows measurement.
export const HONOR_AD_OPT_OUT = true;

import {
  CONSENT_POLICY_VERSION,
  parseConsentCookie,
  serializeConsentCookie,
  type ConsentPrefs,
} from "./core";

export type { ConsentPrefs };

const CONSENT_COOKIE = "oev_consent";
const ANONYMOUS_ID_COOKIE = "oev_aid";
const ANONYMOUS_ID_RE = /^anon_[a-z0-9]{8,64}$/i;
const CHANGE_EVENT = "oev-consent-change";
const OPEN_EVENT = "oev-consent-open";

export type ConsentAction = "accept_all" | "reject_all" | "custom" | "revoke";

export function readCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? m[1] : null;
}

export function writeCookie(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=${value}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax; Secure`;
}

export function deleteCookie(name: string): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; path=/; max-age=0; SameSite=Lax; Secure`;
  // The Meta Pixel sets _fbp/_fbc on the eTLD+1 with a leading dot — clear
  // that variant too, or the "deleted" cookie comes straight back.
  const host = window.location.hostname.replace(/^www\./, "");
  document.cookie = `${name}=; path=/; domain=.${host}; max-age=0; SameSite=Lax; Secure`;
}

export function getConsent(): ConsentPrefs | null {
  return parseConsentCookie(readCookie(CONSENT_COOKIE));
}

/** Snapshot an existing identity before a rejection listener removes it. */
export function captureAnonymousId(): string | null {
  const id = readCookie(ANONYMOUS_ID_COOKIE);
  return id && ANONYMOUS_ID_RE.test(id) ? id : null;
}

/**
 * First-party analytics. Always allowed on OEV — the internal ledger is what
 * makes the funnel and the attribution reporting complete.
 */
export function analyticsAllowed(): boolean {
  if (!HONOR_AD_OPT_OUT) return true;
  const c = getConsent();
  return c ? c.analytics : true;
}

/**
 * Advertising (Meta Pixel + CAPI). Explicit opt-out disables it; an unknown
 * choice preserves the historical default.
 */
export function adsAllowed(): boolean {
  if (!HONOR_AD_OPT_OUT) return true;
  const consent = getConsent();
  // Until the visitor answers the banner, preserve the existing measurement
  // behavior. An explicit opt-out is the only state that disables ads.
  return consent ? consent.advertising : true;
}

export function setConsent(
  next: Pick<ConsentPrefs, "preferences" | "analytics" | "advertising">,
  action: ConsentAction,
): ConsentPrefs {
  const prefs: ConsentPrefs = {
    v: CONSENT_POLICY_VERSION,
    ts: new Date().toISOString(),
    ...next,
  };
  writeCookie(CONSENT_COOKIE, serializeConsentCookie(prefs), 365 * 24 * 3600);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: { prefs, action } }));
  }
  return prefs;
}

export function onConsentChange(
  cb: (detail: { prefs: ConsentPrefs; action: ConsentAction }) => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const handler = (e: Event) => cb((e as CustomEvent).detail);
  window.addEventListener(CHANGE_EVENT, handler);
  return () => window.removeEventListener(CHANGE_EVENT, handler);
}

/** Re-opens the banner in "manage" mode (footer "Cookie settings" link). */
export function openConsentManager(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

export function onConsentOpen(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(OPEN_EVENT, cb);
  return () => window.removeEventListener(OPEN_EVENT, cb);
}
