import { describe, it, expect, beforeEach, vi } from "vitest";
import { trackPurchase } from "./analytics";

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
