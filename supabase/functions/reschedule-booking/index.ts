import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: "method_not_allowed", 
        message: "Only POST requests are supported" 
      }),
      { 
        status: 405, 
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }

  try {
    // Get auth token
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized", message: "Missing Authorization header" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Create client with user token for auth check
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: {
        headers: { Authorization: authHeader },
      },
    });

    // Verify user is authenticated
    const { data: { user }, error: authError } = await supabaseClient.auth.getUser(token);
    
    if (authError || !user) {
      console.error("Auth error:", authError);
      return new Response(
        JSON.stringify({ ok: false, error: "invalid_token", message: "Invalid or expired token" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if user is admin
    const { data: roles, error: roleError } = await supabaseClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .limit(1);

    if (roleError || !roles || roles.length === 0) {
      console.error("Role check failed:", roleError);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "admin_required", 
          message: "Admin access required to reschedule bookings" 
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Parse request body
    const body = await req.json();
    const {
      booking_id,
      event_date,
      start_time,
      end_time,
      // booking_type removed - booking type never changes
      reason,
    } = body;

    // Validate required fields
    if (!booking_id || !event_date) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "validation_failed",
          message: "Missing required fields",
          missing_fields: [
            ...(!booking_id ? ["booking_id"] : []),
            ...(!event_date ? ["event_date"] : []),
          ],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("=== reschedule-booking ===");
    console.log("Booking ID:", booking_id);
    console.log("New date:", event_date);
    console.log("Actor:", user.id);

    // Call RPC function
    const { data: rpcResult, error: rpcError } = await supabaseClient.rpc(
      "reschedule_booking",
      {
        p_booking_id: booking_id,
        p_new_date: event_date,
        p_new_start_time: start_time || null,
        p_new_end_time: end_time || null,
        // p_new_booking_type removed - booking type never changes
        p_reason: reason || null,
        p_actor_id: user.id,
      }
    );

    if (rpcError) {
      console.error("RPC error:", rpcError);
      return new Response(
        JSON.stringify({
          ok: false,
          error: "rpc_failed",
          message: "Database operation failed",
          detail: rpcError.message,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check RPC result
    if (!rpcResult.ok) {
      // Return business error (conflict, validation, etc)
      console.log("RPC returned error:", rpcResult.error);
      return new Response(JSON.stringify(rpcResult), {
        status: 200, // Business error, not HTTP error
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Booking rescheduled successfully");
    console.log("Jobs updated:", rpcResult.jobs_updated);
    console.log("Date shift days:", rpcResult.date_shift_days);

    // Job recreation no longer needed since booking_type never changes
    // Jobs are always shifted by date difference in the RPC function
    // GHL sync will happen automatically via trigger (no action needed here)
    console.log("GHL sync will be triggered automatically by database trigger");

    // Return success response
    return new Response(
      JSON.stringify({
        ...rpcResult,
        // jobs_recreated removed - no longer needed since booking_type never changes
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("Unexpected error:", error);
    const errorMessage = error instanceof Error ? error.message : "An unexpected error occurred";
    return new Response(
      JSON.stringify({
        ok: false,
        error: "unexpected_error",
        message: errorMessage,
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
