import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { BookingFormData } from "@/pages/Book";
import { format } from "date-fns";

interface CreateBookingResult {
  bookingId: string;
}

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

      // Map form data to database columns
      const bookingData = {
        booking_type: formData.bookingType as "hourly" | "daily",
        event_date: format(formData.date, "yyyy-MM-dd"),
        start_time: formData.bookingType === "hourly" ? formData.startTime : null,
        end_time: formData.bookingType === "hourly" ? formData.endTime : null,
        number_of_guests: formData.numberOfGuests || 1,
        event_type: formData.eventType,
        event_type_other: formData.eventType === "other" ? formData.eventTypeOther : null,
        client_notes: formData.notes || null,
        package: (formData.package || "none") as "none" | "basic" | "led" | "workshop",
        setup_breakdown: formData.setupBreakdown || false,
        tablecloths: formData.tablecloths || false,
        tablecloth_quantity: formData.tableclothQuantity || 0,
        base_rental: formData.pricing.baseRental,
        cleaning_fee: formData.pricing.cleaningFee,
        package_cost: formData.pricing.packageCost,
        optional_services: formData.pricing.optionalServices,
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
        status: "pending_review" as const,
        payment_status: "pending" as const,
        lifecycle_status: "pending",
        lead_source: "direct_site",
      };

      console.log("Creating booking with data:", { 
        ...bookingData, 
        signature: "[SIGNATURE_DATA]" // Don't log signature data
      });

      const { data, error } = await supabase
        .from("bookings")
        .insert(bookingData)
        .select("id")
        .single();

      if (error) {
        console.error("Error creating booking:", error);
        throw new Error(error.message);
      }

      if (!data) {
        throw new Error("No data returned from booking creation");
      }

      console.log("Booking created successfully:", data.id);
      return { bookingId: data.id };
    },
  });
};
