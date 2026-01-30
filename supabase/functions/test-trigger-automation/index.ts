import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Test endpoint to verify that the booking automation trigger is working.
 * 
 * Creates a test booking with lifecycle_status='confirmed',
 * then updates it to 'pre_event_ready' which should trigger the automation.
 * Waits a few seconds and checks if jobs were created.
 * Finally, cleans up the test data.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  let testBookingId: string | null = null;
  const errors: string[] = [];
  
  try {
    console.log("=== test-trigger-automation ===");
    console.log("Creating test booking...");

    // Get the default policy ID
    const { data: policy, error: policyError } = await supabase
      .from("booking_policies")
      .select("id")
      .eq("policy_name", "WEBSITE_FULL_FLOW")
      .single();

    if (policyError || !policy) {
      // Get any policy
      const { data: anyPolicy } = await supabase
        .from("booking_policies")
        .select("id")
        .limit(1)
        .single();
      
      if (!anyPolicy) {
        throw new Error("No booking policies found");
      }
    }

    const policyId = policy?.id || "";

    // Create test booking in "confirmed" state (NOT pre_event_ready yet)
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 45); // 45 days in future
    const eventDate = futureDate.toISOString().split("T")[0];

    const testReservation = `TEST-${Date.now().toString(36).toUpperCase()}`;

    const { data: testBooking, error: createError } = await supabase
      .from("bookings")
      .insert({
        reservation_number: testReservation,
        full_name: "Test Automation User",
        email: "test@automation.local",
        phone: "555-000-0000",
        event_date: eventDate,
        event_type: "Test Event",
        number_of_guests: 10,
        booking_type: "daily",
        status: "confirmed",
        lifecycle_status: "confirmed", // Start here, will change to pre_event_ready
        payment_status: "deposit_paid",
        policy_id: policyId,
        base_rental: 100,
        cleaning_fee: 50,
        deposit_amount: 75,
        balance_amount: 75,
        total_amount: 150,
        taxes_fees: 0,
        signature: "test",
        signer_name: "Test User",
        initials: "TU",
        signature_date: new Date().toISOString(),
        booking_origin: "internal",
        lead_source: "test_automation",
      })
      .select("id")
      .single();

    if (createError || !testBooking) {
      throw new Error(`Failed to create test booking: ${createError?.message}`);
    }

    testBookingId = testBooking.id;
    console.log(`Test booking created: ${testBookingId} (${testReservation})`);

    // Wait a moment for any insert triggers
    await sleep(1000);

    // Count jobs BEFORE the trigger
    const { data: jobsBefore } = await supabase
      .from("scheduled_jobs")
      .select("id")
      .eq("booking_id", testBookingId);

    const jobCountBefore = jobsBefore?.length || 0;
    console.log(`Jobs before trigger: ${jobCountBefore}`);

    // NOW update lifecycle_status to pre_event_ready - this should trigger automation
    console.log("Updating lifecycle_status to pre_event_ready...");
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ 
        lifecycle_status: "pre_event_ready",
        pre_event_ready: "true"
      })
      .eq("id", testBookingId);

    if (updateError) {
      throw new Error(`Failed to update booking: ${updateError.message}`);
    }

    // Wait for trigger and edge function to process
    console.log("Waiting 8 seconds for trigger to fire and edge function to process...");
    await sleep(8000);

    // Count jobs AFTER the trigger
    const { data: jobsAfter, error: jobsError } = await supabase
      .from("scheduled_jobs")
      .select("id, job_type, status, run_at")
      .eq("booking_id", testBookingId);

    if (jobsError) {
      errors.push(`Error fetching jobs: ${jobsError.message}`);
    }

    const jobCountAfter = jobsAfter?.length || 0;
    const newJobsCreated = jobCountAfter - jobCountBefore;

    console.log(`Jobs after trigger: ${jobCountAfter}`);
    console.log(`New jobs created: ${newJobsCreated}`);

    // Check for booking events related to automation
    const { data: events } = await supabase
      .from("booking_events")
      .select("event_type, metadata, created_at")
      .eq("booking_id", testBookingId)
      .order("created_at", { ascending: false })
      .limit(10);

    const automationEvents = events?.filter(e => 
      e.event_type.includes("automation") || 
      e.event_type.includes("scheduled") ||
      e.event_type.includes("balance") ||
      e.event_type.includes("host_report")
    ) || [];

    const success = newJobsCreated > 0 || automationEvents.length > 0;

    console.log(`Automation events found: ${automationEvents.length}`);
    console.log(`Test result: ${success ? "SUCCESS" : "FAILED"}`);

    // Cleanup: Delete test booking, jobs, and events
    console.log("Cleaning up test data...");

    await supabase.from("booking_events").delete().eq("booking_id", testBookingId);
    await supabase.from("scheduled_jobs").delete().eq("booking_id", testBookingId);
    await supabase.from("bookings").delete().eq("id", testBookingId);

    console.log("Cleanup complete");

    return new Response(
      JSON.stringify({
        success,
        test_booking_id: testBookingId,
        test_reservation: testReservation,
        jobs_before: jobCountBefore,
        jobs_after: jobCountAfter,
        jobs_created: newJobsCreated,
        automation_events: automationEvents.length,
        job_types: jobsAfter?.map(j => j.job_type) || [],
        events: automationEvents.map(e => e.event_type),
        errors: errors.length > 0 ? errors : undefined,
        message: success 
          ? "Trigger automation is working correctly!" 
          : "Trigger may not be working - no jobs or events created. Check trigger and edge function.",
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error: unknown) {
    console.error("Error in test-trigger-automation:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    // Attempt cleanup even on error
    if (testBookingId) {
      try {
        await supabase.from("booking_events").delete().eq("booking_id", testBookingId);
        await supabase.from("scheduled_jobs").delete().eq("booking_id", testBookingId);
        await supabase.from("bookings").delete().eq("id", testBookingId);
      } catch (cleanupErr) {
        console.error("Cleanup failed:", cleanupErr);
      }
    }

    return new Response(
      JSON.stringify({ 
        success: false,
        error: errorMessage,
        errors: [...errors, errorMessage],
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
