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
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Validate GHL token
    const ghlToken = req.headers.get("x-ghl-backend-token");
    const expectedToken = Deno.env.get("GHL_BACKEND_TOKEN");

    if (!expectedToken) {
      console.error("GHL_BACKEND_TOKEN not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "Server configuration error" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!ghlToken || ghlToken !== expectedToken) {
      console.error("Invalid or missing GHL token");
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await req.json();
    const { booking_id, new_status, new_lifecycle_status } = body;

    // Validate required fields
    if (!booking_id) {
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

    // Validate status values
    if (new_status && !VALID_STATUSES.includes(new_status)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid status: ${new_status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (new_lifecycle_status && !VALID_LIFECYCLE_STATUSES.includes(new_lifecycle_status)) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid lifecycle_status: ${new_lifecycle_status}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch current booking
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
    const updateData: Record<string, string> = {};
    if (new_status) {
      updateData.status = new_status;
    }
    if (new_lifecycle_status) {
      updateData.lifecycle_status = new_lifecycle_status;
    }

    // Simple protection against obviously invalid transitions
    if (from_lifecycle === "cancelled" && new_lifecycle_status && new_lifecycle_status !== "cancelled") {
      console.warn(`Warning: Attempting to transition cancelled booking ${booking_id} to ${new_lifecycle_status}`);
      // Log but still allow - GHL has the business logic
    }

    // Update the booking
    const { error: updateError } = await supabase
      .from("bookings")
      .update(updateData)
      .eq("id", booking_id);

    if (updateError) {
      console.error("Error updating booking:", updateError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to update booking" }),
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
