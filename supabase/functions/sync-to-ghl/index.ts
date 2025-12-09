import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Booking snapshot interface for GHL
interface BookingSnapshot {
  booking_id: string;
  reservation_number: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  booking_type: string | null;
  status: string | null;
  payment_status: string | null;
  lifecycle_status: string | null;
  number_of_guests: number | null;
  event_type: string | null;
  package: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  balance_amount: number | null;
  is_deposit_paid: boolean;
  is_fully_paid: boolean;
  has_staff_assigned: boolean;
  cleaning_report_completed: boolean;
  host_report_completed: boolean;
  review_received: boolean;
  pre_event_ready: string;
  customer: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  };
}

// Booking row type from database
interface BookingRow {
  id: string;
  reservation_number: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  booking_type: string | null;
  status: string | null;
  payment_status: string | null;
  lifecycle_status: string | null;
  number_of_guests: number | null;
  event_type: string | null;
  package: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  balance_amount: number | null;
  pre_event_ready: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Builds a complete booking snapshot for sending to GHL.
 * Fetches booking data and related info, computes boolean flags.
 */
async function buildBookingSnapshot(
  supabaseUrl: string,
  supabaseServiceKey: string,
  bookingId: string
): Promise<BookingSnapshot> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch the main booking record
  const { data: bookingData, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error("Error fetching booking:", bookingError);
    throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  }

  if (!bookingData) {
    throw new Error(`Booking not found: ${bookingId}`);
  }

  const booking = bookingData as BookingRow;

  // Fetch staff assignments count
  const { count: staffCount, error: staffError } = await supabase
    .from("booking_staff_assignments")
    .select("*", { count: "exact", head: true })
    .eq("booking_id", bookingId);

  if (staffError) {
    console.error("Error fetching staff assignments:", staffError);
  }

  // Check for completed cleaning reports
  const { data: cleaningReports, error: cleaningError } = await supabase
    .from("booking_cleaning_reports")
    .select("status")
    .eq("booking_id", bookingId)
    .eq("status", "completed");

  if (cleaningError) {
    console.error("Error fetching cleaning reports:", cleaningError);
  }

  // Check for submitted host reports
  const { data: hostReports, error: hostError } = await supabase
    .from("booking_host_reports")
    .select("id")
    .eq("booking_id", bookingId);

  if (hostError) {
    console.error("Error fetching host reports:", hostError);
  }

  // Check for reviews
  const { data: reviews, error: reviewError } = await supabase
    .from("booking_reviews")
    .select("id")
    .eq("booking_id", bookingId);

  if (reviewError) {
    console.error("Error fetching reviews:", reviewError);
  }

  // Compute boolean flags
  const has_staff_assigned = (staffCount || 0) >= 1;
  const is_deposit_paid = booking.payment_status === "deposit_paid" || booking.payment_status === "fully_paid";
  const is_fully_paid = booking.payment_status === "fully_paid";
  const cleaning_report_completed = (cleaningReports?.length || 0) > 0;
  const host_report_completed = (hostReports?.length || 0) > 0;
  const review_received = (reviews?.length || 0) > 0;
  const pre_event_ready = booking.pre_event_ready || 'false';

  // Build and return the snapshot
  return {
    booking_id: booking.id,
    reservation_number: booking.reservation_number,
    event_date: booking.event_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booking_type: booking.booking_type,
    status: booking.status,
    payment_status: booking.payment_status,
    lifecycle_status: booking.lifecycle_status,
    number_of_guests: booking.number_of_guests,
    event_type: booking.event_type,
    package: booking.package,
    total_amount: booking.total_amount ? Number(booking.total_amount) : null,
    deposit_amount: booking.deposit_amount ? Number(booking.deposit_amount) : null,
    balance_amount: booking.balance_amount ? Number(booking.balance_amount) : null,
    is_deposit_paid,
    is_fully_paid,
    has_staff_assigned,
    cleaning_report_completed,
    host_report_completed,
    review_received,
    pre_event_ready,
    customer: {
      full_name: booking.full_name,
      email: booking.email,
      phone: booking.phone,
    },
  };
}

/**
 * Edge function that sends a booking snapshot to GHL.
 * Called internally after important booking events.
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get GHL webhook URL from environment
    const ghlWebhookUrl = Deno.env.get("GHL_BOOKING_WEBHOOK_URL");
    if (!ghlWebhookUrl) {
      console.error("GHL_BOOKING_WEBHOOK_URL not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "GHL webhook URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Supabase credentials
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Build the booking snapshot
    console.log("Building snapshot for booking:", booking_id);
    const snapshot = await buildBookingSnapshot(supabaseUrl, supabaseServiceKey, booking_id);

    // Send to GHL
    console.log("Sending snapshot to GHL:", ghlWebhookUrl);
    const ghlResponse = await fetch(ghlWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      console.error("GHL returned non-2xx:", ghlResponse.status, errorText);
      // Log but don't crash - GHL might be temporarily unavailable
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "GHL returned error",
          ghl_status: ghlResponse.status 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Successfully sent snapshot to GHL for booking:", booking_id);
    return new Response(
      JSON.stringify({ ok: true, booking_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("Error in syncToGHL:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
