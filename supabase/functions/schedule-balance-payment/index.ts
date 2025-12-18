import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Orlando timezone offset: UTC-5 (EST)
const ORLANDO_OFFSET_HOURS = -5;

/**
 * Converts a date string to Orlando local midnight UTC
 */
function getOrlandoMidnight(dateStr: string): Date {
  const localDate = new Date(`${dateStr}T00:00:00`);
  return new Date(localDate.getTime() - (ORLANDO_OFFSET_HOURS * 60 * 60 * 1000));
}

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

    console.log("=== schedule-balance-payment ===");
    console.log("Processing booking:", booking_id);

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

    const responseData: Record<string, unknown> = {
      success: true,
      booking_id,
      reservation_number: booking.reservation_number,
    };

    // ===============================
    // PART 1: Schedule lifecycle transition job (set_lifecycle_in_progress)
    // ===============================
    if (booking.lifecycle_status === "pre_event_ready" && booking.event_date) {
      const { data: existingLifecycleJob } = await supabase
        .from("scheduled_jobs")
        .select("id")
        .eq("booking_id", booking_id)
        .eq("job_type", "set_lifecycle_in_progress")
        .in("status", ["pending"]);

      if (!existingLifecycleJob || existingLifecycleJob.length === 0) {
        let runAt: Date;
        if (booking.start_time) {
          // Combine event_date with start_time (Orlando local -> UTC)
          const localDateTimeStr = `${booking.event_date}T${booking.start_time}`;
          const localDate = new Date(localDateTimeStr);
          runAt = new Date(localDate.getTime() - (ORLANDO_OFFSET_HOURS * 60 * 60 * 1000));
        } else {
          // Daily booking: use 6 AM Orlando time
          const localDate = new Date(`${booking.event_date}T06:00:00`);
          runAt = new Date(localDate.getTime() - (ORLANDO_OFFSET_HOURS * 60 * 60 * 1000));
        }

        const { error: lifecycleJobError } = await supabase
          .from("scheduled_jobs")
          .insert({
            job_type: "set_lifecycle_in_progress",
            booking_id: booking_id,
            run_at: runAt.toISOString(),
            status: "pending",
          });

        if (lifecycleJobError) {
          console.error("Failed to schedule lifecycle job:", lifecycleJobError);
        } else {
          console.log(`Scheduled set_lifecycle_in_progress for: ${runAt.toISOString()}`);
          
          await supabase.from("booking_events").insert({
            booking_id: booking_id,
            event_type: "lifecycle_transition_scheduled",
            channel: "system",
            metadata: {
              job_type: "set_lifecycle_in_progress",
              scheduled_for: runAt.toISOString(),
              from_lifecycle: "pre_event_ready",
              to_lifecycle: "in_progress",
            },
          });

          responseData.lifecycle_job_scheduled = true;
          responseData.lifecycle_job_run_at = runAt.toISOString();
        }
      } else {
        console.log("Lifecycle job already exists for this booking, skipping");
        responseData.lifecycle_job_scheduled = false;
        responseData.lifecycle_job_reason = "already_exists";
      }
    }

    // ===============================
    // PART 2: Balance payment scheduling (ONLY balance - no host report logic)
    // ===============================

    // Skip if not deposit_paid
    if (booking.payment_status !== "deposit_paid") {
      console.log("Skipping balance payment scheduling - payment status is not deposit_paid:", booking.payment_status);
      responseData.balance_action = "skipped";
      responseData.balance_reason = `Payment status is ${booking.payment_status}, not deposit_paid`;
      
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Skip if already fully paid
    if (booking.payment_status === "fully_paid") {
      console.log("Skipping balance payment scheduling - already fully paid");
      responseData.balance_action = "skipped";
      responseData.balance_reason = "Already fully paid";
      
      return new Response(JSON.stringify(responseData), {
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
      responseData.balance_action = "skipped";
      responseData.balance_reason = "Balance payment jobs already scheduled";
      
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate days until event (using Orlando timezone)
    const now = new Date();
    const eventDateOrlando = getOrlandoMidnight(booking.event_date);
    const nowOrlandoMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    const diffMs = eventDateOrlando.getTime() - nowOrlandoMidnight.getTime();
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
          ...responseData,
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

      responseData.balance_action = "short_notice";
      responseData.balance_link_created = true;
      responseData.balance_retry_scheduled = retryAt.toISOString();
      responseData.days_until_event = diffDays;

    } else {
      // ===============================
      // LONG NOTICE: Schedule 3 balance retries
      // ===============================
      console.log("Long notice booking (>15 days) - scheduling 3 balance payment retries");

      // Calculate the first retry at T-15 days (9 AM Orlando time)
      const eventDateObj = new Date(booking.event_date + "T09:00:00");
      const fifteenDaysBefore = new Date(eventDateObj.getTime() - (ORLANDO_OFFSET_HOURS * 60 * 60 * 1000) - 15 * 24 * 60 * 60 * 1000);
      
      // Retry 1: T-15 days
      const retry1At = fifteenDaysBefore;
      // Retry 2: 48h after retry 1
      const retry2At = addHours(retry1At, 48);
      // Retry 3: 48h after retry 2
      const retry3At = addHours(retry2At, 48);

      const retries = [
        { job_type: "balance_retry_1", run_at: retry1At },
        { job_type: "balance_retry_2", run_at: retry2At },
        { job_type: "balance_retry_3", run_at: retry3At },
      ];

      for (const retry of retries) {
        const { error: insertError } = await supabase
          .from("scheduled_jobs")
          .insert({
            job_type: retry.job_type,
            booking_id: booking_id,
            run_at: retry.run_at.toISOString(),
            status: "pending",
          });

        if (insertError) {
          console.error(`Failed to schedule ${retry.job_type}:`, insertError);
        } else {
          console.log(`Scheduled ${retry.job_type} for: ${retry.run_at.toISOString()}`);
          
          await supabase.from("booking_events").insert({
            booking_id: booking_id,
            event_type: "balance_payment_retry_scheduled",
            channel: "system",
            metadata: {
              job_type: retry.job_type,
              type: "long_notice",
              scheduled_for: retry.run_at.toISOString(),
            },
          });
        }
      }

      responseData.balance_action = "long_notice";
      responseData.balance_retries_scheduled = retries.map(r => ({
        job_type: r.job_type,
        run_at: r.run_at.toISOString(),
      }));
      responseData.days_until_event = diffDays;
    }

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in schedule-balance-payment:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
