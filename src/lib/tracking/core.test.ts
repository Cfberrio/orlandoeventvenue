import { describe, expect, it } from "vitest";
import {
  bookingCreatedEventId,
  buildFbc,
  checkoutEventId,
  isPaidTouch,
  leadEventId,
  parseConsentCookie,
  parseUtm,
  purchaseEventId,
  randomId,
  serializeConsentCookie,
  CONSENT_POLICY_VERSION,
  type ConsentPrefs,
} from "./core";

describe("dedup event ids", () => {
  // These four strings are the entire mechanism by which the browser Pixel and
  // the server CAPI event collapse into one action inside Meta. If one side
  // drifts, every conversion silently doubles — which is why the format is
  // pinned by a test rather than left to convention.
  it("derives deterministically from the business object", () => {
    const bookingId = "6f1c2b7a-1111-4222-8333-444455556666";
    expect(purchaseEventId(bookingId)).toBe(`evt_purchase_${bookingId}`);
    expect(checkoutEventId(bookingId)).toBe(`evt_checkout_${bookingId}`);
    expect(bookingCreatedEventId(bookingId)).toBe(`evt_booking_${bookingId}`);
    expect(leadEventId("lead-1")).toBe("evt_lead_lead-1");
  });

  it("recomputes the same id for the same booking", () => {
    const id = "abc";
    expect(purchaseEventId(id)).toBe(purchaseEventId(id));
    expect(checkoutEventId(id)).toBe(checkoutEventId(id));
  });

  it("keeps the three conversions distinct for one booking", () => {
    const id = "abc";
    const ids = new Set([purchaseEventId(id), checkoutEventId(id), bookingCreatedEventId(id)]);
    expect(ids.size).toBe(3);
  });
});

describe("parseUtm", () => {
  it("captures Meta and Google ad parameters", () => {
    const utm = parseUtm(
      "?utm_source=facebook&utm_medium=paid_social&utm_campaign=fall&utm_content=carousel_a" +
        "&utm_term=orlando&meta_ad_id=123&meta_adset_id=456&meta_campaign_id=789" +
        "&meta_placement=feed&fbclid=IwAR_abc&gclid=Cj0xyz",
    );
    expect(utm).toEqual({
      utm_source: "facebook",
      utm_medium: "paid_social",
      utm_campaign: "fall",
      utm_content: "carousel_a",
      utm_term: "orlando",
      meta_ad_id: "123",
      meta_adset_id: "456",
      meta_campaign_id: "789",
      meta_placement: "feed",
      fbclid: "IwAR_abc",
      gclid: "Cj0xyz",
    });
  });

  it("returns null when the URL carries no attribution", () => {
    expect(parseUtm("")).toBeNull();
    expect(parseUtm("?type=hourly")).toBeNull();
  });

  it("ignores unknown parameters and caps value length", () => {
    const utm = parseUtm(`?utm_source=${"x".repeat(500)}&evil=1`);
    expect(utm?.utm_source).toHaveLength(200);
    expect(utm).not.toHaveProperty("evil");
  });
});

describe("isPaidTouch", () => {
  // Last touch may only be overwritten by a real ad click. This is what stops
  // a guest returning via Google search from erasing the Instagram ad that
  // actually acquired them.
  it("accepts a click id or a Meta object id", () => {
    expect(isPaidTouch({ fbclid: "abc" })).toBe(true);
    expect(isPaidTouch({ gclid: "abc" })).toBe(true);
    expect(isPaidTouch({ meta_ad_id: "1" })).toBe(true);
    expect(isPaidTouch({ meta_adset_id: "1" })).toBe(true);
    expect(isPaidTouch({ meta_campaign_id: "1" })).toBe(true);
  });

  it("accepts a paid medium", () => {
    expect(isPaidTouch({ utm_medium: "cpc" })).toBe(true);
    expect(isPaidTouch({ utm_medium: "ppc" })).toBe(true);
    expect(isPaidTouch({ utm_medium: "paid_social" })).toBe(true);
    expect(isPaidTouch({ utm_medium: "PAID" })).toBe(true);
  });

  it("rejects organic, referral and empty touches", () => {
    expect(isPaidTouch({ utm_medium: "organic" })).toBe(false);
    expect(isPaidTouch({ utm_source: "newsletter" })).toBe(false);
    expect(isPaidTouch(null)).toBe(false);
    expect(isPaidTouch(undefined)).toBe(false);
    expect(isPaidTouch({})).toBe(false);
  });
});

describe("buildFbc", () => {
  it("uses Meta's documented click-cookie format", () => {
    expect(buildFbc("IwAR_abc", 1_700_000_000_000)).toBe("fb.1.1700000000000.IwAR_abc");
  });
});

describe("consent cookie", () => {
  const prefs: ConsentPrefs = {
    v: CONSENT_POLICY_VERSION,
    ts: "2026-09-02T00:00:00.000Z",
    preferences: true,
    analytics: true,
    advertising: false,
  };

  it("round-trips", () => {
    expect(parseConsentCookie(serializeConsentCookie(prefs))).toEqual(prefs);
  });

  it("treats anything unparseable as no choice made", () => {
    expect(parseConsentCookie(null)).toBeNull();
    expect(parseConsentCookie("")).toBeNull();
    expect(parseConsentCookie("not-json")).toBeNull();
    expect(parseConsentCookie(encodeURIComponent(JSON.stringify({ nope: 1 })))).toBeNull();
  });

  it("coerces missing flags to false rather than inheriting a grant", () => {
    const parsed = parseConsentCookie(
      encodeURIComponent(JSON.stringify({ v: "2026-09-02" })),
    );
    expect(parsed).toEqual({
      v: "2026-09-02",
      ts: "",
      preferences: false,
      analytics: false,
      advertising: false,
    });
  });
});

describe("randomId", () => {
  it("is prefixed and free of dashes so it survives the id regexes", () => {
    const id = randomId("anon");
    expect(id.startsWith("anon_")).toBe(true);
    expect(id).toMatch(/^anon_[a-z0-9]{8,64}$/i);
  });

  it("does not collide", () => {
    const ids = new Set(Array.from({ length: 200 }, () => randomId("sess")));
    expect(ids.size).toBe(200);
  });
});
