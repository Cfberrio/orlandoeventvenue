import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Edge function to get the Custodial staff email for a booking.
 * Used by GHL workflows to send cleaning report emails.
 * 
 * Input: { booking_id: string, purpose?: string }
 * Output: 
 *   - Success: { ok: true, booking_id, custodial_email, custodial_staff_id, custodial_name, custodial_count, staffEmail }
 *   - No custodial: { ok: false, booking_id, custodial_email: null, custodial_count: 0, error: "NO_CUSTODIAL_ASSIGNED" }
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id, purpose } = await req.json();

    console.log(`[get-custodial-staff] Request: booking_id=${booking_id}, purpose=${purpose || "not specified"}`);

    if (!booking_id) {
      console.error("[get-custodial-staff] Missing booking_id");
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Supabase credentials
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch Custodial staff assignments for this booking, ordered by created_at ASC
    const { data: custodialAssignments, error: staffError } = await supabase
      .from("booking_staff_assignments")
      .select(`
        staff_id,
        assignment_role,
        created_at,
        staff_members (
          id,
          full_name,
          email
        )
      `)
      .eq("booking_id", booking_id)
      .eq("assignment_role", "Custodial")
      .order("created_at", { ascending: true });

    if (staffError) {
      console.error("[get-custodial-staff] Error fetching staff:", staffError);
      return new Response(
        JSON.stringify({ ok: false, error: staffError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const custodialCount = custodialAssignments?.length || 0;

    console.log(`[get-custodial-staff] Found ${custodialCount} custodial assignment(s) for booking ${booking_id}`);

    // No custodial assigned
    if (custodialCount === 0) {
      console.warn(`[get-custodial-staff] NO_CUSTODIAL_ASSIGNED for booking ${booking_id}`);
      return new Response(
        JSON.stringify({
          ok: false,
          booking_id,
          custodial_email: null,
          custodial_staff_id: null,
          custodial_name: null,
          custodial_count: 0,
          staffEmail: null, // Backwards compatibility
          error: "NO_CUSTODIAL_ASSIGNED",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get the first (oldest) custodial assignment
    const firstCustodial = custodialAssignments[0];
    const staffMember = firstCustodial.staff_members as unknown as { id: string; full_name: string; email: string } | null;

    const custodial_email = staffMember?.email || null;
    const custodial_name = staffMember?.full_name || null;
    const custodial_staff_id = staffMember?.id || null;

    console.log(`[get-custodial-staff] Returning custodial: email=${custodial_email}, name=${custodial_name}, count=${custodialCount}`);

    return new Response(
      JSON.stringify({
        ok: true,
        booking_id,
        custodial_email,
        custodial_staff_id,
        custodial_name,
        custodial_count: custodialCount,
        // Backwards compatibility: staffEmail = custodial_email
        staffEmail: custodial_email,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("[get-custodial-staff] Error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
