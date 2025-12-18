import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * This edge function is called whenever a booking transitions to 'pre_event_ready'.
 * It triggers both:
 * 1. schedule-host-report-reminders - to schedule host report step changes
 * 2. schedule-balance-payment - to schedule balance payment reminders
 * 
 * This ensures a clean separation of concerns and consistent automation triggering.
 */
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

    console.log("=== trigger-booking-automation ===");
    console.log("Processing booking:", booking_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify booking exists and is in pre_event_ready
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, reservation_number, lifecycle_status, payment_status")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Booking ${booking.reservation_number}: lifecycle=${booking.lifecycle_status}, payment=${booking.payment_status}`);

    const results: Record<string, unknown> = {
      success: true,
      booking_id,
      reservation_number: booking.reservation_number,
    };

    // 1. Call schedule-host-report-reminders
    console.log("Calling schedule-host-report-reminders...");
    try {
      const hostReportResponse = await fetch(
        `${supabaseUrl}/functions/v1/schedule-host-report-reminders`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ booking_id }),
        }
      );

      const hostReportResult = await hostReportResponse.json();
      results.host_report_scheduling = {
        success: hostReportResponse.ok,
        ...hostReportResult,
      };
      console.log("Host report scheduling result:", JSON.stringify(hostReportResult));
    } catch (err) {
      console.error("Error calling schedule-host-report-reminders:", err);
      results.host_report_scheduling = {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }

    // 2. Call schedule-balance-payment (only if lifecycle is pre_event_ready)
    if (booking.lifecycle_status === "pre_event_ready") {
      console.log("Calling schedule-balance-payment...");
      try {
        const balanceResponse = await fetch(
          `${supabaseUrl}/functions/v1/schedule-balance-payment`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({ booking_id }),
          }
        );

        const balanceResult = await balanceResponse.json();
        results.balance_payment_scheduling = {
          success: balanceResponse.ok,
          ...balanceResult,
        };
        console.log("Balance payment scheduling result:", JSON.stringify(balanceResult));
      } catch (err) {
        console.error("Error calling schedule-balance-payment:", err);
        results.balance_payment_scheduling = {
          success: false,
          error: err instanceof Error ? err.message : "Unknown error",
        };
      }
    } else {
      console.log(`Skipping balance payment scheduling - lifecycle is ${booking.lifecycle_status}`);
      results.balance_payment_scheduling = {
        skipped: true,
        reason: `lifecycle_status is ${booking.lifecycle_status}`,
      };
    }

    // Log the automation trigger
    await supabase.from("booking_events").insert({
      booking_id: booking_id,
      event_type: "booking_automation_triggered",
      channel: "system",
      metadata: {
        lifecycle_status: booking.lifecycle_status,
        payment_status: booking.payment_status,
        host_report_result: results.host_report_scheduling,
        balance_payment_result: results.balance_payment_scheduling,
      },
    });

    return new Response(JSON.stringify(results), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in trigger-booking-automation:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
