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

    // Skip if balance payment link already exists
    if (booking.balance_payment_url) {
      console.log("Skipping - balance payment link already exists");
      return new Response(JSON.stringify({ 
        success: true, 
        action: "skipped",
        reason: "Balance payment link already exists"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check if a job is already scheduled for this booking
    const { data: existingJob } = await supabase
      .from("scheduled_jobs")
      .select("id")
      .eq("booking_id", booking_id)
      .eq("job_type", "create_balance_payment_link")
      .eq("status", "pending")
      .maybeSingle();

    if (existingJob) {
      console.log("Skipping - job already scheduled for this booking");
      return new Response(JSON.stringify({ 
        success: true, 
        action: "skipped",
        reason: "Job already scheduled"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate days until event (using Orlando timezone)
    const today = new Date();
    // Reset to start of day in UTC for comparison
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const eventDate = new Date(booking.event_date + "T00:00:00");
    
    const diffMs = eventDate.getTime() - todayStart.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    console.log(`Event date: ${booking.event_date}, Days until event: ${diffDays}`);

    if (diffDays <= 15) {
      // Short notice: Create balance payment link immediately
      console.log("Short notice booking - creating balance payment link immediately");
      
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
        console.error("Failed to create balance payment link:", result);
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Failed to create balance payment link",
          details: result
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      console.log("Balance payment link created immediately:", result.payment_url);

      return new Response(JSON.stringify({ 
        success: true, 
        action: "created_immediately",
        payment_url: result.payment_url,
        days_until_event: diffDays
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    } else {
      // Event is > 15 days away: Schedule job for event_date - 15 days
      const runAt = new Date(eventDate);
      runAt.setDate(runAt.getDate() - 15);
      
      console.log(`Scheduling balance payment link creation for: ${runAt.toISOString()}`);

      const { error: insertError } = await supabase
        .from("scheduled_jobs")
        .insert({
          job_type: "create_balance_payment_link",
          booking_id: booking_id,
          run_at: runAt.toISOString(),
          status: "pending",
        });

      if (insertError) {
        console.error("Failed to schedule job:", insertError);
        return new Response(JSON.stringify({ 
          success: false, 
          error: "Failed to schedule job",
          details: insertError
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Log the event
      await supabase.from("booking_events").insert({
        booking_id: booking_id,
        event_type: "balance_payment_link_scheduled",
        channel: "system",
        metadata: {
          scheduled_for: runAt.toISOString(),
          days_until_event: diffDays,
        },
      });

      console.log("Job scheduled successfully");

      return new Response(JSON.stringify({ 
        success: true, 
        action: "scheduled",
        scheduled_for: runAt.toISOString(),
        days_until_event: diffDays
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
