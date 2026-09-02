// Pure Meta Conversions API helpers — no Deno APIs, so vitest covers them
// directly (see supabase/functions/_tests/meta-core.test.ts). Hashing and
// normalization follow Meta's customer-information-parameter rules.
//
// Ported from Discipline Rift and re-anchored on the OEV funnel: every
// conversion id derives from bookings.id, which is what makes the whole chain
// idempotent against Stripe webhook retries and success-page reloads.
//
// What NEVER enters this module: card data, the signed contract text, the
// signature image, initials, or internal notes. Meta gets contact identifiers
// (hashed), browser identifiers, the amount, and the event type of the booking.

export type MetaUserData = {
  em?: string[];
  ph?: string[];
  fn?: string[];
  ln?: string[];
  zp?: string[];
  ct?: string[];
  st?: string[];
  country?: string[];
  external_id?: string[];
  client_ip_address?: string;
  client_user_agent?: string;
  fbp?: string;
  fbc?: string;
};

export type MetaServerEvent = {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: Record<string, unknown>;
};

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? "").trim().toLowerCase();
  return e.includes("@") ? e : null;
}

/** Digits only; a bare 10-digit US number gets the country code prepended. */
export function normalizePhone(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 7) return null;
  return digits.length === 10 ? `1${digits}` : digits;
}

export function normalizeName(name: string | null | undefined): string | null {
  const n = (name ?? "").trim().toLowerCase();
  return n ? n : null;
}

export function normalizeZip(zip: string | null | undefined): string | null {
  const z = (zip ?? "").trim().slice(0, 5);
  return /^\d{5}$/.test(z) ? z : null;
}

/**
 * OEV collects one `full_name` field, not first/last. Meta matches better on
 * fn+ln than on a single blob, so split on the first space: everything before
 * it is the first name, the remainder is the last name. A single word yields
 * a first name only, which is correct — an invented last name would hash to
 * garbage and lower match quality rather than raise it.
 */
export function splitFullName(
  fullName: string | null | undefined,
): { firstName: string | null; lastName: string | null } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type RawUserData = {
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  zip?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  externalId?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
};

/** The browser identifiers a tracking_visitor row can carry. */
export type VisitorSignals = {
  fbp?: string | null;
  fbc?: string | null;
  last_ip?: string | null;
  last_user_agent?: string | null;
  first_touch_at?: string | null;
  first_seen_at?: string | null;
};

export type MatchSignals = {
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  userAgent: string | null;
};

/**
 * Assemble the browser-side match signals for one guest out of ALL their
 * visitor rows.
 *
 * A guest owns several: `oev_aid` is per browser context, so the Instagram
 * in-app browser, Safari, and the row minted on the return from Stripe are
 * three different visitors — and only one of them ever carried the ad click.
 * Taking the newest row reliably picks the blank Stripe-return one and throws
 * the click id away, which is the single datum that proves a booking came from
 * an ad. So each signal comes from the newest row that actually has it.
 *
 * The two kinds of signal are NOT filtered alike, and the difference is the
 * whole point:
 *
 *   fbc — the ad click id. It asserts "this booking came from that click", so
 *     it is the one thing that could inflate attribution. `notAfter` drops it
 *     when the visit began after the event being reported: someone who clicks
 *     an ad the day AFTER paying their deposit must never have that click
 *     reported as the cause. A row with no timestamp cannot be shown to
 *     predate the booking, so it is out.
 *
 *   fbp / ip / user agent — identity, not attribution. They tell Meta WHO this
 *     is, they claim nothing about an ad, and the Stripe-return row that
 *     carries the freshest ones is minted seconds AFTER deposit_paid_at.
 *     Time-filtering them would throw away match quality for no honesty gained.
 *
 * `rows` must arrive newest-visit-first. Nothing here is invented: every value
 * returned was recorded on a real visit by this guest.
 */
export function pickMatchSignals(rows: VisitorSignals[], notAfter: Date): MatchSignals {
  const has = (v: string | null | undefined) => v != null && v !== "";
  const newest = (list: VisitorSignals[], key: keyof VisitorSignals): string | null =>
    list.find((r) => has(r[key]))?.[key] ?? null;

  const cutoff = notAfter.getTime();
  const predatesEvent = rows.filter((r) => {
    const started = r.first_touch_at ?? r.first_seen_at;
    if (!started) return false;
    const t = new Date(started).getTime();
    return Number.isFinite(t) && t <= cutoff;
  });

  return {
    fbc: newest(predatesEvent, "fbc"),
    fbp: newest(rows, "fbp"),
    clientIp: newest(rows, "last_ip"),
    userAgent: newest(rows, "last_user_agent"),
  };
}

/** Hash what Meta requires hashed; pass through what must stay raw. */
export async function hashedUserData(raw: RawUserData): Promise<MetaUserData> {
  const out: MetaUserData = {};
  const em = normalizeEmail(raw.email);
  if (em) out.em = [await sha256Hex(em)];
  const ph = normalizePhone(raw.phone);
  if (ph) out.ph = [await sha256Hex(ph)];
  const fn = normalizeName(raw.firstName);
  if (fn) out.fn = [await sha256Hex(fn)];
  const ln = normalizeName(raw.lastName);
  if (ln) out.ln = [await sha256Hex(ln)];
  const zp = normalizeZip(raw.zip);
  if (zp) out.zp = [await sha256Hex(zp)];
  const ct = normalizeName(raw.city);
  if (ct) out.ct = [await sha256Hex(ct.replace(/\s+/g, ""))];
  const st = normalizeName(raw.state);
  if (st) out.st = [await sha256Hex(st.replace(/\s+/g, ""))];
  const country = normalizeName(raw.country);
  if (country) out.country = [await sha256Hex(country)];
  if (raw.externalId) out.external_id = [await sha256Hex(String(raw.externalId))];
  if (raw.fbp) out.fbp = raw.fbp;
  if (raw.fbc) out.fbc = raw.fbc;
  if (raw.clientIp) out.client_ip_address = raw.clientIp;
  if (raw.userAgent) out.client_user_agent = raw.userAgent;
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The value OEV reports to Meta for a conversion.
 *
 * It is the deposit ACTUALLY CHARGED (base deposit + processing fee), matching
 * what the GA4 `purchase` event already reports in src/lib/analytics.ts. Using
 * the full contract total here would double-count against the balance payment
 * and make every channel look twice as efficient as it is.
 *
 * `charged` is bookings.deposit_total_charged, which stripe-webhook writes from
 * Stripe's own amount_total; it falls back to deposit_amount for rows written
 * before the fee columns existed.
 */
export function conversionValue(
  charged: number | null | undefined,
  depositBase: number | null | undefined,
): number {
  const c = Number(charged);
  if (Number.isFinite(c) && c > 0) return round2(c);
  const d = Number(depositBase);
  return Number.isFinite(d) && d > 0 ? round2(d) : 0;
}

/* ---------------------------------------------------------------------------
 * Deterministic Meta dedup ids.
 *
 * Each derives from a business object, never from a random or a timestamp, so
 * a reload, a back-navigation, a Stripe webhook retry and a success-page
 * refresh all recompute the SAME id and Meta counts one action. These strings
 * MUST stay byte-identical to src/lib/tracking/core.ts — that is the entire
 * mechanism by which the browser Pixel and the server CAPI event deduplicate.
 * ------------------------------------------------------------------------ */

export function purchaseEventId(bookingId: string): string {
  return `evt_purchase_${bookingId}`;
}

export function checkoutEventId(bookingId: string): string {
  return `evt_checkout_${bookingId}`;
}

export function bookingCreatedEventId(bookingId: string): string {
  return `evt_booking_${bookingId}`;
}

export function leadEventId(leadId: string): string {
  return `evt_lead_${leadId}`;
}

export function buildServerEvent(opts: {
  eventName: string;
  eventId: string;
  eventTimeSec?: number;
  sourceUrl?: string | null;
  userData: MetaUserData;
  customData?: Record<string, unknown>;
}): MetaServerEvent {
  const event: MetaServerEvent = {
    event_name: opts.eventName,
    event_time: opts.eventTimeSec ?? Math.floor(Date.now() / 1000),
    event_id: opts.eventId,
    action_source: "website",
    user_data: opts.userData,
  };
  if (opts.sourceUrl) event.event_source_url = opts.sourceUrl;
  if (opts.customData) event.custom_data = opts.customData;
  return event;
}
