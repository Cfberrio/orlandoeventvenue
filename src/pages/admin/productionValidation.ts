// Validation for the admin "Configure Production" modal in BookingDetail.
//
// Admins may configure ANY production duration (including under 4 hours) — there
// is deliberately NO minimum-duration check here. The 4-hour package minimum
// only applies to the client-facing booking flow, not to admin overrides.

export type ProductionPackage = "none" | "basic" | "led" | "workshop";

export interface ProductionBookingContext {
  booking_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
}

export interface ProductionValidationError {
  title: string;
  description: string;
}

/**
 * Validates the production start/end times an admin picked.
 * Returns an error object to surface via toast, or null when valid.
 */
export function validateProductionTimes(
  productionPackage: ProductionPackage,
  productionStartTime: string,
  productionEndTime: string,
  booking: ProductionBookingContext | null | undefined
): ProductionValidationError | null {
  // No package selected → nothing to validate.
  if (productionPackage === "none") return null;

  // Times are required when a package is chosen.
  if (!productionStartTime || !productionEndTime) {
    return {
      title: "Missing Information",
      description: "Please specify both start and end times for production",
    };
  }

  const start = new Date(`2000-01-01T${productionStartTime}`);
  const end = new Date(`2000-01-01T${productionEndTime}`);

  // End must be after start.
  if (end <= start) {
    return {
      title: "Invalid Time Range",
      description: "End time must be after start time",
    };
  }

  // No minimum-duration restriction for admins (see file header).

  // For hourly bookings, production hours must fall within the booking window.
  if (booking?.booking_type === "hourly" && booking.start_time && booking.end_time) {
    const bookingStart = new Date(`2000-01-01T${booking.start_time}`);
    const bookingEnd = new Date(`2000-01-01T${booking.end_time}`);

    if (start < bookingStart || end > bookingEnd) {
      return {
        title: "Invalid Time Range",
        description: `Production hours must be within booking time (${booking.start_time.slice(0, 5)} - ${booking.end_time.slice(0, 5)})`,
      };
    }
  }

  return null;
}
