declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

interface PurchaseBooking {
  id: string;
  reservation_number: string | null;
  deposit_amount: number;
  booking_type: string;
}

/**
 * Google Ads conversion tag. Both values come from Google Ads →
 * Goals → Conversions → (conversion action) → Tag setup. While either
 * field is empty only the GA4 `purchase` event fires, so this is safe
 * to deploy before the conversion action exists.
 * Full setup guide: docs/GOOGLE-TAGS-SETUP.md
 */
export const googleAds = {
  id: "", // e.g. "AW-123456789"
  purchaseLabel: "", // e.g. "AbCdEfGh1jKLmN0pQrS"
};

/**
 * Registers the Google Ads tag so it drops its click cookies (_gcl_aw)
 * on landing pages with a gclid. Call once at app startup.
 * Returns true if the tag was configured.
 */
export function initGoogleAdsTag(): boolean {
  if (typeof window.gtag !== "function" || !googleAds.id) return false;
  window.gtag("config", googleAds.id);
  return true;
}

const trackedKey = (bookingId: string) => `ga_purchase_${bookingId}`;

/**
 * Fires the GA4 `purchase` event for a new booking deposit.
 * Conversion value is the deposit actually charged, not the booking total.
 * Returns true if the event was sent.
 */
export function trackPurchase(booking: PurchaseBooking): boolean {
  if (typeof window.gtag !== "function") return false;

  // localStorage guard against refires on refresh; GA also dedupes by
  // transaction_id server-side, so a throwing localStorage is fine to ignore.
  try {
    if (localStorage.getItem(trackedKey(booking.id))) return false;
  } catch {
    // private mode / storage denied — rely on GA dedup
  }

  const transactionId = booking.reservation_number || booking.id;

  window.gtag("event", "purchase", {
    transaction_id: transactionId,
    value: booking.deposit_amount,
    currency: "USD",
    items: [
      {
        item_name: booking.booking_type,
        price: booking.deposit_amount,
        quantity: 1,
      },
    ],
  });

  // Direct Google Ads conversion — does not depend on the GA4 → Ads
  // import chain. Google dedupes against the GA4 import by transaction_id.
  if (googleAds.id && googleAds.purchaseLabel) {
    window.gtag("event", "conversion", {
      send_to: `${googleAds.id}/${googleAds.purchaseLabel}`,
      value: booking.deposit_amount,
      currency: "USD",
      transaction_id: transactionId,
    });
  }

  try {
    localStorage.setItem(trackedKey(booking.id), "1");
  } catch {
    // ignore
  }

  return true;
}
