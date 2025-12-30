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

  try {
    console.log("=== backfill-balance-scheduling ===");

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Find orphaned bookings: deposit_paid, no balance_payment_url, no pending balance jobs, future event_date
    const today = new Date().toISOString().split("T")[0];
    
    const { data: orphanedBookings, error: fetchError } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, payment_status, balance_payment_url")
      .eq("payment_status", "deposit_paid")
      .gte("event_date", today)
      .or("balance_payment_url.is.null,balance_payment_url.eq.");

    if (fetchError) {
      console.error("Error fetching bookings:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to fetch bookings" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${orphanedBookings?.length || 0} potential orphaned bookings`);

    const results = {
      total_found: orphanedBookings?.length || 0,
      processed: 0,
      scheduled: 0,
      skipped: 0,
      errors: 0,
      details: [] as { booking_id: string; reservation_number: string | null; event_date: string; status: string; reason?: string }[],
    };

    for (const booking of orphanedBookings || []) {
      results.processed++;
      
      // Check if any balance jobs already exist for this booking
      const { data: existingJobs } = await supabase
        .from("scheduled_jobs")
        .select("id, job_type, status")
        .eq("booking_id", booking.id)
        .in("job_type", ["balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"])
        .in("status", ["pending", "completed"]);

      if (existingJobs && existingJobs.length > 0) {
        console.log(`Booking ${booking.id} already has balance jobs, skipping`);
        results.skipped++;
        results.details.push({
          booking_id: booking.id,
          reservation_number: booking.reservation_number,
          event_date: booking.event_date,
          status: "skipped",
          reason: `Already has ${existingJobs.length} balance job(s)`,
        });
        continue;
      }

      // Call schedule-balance-payment for this booking
      try {
        console.log(`Scheduling balance payment for booking ${booking.id} (${booking.reservation_number})`);
        
        const response = await fetch(
          `${supabaseUrl}/functions/v1/schedule-balance-payment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ booking_id: booking.id }),
          }
        );

        const result = await response.json();

        if (!response.ok) {
          console.error(`Failed to schedule for booking ${booking.id}:`, result);
          results.errors++;
          results.details.push({
            booking_id: booking.id,
            reservation_number: booking.reservation_number,
            event_date: booking.event_date,
            status: "error",
            reason: result.error || "Unknown error",
          });
          continue;
        }

        console.log(`Successfully scheduled for booking ${booking.id}:`, result.balance_action);
        results.scheduled++;
        results.details.push({
          booking_id: booking.id,
          reservation_number: booking.reservation_number,
          event_date: booking.event_date,
          status: "scheduled",
          reason: result.balance_action || "success",
        });

      } catch (err) {
        console.error(`Error calling schedule-balance-payment for ${booking.id}:`, err);
        results.errors++;
        results.details.push({
          booking_id: booking.id,
          reservation_number: booking.reservation_number,
          event_date: booking.event_date,
          status: "error",
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }

    console.log("=== Backfill complete ===");
    console.log(`Processed: ${results.processed}, Scheduled: ${results.scheduled}, Skipped: ${results.skipped}, Errors: ${results.errors}`);

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in backfill-balance-scheduling:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
