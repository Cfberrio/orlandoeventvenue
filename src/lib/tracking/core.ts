// Pure helpers for the first-party tracking layer. No browser APIs beyond
// crypto.randomUUID, so vitest covers them directly (see core.test.ts).

export const CONSENT_POLICY_VERSION = "2026-09-02";

export type ConsentPrefs = {
  /** Policy version the choice was made under. */
  v: string;
  /** ISO timestamp of the choice. */
  ts: string;
  preferences: boolean;
  analytics: boolean;
  advertising: boolean;
};

export function parseConsentCookie(raw: string | null | undefined): ConsentPrefs | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(decodeURIComponent(raw));
    if (!p || typeof p !== "object" || typeof p.v !== "string") return null;
    return {
      v: p.v,
      ts: typeof p.ts === "string" ? p.ts : "",
      preferences: p.preferences === true,
      analytics: p.analytics === true,
      advertising: p.advertising === true,
    };
  } catch {
    return null;
  }
}

export function serializeConsentCookie(p: ConsentPrefs): string {
  return encodeURIComponent(JSON.stringify(p));
}

/** Meta's documented first-party click-id cookie format. */
export function buildFbc(fbclid: string, nowMs: number): string {
  return `fb.1.${nowMs}.${fbclid}`;
}

// Everything the ad URLs carry. utm_term = Ad Set / GEO, utm_content =
// creative; the meta_* ids are the stable Meta object ids (names change
// mid-flight, ids never do), so reporting groups on the ids and labels with
// the names. gclid is here too: OEV runs Google Ads as well, and the same
// visitor row should record whichever channel actually brought the guest.
const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "meta_campaign_id",
  "meta_adset_id",
  "meta_ad_id",
  "meta_placement",
  "fbclid",
  "gclid",
] as const;

export function parseUtm(search: string): Record<string, string> | null {
  const params = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) utm[k] = v.slice(0, 200);
  }
  return Object.keys(utm).length ? utm : null;
}

/**
 * A touch counts as "paid/ad" (and may therefore overwrite last touch) when it
 * carries a Meta object id, a click id, or a paid utm_medium. A plain organic
 * or direct return never erases a previous paid touch, so the ad that actually
 * acquired the guest survives them coming back through Google later.
 */
export function isPaidTouch(utm: Record<string, string> | null | undefined): boolean {
  if (!utm) return false;
  if (utm.meta_ad_id || utm.meta_adset_id || utm.meta_campaign_id || utm.fbclid || utm.gclid) {
    return true;
  }
  const medium = (utm.utm_medium ?? "").toLowerCase();
  return medium.includes("paid") || medium === "cpc" || medium === "ppc";
}

export function randomId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}_${uuid.replace(/-/g, "")}`;
}

/* ---------------------------------------------------------------------------
 * Deterministic Meta dedup ids.
 *
 * MUST stay byte-identical to supabase/functions/_shared/meta-core.ts. The
 * browser Pixel sends one half of each conversion and the edge function sends
 * the other; Meta collapses them into a single action only because both carry
 * the same string. Change one side without the other and every conversion
 * doubles.
 * ------------------------------------------------------------------------ */

export function checkoutEventId(bookingId: string): string {
  return `evt_checkout_${bookingId}`;
}

export function bookingCreatedEventId(bookingId: string): string {
  return `evt_booking_${bookingId}`;
}

export function purchaseEventId(bookingId: string): string {
  return `evt_purchase_${bookingId}`;
}

export function leadEventId(leadId: string): string {
  return `evt_lead_${leadId}`;
}
