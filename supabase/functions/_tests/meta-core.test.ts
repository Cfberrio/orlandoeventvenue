/**
 * Tests for the pure half of the Meta Conversions API layer.
 *
 * Production location: supabase/functions/_shared/meta-core.ts — the Deno-free
 * parts live there precisely so they can be exercised here under vitest.
 *
 * Two things are load-bearing and are pinned by name below:
 *
 *  1. The dedup ids must match src/lib/tracking/core.ts byte for byte. Pixel
 *     and CAPI collapse into one Meta action only because both halves send the
 *     same string; drift doubles every conversion.
 *
 *  2. pickMatchSignals must never report an ad click that happened AFTER the
 *     event being attributed. That is the one place this pipeline could
 *     silently inflate what Meta believes its ads caused.
 *
 * Run with: bun run test:edge
 */
import { describe, expect, it } from "vitest";
import {
  bookingCreatedEventId,
  checkoutEventId,
  conversionValue,
  hashedUserData,
  leadEventId,
  normalizeEmail,
  normalizePhone,
  normalizeZip,
  pickMatchSignals,
  purchaseEventId,
  sha256Hex,
  splitFullName,
  type VisitorSignals,
} from "../_shared/meta-core.ts";

describe("dedup event ids", () => {
  // Must stay identical to src/lib/tracking/core.ts.
  it("match the browser-side format exactly", () => {
    const id = "6f1c2b7a-1111-4222-8333-444455556666";
    expect(purchaseEventId(id)).toBe(`evt_purchase_${id}`);
    expect(checkoutEventId(id)).toBe(`evt_checkout_${id}`);
    expect(bookingCreatedEventId(id)).toBe(`evt_booking_${id}`);
    expect(leadEventId("l1")).toBe("evt_lead_l1");
  });
});

describe("normalization", () => {
  it("lowercases and trims email, rejecting anything without an @", () => {
    expect(normalizeEmail("  Guest@Example.COM ")).toBe("guest@example.com");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it("prepends the US country code to a bare 10-digit number", () => {
    expect(normalizePhone("(407) 974-5979")).toBe("14079745979");
    expect(normalizePhone("+1 407 974 5979")).toBe("14079745979");
    // Already international — left alone.
    expect(normalizePhone("447700900123")).toBe("447700900123");
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("accepts only a 5-digit ZIP", () => {
    expect(normalizeZip("32801")).toBe("32801");
    expect(normalizeZip("32801-1234")).toBe("32801");
    expect(normalizeZip("ABCDE")).toBeNull();
  });
});

describe("splitFullName", () => {
  // OEV collects one full_name field; Meta matches better on fn + ln.
  it("splits on the first space", () => {
    expect(splitFullName("Maria Gonzalez")).toEqual({
      firstName: "Maria",
      lastName: "Gonzalez",
    });
    expect(splitFullName("  Ana  Lucia  Perez ")).toEqual({
      firstName: "Ana",
      lastName: "Lucia Perez",
    });
  });

  it("never invents a last name", () => {
    // A fabricated surname hashes to garbage and LOWERS match quality.
    expect(splitFullName("Cher")).toEqual({ firstName: "Cher", lastName: null });
    expect(splitFullName("")).toEqual({ firstName: null, lastName: null });
    expect(splitFullName(null)).toEqual({ firstName: null, lastName: null });
  });
});

describe("conversionValue", () => {
  // The reported value is the deposit actually charged, matching GA4. Using
  // the contract total would double-count against the balance payment.
  it("prefers the amount Stripe actually charged", () => {
    expect(conversionValue(1058.75, 1000)).toBe(1058.75);
  });

  it("falls back to the base deposit for rows predating the fee columns", () => {
    expect(conversionValue(null, 1000)).toBe(1000);
    expect(conversionValue(0, 1000)).toBe(1000);
  });

  it("returns 0 rather than NaN when nothing is known", () => {
    expect(conversionValue(null, null)).toBe(0);
    expect(conversionValue(undefined, undefined)).toBe(0);
  });

  it("rounds to cents", () => {
    expect(conversionValue(10.005, null)).toBe(10.01);
  });
});

describe("hashedUserData", () => {
  it("SHA-256s the identifiers Meta requires hashed", async () => {
    const out = await hashedUserData({ email: "Guest@Example.com" });
    expect(out.em).toEqual([await sha256Hex("guest@example.com")]);
    // Never the raw value.
    expect(JSON.stringify(out)).not.toContain("Guest@Example.com");
    expect(JSON.stringify(out)).not.toContain("guest@example.com");
  });

  it("passes browser identifiers through unhashed, as Meta requires", async () => {
    const out = await hashedUserData({
      fbp: "fb.1.1700000000000.123",
      fbc: "fb.1.1700000000000.IwAR_abc",
      clientIp: "203.0.113.7",
      userAgent: "Mozilla/5.0",
    });
    expect(out.fbp).toBe("fb.1.1700000000000.123");
    expect(out.fbc).toBe("fb.1.1700000000000.IwAR_abc");
    expect(out.client_ip_address).toBe("203.0.113.7");
    expect(out.client_user_agent).toBe("Mozilla/5.0");
  });

  it("omits fields it cannot normalize instead of sending junk", async () => {
    const out = await hashedUserData({ email: "nope", phone: "12", zip: "ABCDE" });
    expect(out.em).toBeUndefined();
    expect(out.ph).toBeUndefined();
    expect(out.zp).toBeUndefined();
  });
});

describe("pickMatchSignals", () => {
  const AT = (iso: string) => new Date(iso);

  it("takes each signal from the newest row that actually has it", () => {
    // The Stripe-return row is newest but blank of the click id. Reading the
    // newest row wholesale would throw away the one datum proving the ad
    // caused the booking.
    const rows: VisitorSignals[] = [
      { first_seen_at: "2026-03-10T12:00:00Z", fbp: "fbp-new", last_ip: "203.0.113.9" },
      {
        first_touch_at: "2026-03-01T09:00:00Z",
        fbc: "fb.1.1.click",
        fbp: "fbp-old",
        last_user_agent: "InstagramUA",
      },
    ];
    expect(pickMatchSignals(rows, AT("2026-03-10T12:05:00Z"))).toEqual({
      fbc: "fb.1.1.click",
      fbp: "fbp-new",
      clientIp: "203.0.113.9",
      userAgent: "InstagramUA",
    });
  });

  it("refuses a click that happened AFTER the event being attributed", () => {
    // Clicked an ad the day after paying. Reporting that click as the cause of
    // the sale would be a lie to Meta's optimizer.
    const rows: VisitorSignals[] = [
      { first_seen_at: "2026-03-12T10:00:00Z", fbc: "fb.1.1.later-click", fbp: "fbp-1" },
    ];
    const signals = pickMatchSignals(rows, AT("2026-03-11T10:00:00Z"));
    expect(signals.fbc).toBeNull();
    // Identity still flows: fbp claims nothing about an ad.
    expect(signals.fbp).toBe("fbp-1");
  });

  it("drops a click from a row that cannot be shown to predate the event", () => {
    const rows: VisitorSignals[] = [{ fbc: "fb.1.1.undated", fbp: "fbp-1" }];
    expect(pickMatchSignals(rows, AT("2026-03-11T10:00:00Z")).fbc).toBeNull();
  });

  it("returns all nulls for a guest with no visitor rows", () => {
    expect(pickMatchSignals([], AT("2026-03-11T10:00:00Z"))).toEqual({
      fbc: null,
      fbp: null,
      clientIp: null,
      userAgent: null,
    });
  });

  it("ignores empty strings, which are not signals", () => {
    const rows: VisitorSignals[] = [
      { first_seen_at: "2026-03-01T00:00:00Z", fbc: "", fbp: "" },
      { first_seen_at: "2026-02-01T00:00:00Z", fbc: "fb.1.1.real", fbp: "fbp-real" },
    ];
    const signals = pickMatchSignals(rows, AT("2026-03-05T00:00:00Z"));
    expect(signals.fbc).toBe("fb.1.1.real");
    expect(signals.fbp).toBe("fbp-real");
  });
});
