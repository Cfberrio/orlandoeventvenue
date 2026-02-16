import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BookingFormData } from "@/pages/Book";
import { format, parseISO, isWithinInterval } from "date-fns";

interface CreateBookingResult {
  bookingId: string;
  reservationNumber: string;
}

// Generate a unique reservation number
const generateReservationNumber = (): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing chars like 0, O, 1, I
  let result = "OEV-";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

// Helper: Convert time string to minutes
const toMinutes = (time: string): number => {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
};

// Check if two time ranges overlap
const doTimeRangesOverlap = (
  start1: string,
  end1: string,
  start2: string,
  end2: string
): boolean => {
  const start1Min = toMinutes(start1);
  const end1Min = toMinutes(end1);
  const start2Min = toMinutes(start2);
  const end2Min = toMinutes(end2);
  return start1Min < end2Min && end1Min > start2Min;
};

// Check if date is within a range
const isDateInRange = (date: Date, startDate: string, endDate: string): boolean => {
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  return isWithinInterval(date, { start, end });
};

export const useCreateBooking = () => {
  return useMutation({
    mutationFn: async (formData: Partial<BookingFormData>): Promise<CreateBookingResult> => {
      // Validate required fields
      if (!formData.date) throw new Error("Event date is required");
      if (!formData.fullName) throw new Error("Full name is required");
      if (!formData.email) throw new Error("Email is required");
      if (!formData.phone) throw new Error("Phone is required");
      if (!formData.eventType) throw new Error("Event type is required");
      if (!formData.pricing) throw new Error("Pricing data is required");
      if (!formData.signature) throw new Error("Signature is required");
      if (!formData.initials) throw new Error("Initials are required");
      if (!formData.signerName) throw new Error("Signer name is required");

      // Get the WEBSITE_FULL_FLOW policy for website bookings
      const { data: policyData, error: policyError } = await supabase
        .from("booking_policies")
        .select("id")
        .eq("policy_name", "WEBSITE_FULL_FLOW")
        .single();

      if (policyError || !policyData) {
        console.error("Error fetching website policy:", policyError);
        throw new Error("Failed to fetch booking policy");
      }

      const eventDateStr = format(formData.date, "yyyy-MM-dd");
      const bookingType = formData.bookingType as "hourly" | "daily";

      // Validate availability
      // 1. Check existing paid bookings
      const { data: existingBookings, error: bookingsError } = await supabase
        .from("bookings")
        .select("event_date, booking_type, start_time, end_time")
        .in("payment_status", ["deposit_paid", "fully_paid", "invoiced"])
        .eq("event_date", eventDateStr);

      if (bookingsError) {
        console.error("Error checking bookings:", bookingsError);
        throw new Error("Failed to check availability");
      }

      // 2. Check availability blocks
      const { data: availabilityBlocks, error: blocksError } = await supabase
        .from("availability_blocks")
        .select("block_type, start_date, end_date, start_time, end_time")
        .lte("start_date", eventDateStr)
        .gte("end_date", eventDateStr);

      if (blocksError) {
        console.error("Error checking availability blocks:", blocksError);
        throw new Error("Failed to check availability");
      }

      // 3. Check blackout dates
      const { data: blackoutDates, error: blackoutError } = await supabase
        .from("blackout_dates")
        .select("start_date, end_date")
        .lte("start_date", eventDateStr)
        .gte("end_date", eventDateStr);

      if (blackoutError) {
        console.error("Error checking blackout dates:", blackoutError);
        throw new Error("Failed to check availability");
      }

      // Check if date is in blackout period
      if (blackoutDates && blackoutDates.length > 0) {
        throw new Error("This date is not available. Please select a different date.");
      }

      // Validate based on booking type
      if (bookingType === "daily") {
        // Daily booking: Cannot book if ANY booking or block exists on this date
        if (existingBookings && existingBookings.length > 0) {
          throw new Error("This date is not available for full-day booking. There are existing bookings on this date.");
        }

        if (availabilityBlocks && availabilityBlocks.length > 0) {
          const hasBlockingBlock = availabilityBlocks.some((block) => 
            isDateInRange(formData.date!, block.start_date, block.end_date)
          );
          if (hasBlockingBlock) {
            throw new Error("This date is not available for full-day booking. There are existing bookings on this date.");
          }
        }
      } else if (bookingType === "hourly") {
        // Hourly booking: Check for conflicts
        if (!formData.startTime || !formData.endTime) {
          throw new Error("Start and end times are required for hourly bookings");
        }

        // Check if there's a daily booking
        const hasDailyBooking = existingBookings?.some((b) => b.booking_type === "daily");
        if (hasDailyBooking) {
          throw new Error("This date is not available for hourly booking. There is a full-day booking on this date.");
        }

        // Check if there's a daily block
        const hasDailyBlock = availabilityBlocks?.some(
          (block) => 
            block.block_type === "daily" && 
            isDateInRange(formData.date!, block.start_date, block.end_date)
        );
        if (hasDailyBlock) {
          throw new Error("This date is not available for hourly booking. There is a full-day booking on this date.");
        }

        // Check for hourly time conflicts
        const hasHourlyConflict = existingBookings?.some((b) => {
          if (b.booking_type === "hourly" && b.start_time && b.end_time) {
            return doTimeRangesOverlap(formData.startTime!, formData.endTime!, b.start_time, b.end_time);
          }
          return false;
        });

        if (hasHourlyConflict) {
          throw new Error("This time slot is not available. There are conflicting hourly bookings.");
        }

        // Check for hourly block conflicts
        const hasBlockConflict = availabilityBlocks?.some((block) => {
          if (block.block_type === "hourly" && block.start_time && block.end_time &&
              isDateInRange(formData.date!, block.start_date, block.end_date)) {
            return doTimeRangesOverlap(formData.startTime!, formData.endTime!, block.start_time, block.end_time);
          }
          return false;
        });

        if (hasBlockConflict) {
          throw new Error("This time slot is not available. There are conflicting hourly bookings.");
        }
      }

      // Check for existing pending booking with same email + event_date to prevent duplicates
      const { data: existingPendingBookings } = await supabase
        .from("bookings")
        .select("id, reservation_number")
        .eq("email", formData.email!)
        .eq("event_date", eventDateStr)
        .eq("payment_status", "pending")
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .limit(1);

      const existingPendingBooking = existingPendingBookings?.[0] || null;

      // Map form data to database columns
      // Daily bookings default to 01:00 - 23:00 range
      const bookingFields = {
        booking_type: bookingType,
        event_date: eventDateStr,
        start_time: formData.bookingType === "hourly" ? formData.startTime : "01:00",
        end_time: formData.bookingType === "hourly" ? formData.endTime : "23:00",
        number_of_guests: formData.numberOfGuests || 1,
        event_type: formData.eventType,
        event_type_other: formData.eventType === "other" ? formData.eventTypeOther : null,
        client_notes: formData.notes || null,
        package: (formData.package || "none") as "none" | "basic" | "led" | "workshop",
        package_start_time: formData.package !== "none" ? formData.packageStartTime || null : null,
        package_end_time: formData.package !== "none" ? formData.packageEndTime || null : null,
        setup_breakdown: formData.setupBreakdown || false,
        tablecloths: formData.tablecloths || false,
        tablecloth_quantity: formData.tableclothQuantity || 0,
        base_rental: formData.pricing.baseRental,
        cleaning_fee: formData.pricing.cleaningFee,
        package_cost: formData.pricing.packageCost,
        optional_services: formData.pricing.optionalServices,
        discount_amount: formData.pricing.discount || 0,
        discount_code: formData.pricing.discountCode || null,
        taxes_fees: 0,
        total_amount: formData.pricing.total,
        deposit_amount: formData.pricing.deposit,
        balance_amount: formData.pricing.balance,
        full_name: formData.fullName,
        email: formData.email,
        phone: formData.phone,
        company: formData.company || null,
        agree_to_rules: formData.agreeToRules || false,
        initials: formData.initials,
        signer_name: formData.signerName,
        signature: formData.signature,
        signature_date: format(new Date(), "yyyy-MM-dd"),
        policy_id: policyData.id,
      };

      // If a pending booking already exists for this email+date, update it instead of creating a duplicate
      if (existingPendingBooking) {
        console.log("Found existing pending booking, updating instead of creating duplicate:", existingPendingBooking.id);

        const { data: updatedData, error: updateError } = await supabase
          .from("bookings")
          .update(bookingFields)
          .eq("id", existingPendingBooking.id)
          .select("id, reservation_number")
          .single();

        if (updateError) {
          console.error("Error updating existing booking:", updateError);
          throw new Error(updateError.message);
        }

        if (!updatedData) {
          throw new Error("No data returned from booking update");
        }

        console.log("Existing booking updated successfully:", updatedData.id, updatedData.reservation_number);
        return { bookingId: updatedData.id, reservationNumber: updatedData.reservation_number || existingPendingBooking.reservation_number || "" };
      }

      // No existing pending booking found — create a new one
      const reservationNumber = generateReservationNumber();

      const newBookingData = {
        ...bookingFields,
        status: "pending_review" as const,
        payment_status: "pending" as const,
        lifecycle_status: "pending",
        lead_source: "direct_site",
        reservation_number: reservationNumber,
        booking_origin: "website" as const,
      };

      console.log("Creating booking with data:", { 
        ...newBookingData, 
        signature: "[SIGNATURE_DATA]"
      });

      const { data, error } = await supabase
        .from("bookings")
        .insert(newBookingData)
        .select("id, reservation_number")
        .single();

      if (error) {
        console.error("Error creating booking:", error);
        throw new Error(error.message);
      }

      if (!data) {
        throw new Error("No data returned from booking creation");
      }

      console.log("Booking created successfully:", data.id, data.reservation_number);
      return { bookingId: data.id, reservationNumber: data.reservation_number || reservationNumber };
    },
  });
};
