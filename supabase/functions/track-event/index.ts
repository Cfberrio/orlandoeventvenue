// First-party event collector for OEV.
//
// The browser never writes the tracking tables directly — this function owns
// every insert (service role), attaches the server-observed IP and user agent
// (which Meta needs for match quality and the browser cannot supply honestly),
// stitches the anonymous visitor to a booking/lead/email, records the consent
// choice for the audit trail, and mirrors Lead / CompleteRegistration to Meta
// CAPI with the SAME event_id the browser Pixel used, so Meta deduplicates the
// two halves into one action.
//
// InitiateCheckout and Purchase are NOT accepted here. They are sent from the
// payment path (create-checkout / stripe-webhook), where the charged amount is
// authoritative and a browser cannot forge a sale.
//
// This endpoint is public (verify_jwt = false in config.toml) because it must
// work for anonymous visitors. Its defences are: a hard payload cap, a strict
// event allowlist, format-checked identifiers, and — before anything reaches
// Meta — a existence check on the booking or lead the event claims.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { hashedUserData, splitFullName } from "../_shared/meta-core.ts";
import { deliverMetaEvent } from "../_shared/meta-capi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/** Internal ledger names. Anything not listed is dropped silently. */
const EVENT_ALLOWLIST = new Set([
  "page_viewed",
  "book_landing_viewed",
  "booking_started",
  "booking_type_selected",
  "event_details_completed",
  "addons_selected",
  "summary_viewed",
  "contact_info_completed",
  "booking_created",
  "checkout_session_created",
  "payment_redirected",
  "payment_failed",
  // Client-observed confirmation. The authoritative 'payment_confirmed' row is
  // written server-side by meta-capi.ts when the deposit actually clears; this
  // one only records that the guest reached the confirmation page.
  "payment_confirmed_client",
  "lead_submitted",
  "popup_lead_submitted",
  "planning_kit_viewed",
  "tour_page_viewed",
  "virtual_tour_viewed",
  "contact_form_viewed",
  "consent_updated",
]);

/** The only two Meta events a browser may ask this function to mirror. */
const MIRRORABLE = new Set(["Lead", "CompleteRegistration"]);

const ANON_RE = /^anon_[a-z0-9]{8,64}$/i;
const SESS_RE = /^sess_[a-z0-9]{8,64}$/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@(),]+@[^\s@(),]+\.[^\s@(),]+$/;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() ? v.slice(0, max) : null;
const uuid = (v: unknown): string | null =>
  typeof v === "string" && UUID_RE.test(v) ? v : null;
const email = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase().slice(0, 254);
  return EMAIL_RE.test(e) ? e : null;
};

/**
 * A touch may overwrite LAST touch only when it is a real paid/ad click: a
 * Meta object id, a click id, or a paid utm_medium. An organic or direct
 * return therefore never erases the ad that actually acquired the guest.
 * Mirrors isPaidTouch() in src/lib/tracking/core.ts.
 */
const isPaidTouch = (utm: Record<string, unknown> | null): boolean => {
  if (!utm) return false;
  if (utm.meta_ad_id || utm.meta_adset_id || utm.meta_campaign_id || utm.fbclid) return true;
  const medium = String(utm.utm_medium ?? "").toLowerCase();
  return medium.includes("paid") || medium === "cpc" || medium === "ppc";
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ message: "method not allowed" }, 405);

  try {
    const raw = await req.text();
    if (raw.length > 30_000) return json({ message: "payload too large" }, 413);
    const body = JSON.parse(raw || "{}");

    const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null;
    const ua = str(req.headers.get("user-agent"), 400);
    const pageUrl = str(body.page_url, 500);
    const referrer = str(body.referrer, 500);
    const anon =
      typeof body.anonymous_id === "string" && ANON_RE.test(body.anonymous_id)
        ? body.anonymous_id
        : null;
    const sess =
      typeof body.session_id === "string" && SESS_RE.test(body.session_id)
        ? body.session_id
        : null;

    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const consent =
      body.consent && typeof body.consent === "object"
        ? {
            policy_version: str(body.consent.v, 40) ?? "unknown",
            action: str(body.consent.action, 40) ?? "unknown",
            preferences: body.consent.preferences === true,
            analytics: body.consent.analytics === true,
            advertising: body.consent.advertising === true,
          }
        : null;

    const vis = body.visitor && typeof body.visitor === "object" ? body.visitor : {};
    const fbp = str(vis.fbp, 200);
    const fbc = str(vis.fbc, 400);

    // Identity anchors carried on the envelope: whichever of these the guest
    // has reached by now. They are what stitch several browser contexts back
    // into one person, so they are written on the visitor row, not just the
    // event.
    const identBookingId = uuid(body.booking_id);
    const identLeadId = uuid(body.lead_id);
    const identEmail = email(body.email);

    // ---- visitor upsert (identity + attribution + consent snapshot) ----
    let visitorId: string | null = null;
    if (anon) {
      const now = new Date().toISOString();
      const { data: existing, error: readErr } = await db
        .from("tracking_visitor")
        .select("id,first_utm,last_utm,first_landing_page,first_referrer")
        .eq("anonymous_id", anon)
        .maybeSingle();
      if (readErr) console.error("[track-event] visitor read failed", readErr);

      const common: Record<string, unknown> = {
        last_seen_at: now,
        last_ip: ip,
        last_user_agent: ua,
      };
      if (fbp) common.fbp = fbp;
      if (fbc) common.fbc = fbc;
      // Never overwrite a known anchor with null — a later pageview must not
      // erase the booking this browser was tied to.
      if (identBookingId) common.booking_id = identBookingId;
      if (identLeadId) common.lead_id = identLeadId;
      if (identEmail) common.email = identEmail;
      if (consent) {
        common.ad_consent = consent.advertising;
        common.analytics_consent = consent.analytics;
        common.consent_updated_at = now;
      }

      const utm =
        vis.utm && typeof vis.utm === "object" ? (vis.utm as Record<string, unknown>) : null;

      if (existing) {
        // First touch is written once and never overwritten.
        if (!existing.first_utm && utm) {
          common.first_utm = utm;
          common.first_touch_at = now;
        }
        // Last touch moves on a new paid click, or to fill an empty slot.
        if (utm && (isPaidTouch(utm) || !existing.last_utm)) {
          common.last_utm = utm;
          common.last_touch_at = now;
        }
        if (!existing.first_landing_page && str(vis.landing_page, 500)) {
          common.first_landing_page = str(vis.landing_page, 500);
        }
        if (!existing.first_referrer && str(vis.referrer, 500)) {
          common.first_referrer = str(vis.referrer, 500);
        }
        const { error: updErr } = await db
          .from("tracking_visitor")
          .update(common)
          .eq("id", existing.id);
        if (updErr) console.error("[track-event] visitor update failed", updErr);
        visitorId = existing.id;
      } else {
        const { data: inserted, error: insErr } = await db
          .from("tracking_visitor")
          .insert({
            anonymous_id: anon,
            first_utm: utm,
            last_utm: utm,
            first_touch_at: utm ? now : null,
            last_touch_at: utm ? now : null,
            first_landing_page: str(vis.landing_page, 500),
            first_referrer: str(vis.referrer, 500),
            ...common,
          })
          .select("id")
          .maybeSingle();
        if (insErr && (insErr as { code?: string }).code === "23505") {
          // Two tabs raced to mint the same cookie. Read the winner's row.
          const { data: won } = await db
            .from("tracking_visitor")
            .select("id")
            .eq("anonymous_id", anon)
            .maybeSingle();
          visitorId = won?.id ?? null;
          if (visitorId) await db.from("tracking_visitor").update(common).eq("id", visitorId);
        } else if (insErr) {
          console.error("[track-event] visitor insert failed", insErr);
        } else {
          visitorId = inserted?.id ?? null;
        }
      }

      if (sess && visitorId) {
        const { error: sessErr } = await db.from("tracking_session").insert({
          id: sess,
          anonymous_id: anon,
          visitor_id: visitorId,
          landing_page: pageUrl,
          referrer,
          utm: vis.utm && typeof vis.utm === "object" ? vis.utm : null,
        });
        if (sessErr && (sessErr as { code?: string }).code === "23505") {
          await db
            .from("tracking_session")
            .update({ last_activity_at: new Date().toISOString() })
            .eq("id", sess);
        } else if (sessErr) {
          console.error("[track-event] session insert failed", sessErr);
        }
      }
    }

    // ---- consent audit log ----
    if (consent) {
      const { error: consentErr } = await db.from("consent_record").insert({
        anonymous_id: anon,
        visitor_id: visitorId,
        policy_version: consent.policy_version,
        action: consent.action,
        preferences: consent.preferences,
        analytics: consent.analytics,
        advertising: consent.advertising,
        page_url: pageUrl,
        user_agent: ua,
        client_ip: ip,
      });
      if (consentErr) console.error("[track-event] consent insert failed", consentErr);
    }

    // ---- event ledger + CAPI mirror ----
    const events = Array.isArray(body.events) ? body.events.slice(0, 10) : [];
    for (const e of events) {
      if (!e || typeof e !== "object") continue;
      const name = str(e.name, 60);
      if (!name || !EVENT_ALLOWLIST.has(name)) continue;
      const eventId = str(e.event_id, 120);
      const evBookingId = uuid(e.booking_id) ?? identBookingId;
      const evLeadId = uuid(e.lead_id) ?? identLeadId;
      const evEmail = email(e.email) ?? identEmail;

      const { error: evErr } = await db.from("tracking_event").insert({
        event_name: name,
        event_id: eventId,
        anonymous_id: anon,
        session_id: sess,
        visitor_id: visitorId,
        booking_id: evBookingId,
        lead_id: evLeadId,
        email: evEmail,
        page_url: pageUrl,
        referrer,
        props: e.props && typeof e.props === "object" ? e.props : null,
        client_ip: ip,
        user_agent: ua,
      });
      if (evErr) {
        // 23505 = this exact event_id already landed (reload, retry). Skipping
        // is the point of the unique index; any other code is a real fault.
        if ((evErr as { code?: string }).code === "23505") continue;
        console.error("[track-event] event insert failed", name, evErr);
        continue;
      }

      // ---- Meta CAPI mirror ----
      // Sent for every visitor: ad measurement is the entire purpose of these
      // events, and the banner choice is recorded on the visitor row and in
      // consent_record either way (see docs/meta-tracking.md > Privacy).
      const metaName = typeof e.meta === "string" && MIRRORABLE.has(e.meta) ? e.meta : null;
      if (!metaName || !eventId) continue;

      // A public endpoint must not be a free channel into someone's ad
      // account. Nothing reaches Meta unless the booking or lead the event
      // claims actually exists in this database — which also gives us the real
      // contact details rather than whatever the caller typed.
      let person: {
        fullName: string | null;
        email: string | null;
        phone: string | null;
        externalId: string;
      } | null = null;

      if (evBookingId) {
        const { data: b } = await db
          .from("bookings")
          .select("id,full_name,email,phone")
          .eq("id", evBookingId)
          .maybeSingle();
        if (b) {
          person = {
            fullName: (b as Record<string, unknown>).full_name as string,
            email: (b as Record<string, unknown>).email as string,
            phone: (b as Record<string, unknown>).phone as string,
            externalId: String((b as Record<string, unknown>).id),
          };
        }
      } else if (evLeadId) {
        const { data: l } = await db
          .from("popup_leads")
          .select("id,full_name,email,phone")
          .eq("id", evLeadId)
          .maybeSingle();
        if (l) {
          person = {
            fullName: (l as Record<string, unknown>).full_name as string,
            email: (l as Record<string, unknown>).email as string,
            phone: (l as Record<string, unknown>).phone as string,
            externalId: String((l as Record<string, unknown>).id),
          };
        }
      }

      if (!person) {
        console.warn("[track-event] capi mirror skipped — no verifiable subject", eventId);
        continue;
      }

      const cd = e.custom_data && typeof e.custom_data === "object" ? e.custom_data : {};
      const customData: Record<string, unknown> = {};
      if (typeof cd.value === "number" && cd.value >= 0) customData.value = cd.value;
      if (typeof cd.currency === "string") customData.currency = cd.currency.slice(0, 3);
      if (Array.isArray(cd.content_ids)) customData.content_ids = cd.content_ids.slice(0, 5);
      if (typeof cd.content_type === "string") customData.content_type = cd.content_type.slice(0, 40);
      if (typeof cd.content_name === "string") customData.content_name = cd.content_name.slice(0, 100);
      if (typeof cd.content_category === "string") {
        customData.content_category = cd.content_category.slice(0, 60);
      }
      if (cd.status === true) customData.status = true;

      const { firstName, lastName } = splitFullName(person.fullName);
      const userData = await hashedUserData({
        email: person.email,
        phone: person.phone,
        firstName,
        lastName,
        // The venue is in Orlando, FL — a fact about the business, not a guess
        // about the guest.
        city: "Orlando",
        state: "FL",
        country: "us",
        externalId: person.externalId,
        fbp,
        fbc,
        clientIp: ip,
        userAgent: ua,
      });

      try {
        await deliverMetaEvent({
          eventName: metaName,
          eventId,
          sourceUrl: pageUrl,
          userData,
          customData: Object.keys(customData).length ? customData : undefined,
          bookingId: evBookingId,
          leadId: evLeadId,
        });
      } catch (err) {
        console.error("[track-event] capi mirror failed", eventId, err);
      }
    }

    return json({ ok: true });
  } catch (e) {
    console.error("[track-event]", e);
    return json({ message: "error" }, 500);
  }
});
