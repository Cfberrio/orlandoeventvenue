import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ghl-backend-token",
};

// Valid status values
const VALID_STATUSES = [
  "pending_review",
  "confirmed",
  "cancelled",
  "completed",
  "needs_info",
  "needs_payment",
  "declined",
];

const VALID_LIFECYCLE_STATUSES = [
  "pending",
  "confirmed",
  "pre_event_ready",
  "in_progress",
  "post_event",
  "closed_review_complete",
  "cancelled",
];

/**
 * Edge function called by GHL to update booking status/lifecycle_status.
 * Requires x-ghl-backend-token header for authentication.
 * GHL sends custom data under body.customData object.
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    // Validate GHL token
    const expectedToken = Deno.env.get("GHL_BACKEND_TOKEN");
    const incomingToken = req.headers.get("x-ghl-backend-token");

    if (!expectedToken || !incomingToken || incomingToken !== expectedToken) {
      console.error("Invalid or missing GHL token");
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid or missing token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body safely
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      console.error("Failed to parse JSON body");
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid JSON" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the full body for debugging
    console.log("GHL webhook body:", JSON.stringify(body, null, 2));

    // Extract customData - GHL wraps custom fields in customData object
    const customData = (body.customData ?? body.custom_data ?? {}) as Record<string, unknown>;

    // Extract booking_id with fallbacks
    const booking_id =
      customData.booking_id ??
      customData.bookingId ??
      body.booking_id ??
      null;

    // Extract status values with fallbacks
    const new_status =
      customData.new_status ??
      body.new_status ??
      null;

    const new_lifecycle_status =
      customData.new_lifecycle_status ??
      body.new_lifecycle_status ??
      null;

    // Validate required fields
    if (!booking_id) {
      console.error("booking_id is required. Body received:", JSON.stringify(body, null, 2));
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!new_status && !new_lifecycle_status) {
      return new Response(
        JSON.stringify({ ok: false, error: "At least one of new_status or new_lifecycle_status is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate status values if provided
    if (new_status && !VALID_STATUSES.includes(new_status as string)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid status: ${new_status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new_lifecycle_status && !VALID_LIFECYCLE_STATUSES.includes(new_lifecycle_status as string)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid lifecycle_status: ${new_lifecycle_status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch current booking to verify it exists and get current values
    const { data: currentBooking, error: fetchError } = await supabase
      .from("bookings")
      .select("id, status, lifecycle_status")
      .eq("id", booking_id)
      .maybeSingle();

    if (fetchError) {
      console.error("Error fetching booking:", fetchError);
      return new Response(
        JSON.stringify({ ok: false, error: "Database error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!currentBooking) {
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Store previous values for logging
    const from_status = currentBooking.status;
    const from_lifecycle = currentBooking.lifecycle_status;

    // Build update object
    const updateData: Record<string, string> = {
      updated_at: new Date().toISOString(),
    };
    if (new_status) {
      updateData.status = new_status as string;
    }
    if (new_lifecycle_status) {
      updateData.lifecycle_status = new_lifecycle_status as string;
    }

    // Update the booking
    const { error: updateError } = await supabase
      .from("bookings")
      .update(updateData)
      .eq("id", booking_id);

    if (updateError) {
      console.error("Error updating booking:", updateError);
      return new Response(
        JSON.stringify({ ok: false, error: "DB update failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the status change in booking_events
    const { error: eventError } = await supabase
      .from("booking_events")
      .insert({
        booking_id,
        event_type: "ghl_status_change",
        channel: "ghl",
        metadata: {
          from_status,
          to_status: new_status || from_status,
          from_lifecycle,
          to_lifecycle: new_lifecycle_status || from_lifecycle,
          timestamp: new Date().toISOString(),
        },
      });

    if (eventError) {
      console.error("Error logging event:", eventError);
      // Don't fail the request, just log the error
    }

    console.log(`Booking ${booking_id} updated: status=${new_status || 'unchanged'}, lifecycle=${new_lifecycle_status || 'unchanged'}`);

    return new Response(
      JSON.stringify({
        ok: true,
        booking_id,
        new_status: new_status || from_status,
        new_lifecycle_status: new_lifecycle_status || from_lifecycle,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("Error in ghlUpdateBookingStatus:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});