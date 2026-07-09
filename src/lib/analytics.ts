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

  window.gtag("event", "purchase", {
    transaction_id: booking.reservation_number || booking.id,
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

  try {
    localStorage.setItem(trackedKey(booking.id), "1");
  } catch {
    // ignore
  }

  return true;
}
