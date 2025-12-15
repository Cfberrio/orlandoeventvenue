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

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const booking_id = body.booking_id;

    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Processing balance payment scheduling for booking:", booking_id);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if not deposit_paid
    if (booking.payment_status !== "deposit_paid") {
      console.log("Skipping - payment status is not deposit_paid:", booking.payment_status);
      return new Response(JSON.stringify({ 
        success: true, 
        action: "skipped",
        reason: `Payment status is ${booking.payment_status}, not deposit_paid`
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if already fully paid
    if (booking.payment_status === "fully_paid") {
      console.log("Skipping - already fully paid");
      return new Response(JSON.stringify({ 
        success: true, 
        action: "skipped",
        reason: "Already fully paid"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if any balance jobs are already scheduled for this booking
    const { data: existingJobs } = await supabase
      .from("scheduled_jobs")
      .select("id, job_type")
      .eq("booking_id", booking_id)
      .in("job_type", ["balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"])
      .in("status", ["pending", "completed"]);

    if (existingJobs && existingJobs.length > 0) {
      console.log("Skipping - balance jobs already exist for this booking:", existingJobs.map(j => j.job_type));
      return new Response(JSON.stringify({ 
        success: true, 
        action: "skipped",
        reason: "Balance payment jobs already scheduled"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate days until event (using Orlando timezone approximation)
    const today = new Date();
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const eventDate = new Date(booking.event_date + "T00:00:00");
    
    const diffMs = eventDate.getTime() - todayStart.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    console.log(`Event date: ${booking.event_date}, Days until event: ${diffDays}`);

    // Helper to add hours to a date
    const addHours = (date: Date, hours: number) => new Date(date.getTime() + hours * 60 * 60 * 1000);

    if (diffDays <= 15) {
      // ===============================
      // SHORT NOTICE: Max 2 balance links
      // ===============================
      console.log("Short notice booking (≤15 days) - creating link immediately + scheduling 1 retry");
      
      // 1) Create balance payment link immediately (first link)
      const response = await fetch(
        `${supabaseUrl}/functions/v1/create-balance-payment-link`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-ghl-backend-token": Deno.env.get("GHL_BACKEND_TOKEN") || "",
          },
          body: JSON.stringify({ booking_id }),
        }
      );

      const result = await response.json();
      
      if (!response.ok) {
        console.error("Failed to create initial balance payment link:", result);
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Failed to create balance payment link",
          details: result
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("First balance payment link created:", result.payment_url);

      // Log event for first link
      await supabase.from("booking_events").insert({
        booking_id: booking_id,
        event_type: "balance_payment_retry_scheduled",
        channel: "system",
        metadata: {
          attempt: 1,
          type: "short_notice",
          days_until_event: diffDays,
          created_immediately: true,
        },
      });

      // 2) Schedule retry #2 for 48 hours later
      const retryAt = addHours(new Date(), 48);

      const { error: insertError } = await supabase
        .from("scheduled_jobs")
        .insert({
          job_type: "balance_retry_2",
          booking_id: booking_id,
          run_at: retryAt.toISOString(),
          status: "pending",
        });

      if (insertError) {
        console.error("Failed to schedule retry job:", insertError);
      } else {
        console.log(`Scheduled balance_retry_2 for: ${retryAt.toISOString()}`);
        
        await supabase.from("booking_events").insert({
          booking_id: booking_id,
          event_type: "balance_payment_retry_scheduled",
          channel: "system",
          metadata: {
            attempt: 2,
            type: "short_notice",
            scheduled_for: retryAt.toISOString(),
          },
        });
      }

      return new Response(JSON.stringify({ 
        success: true, 
        action: "short_notice_scheduled",
        first_link_created: true,
        payment_url: result.payment_url,
        retry_scheduled_at: retryAt.toISOString(),
        days_until_event: diffDays,
        max_attempts: 2
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else {
      // ===============================
      // LONG NOTICE: Max 3 balance links
      // ===============================
      console.log("Long notice booking (>15 days) - scheduling 3 retry jobs");

      // Calculate run times
      const firstRun = new Date(eventDate);
      firstRun.setDate(firstRun.getDate() - 15); // 15 days before event
      
      const secondRun = addHours(firstRun, 48);   // 48h after first
      const thirdRun = addHours(secondRun, 48);   // 48h after second

      console.log(`Scheduling jobs: Link #1 at ${firstRun.toISOString()}, Link #2 at ${secondRun.toISOString()}, Link #3 at ${thirdRun.toISOString()}`);

      // Insert all 3 scheduled jobs
      const jobsToInsert = [
        {
          job_type: "balance_retry_1",
          booking_id: booking_id,
          run_at: firstRun.toISOString(),
          status: "pending",
        },
        {
          job_type: "balance_retry_2",
          booking_id: booking_id,
          run_at: secondRun.toISOString(),
          status: "pending",
        },
        {
          job_type: "balance_retry_3",
          booking_id: booking_id,
          run_at: thirdRun.toISOString(),
          status: "pending",
        },
      ];

      const { error: insertError } = await supabase
        .from("scheduled_jobs")
        .insert(jobsToInsert);

      if (insertError) {
        console.error("Failed to schedule jobs:", insertError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Failed to schedule jobs",
          details: insertError
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log events for all 3 scheduled links
      const events = [
        {
          booking_id: booking_id,
          event_type: "balance_payment_retry_scheduled",
          channel: "system",
          metadata: {
            attempt: 1,
            type: "long_notice",
            scheduled_for: firstRun.toISOString(),
            days_until_event: diffDays,
          },
        },
        {
          booking_id: booking_id,
          event_type: "balance_payment_retry_scheduled",
          channel: "system",
          metadata: {
            attempt: 2,
            type: "long_notice",
            scheduled_for: secondRun.toISOString(),
          },
        },
        {
          booking_id: booking_id,
          event_type: "balance_payment_retry_scheduled",
          channel: "system",
          metadata: {
            attempt: 3,
            type: "long_notice",
            scheduled_for: thirdRun.toISOString(),
          },
        },
      ];

      await supabase.from("booking_events").insert(events);

      console.log("All 3 balance payment jobs scheduled successfully");

      return new Response(JSON.stringify({ 
        success: true, 
        action: "long_notice_scheduled",
        scheduled_jobs: [
          { attempt: 1, job_type: "balance_retry_1", run_at: firstRun.toISOString() },
          { attempt: 2, job_type: "balance_retry_2", run_at: secondRun.toISOString() },
          { attempt: 3, job_type: "balance_retry_3", run_at: thirdRun.toISOString() },
        ],
        days_until_event: diffDays,
        max_attempts: 3
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

  } catch (error: unknown) {
    console.error("Error in schedule-balance-payment:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
