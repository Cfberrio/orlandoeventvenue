// Consent state lives in a first-party cookie (oev_consent).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT THIS SITE ACTUALLY DOES — read before changing anything here
// ─────────────────────────────────────────────────────────────────────────────
// OEV captures first-party analytics and fires the Meta Pixel + Conversions
// API for EVERY visitor, regardless of what they choose in the banner. The
// choice is recorded (cookie + consent_record table) but it is not enforced.
// That is a deliberate product decision, taken 2026-09-02.
//
// Discipline Rift, which this implementation was ported from, does gate the
// Pixel behind an explicit advertising opt-in. OEV does not.
//
// The single switch below is the whole difference. Flip it to `true` and the
// "Essential only" button starts meaning what it says: the Pixel stops loading,
// _fbp/_fbc are purged on revoke, and the server mirror is skipped. Nothing
// else in the codebase needs to change.
//
// Why you might need to flip it: an "Essential only" button that does not
// suppress advertising cookies is, under CCPA/CPRA and the EU ePrivacy rules,
// a deceptive control — it is the specific pattern regulators fine for. If OEV
// starts taking real EU or California-resident traffic, or a client asks for a
// compliance statement, this is the line to change.
export const HONOR_AD_OPT_OUT = false;

import {
  CONSENT_POLICY_VERSION,
  parseConsentCookie,
  serializeConsentCookie,
  type ConsentPrefs,
} from "./core";

export type { ConsentPrefs };

const CONSENT_COOKIE = "oev_consent";
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
 * Advertising (Meta Pixel + CAPI). Always allowed on OEV unless
 * HONOR_AD_OPT_OUT is flipped on — see the header of this file.
 */
export function adsAllowed(): boolean {
  if (!HONOR_AD_OPT_OUT) return true;
  return getConsent()?.advertising === true;
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
