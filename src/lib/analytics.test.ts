import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { trackPurchase, initGoogleAdsTag, googleAds } from "./analytics";

const booking = {
  id: "abc-123",
  reservation_number: "OEV-1042",
  deposit_amount: 250,
  booking_type: "hourly",
};

describe("trackPurchase", () => {
  beforeEach(() => {
    localStorage.clear();
    window.gtag = vi.fn();
  });

  afterEach(() => {
    googleAds.id = "";
    googleAds.purchaseLabel = "";
  });

  it("sends a GA4 purchase event with deposit as value and reservation number as transaction_id", () => {
    const sent = trackPurchase(booking);

    expect(sent).toBe(true);
    expect(window.gtag).toHaveBeenCalledWith("event", "purchase", {
      transaction_id: "OEV-1042",
      value: 250,
      currency: "USD",
      items: [
        {
          item_name: "hourly",
          price: 250,
          quantity: 1,
        },
      ],
    });
  });

  it("does not fire twice for the same booking (page refresh)", () => {
    trackPurchase(booking);
    const sentAgain = trackPurchase(booking);

    expect(sentAgain).toBe(false);
    expect(window.gtag).toHaveBeenCalledTimes(1);
  });

  it("falls back to booking id when reservation number is missing", () => {
    trackPurchase({ ...booking, reservation_number: null });

    expect(window.gtag).toHaveBeenCalledWith(
      "event",
      "purchase",
      expect.objectContaining({ transaction_id: "abc-123" })
    );
  });

  it("is a safe no-op when gtag is not loaded (ad blocker)", () => {
    delete window.gtag;

    expect(trackPurchase(booking)).toBe(false);
  });

  it("does not send a Google Ads conversion while the tag is unconfigured", () => {
    trackPurchase(booking);

    expect(window.gtag).toHaveBeenCalledTimes(1);
    expect(window.gtag).not.toHaveBeenCalledWith(
      "event",
      "conversion",
      expect.anything()
    );
  });

  it("sends a Google Ads conversion alongside the GA4 purchase when configured", () => {
    googleAds.id = "AW-123456789";
    googleAds.purchaseLabel = "TestLabel123";

    trackPurchase(booking);

    expect(window.gtag).toHaveBeenCalledTimes(2);
    expect(window.gtag).toHaveBeenCalledWith("event", "conversion", {
      send_to: "AW-123456789/TestLabel123",
      value: 250,
      currency: "USD",
      transaction_id: "OEV-1042",
    });
  });

  it("still fires when localStorage is unavailable (private mode)", () => {
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("denied");
      });

    expect(trackPurchase(booking)).toBe(true);
    expect(window.gtag).toHaveBeenCalledTimes(1);

    getItem.mockRestore();
    setItem.mockRestore();
  });
});

describe("initGoogleAdsTag", () => {
  beforeEach(() => {
    window.gtag = vi.fn();
  });

  afterEach(() => {
    googleAds.id = "";
  });

  it("is a no-op while the Ads tag id is unset", () => {
    expect(initGoogleAdsTag()).toBe(false);
    expect(window.gtag).not.toHaveBeenCalled();
  });

  it("configures the Ads tag when an id is set", () => {
    googleAds.id = "AW-123456789";

    expect(initGoogleAdsTag()).toBe(true);
    expect(window.gtag).toHaveBeenCalledWith("config", "AW-123456789");
  });

  it("is a safe no-op when gtag is not loaded", () => {
    delete window.gtag;
    googleAds.id = "AW-123456789";

    expect(initGoogleAdsTag()).toBe(false);
  });
});
