import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALERT_EMAIL = "orlandoglobalministries@gmail.com";

/**
 * Send instant critical failure alert email
 */
async function sendCriticalAlert(functionName: string, reservationNumber: string, errorMsg: string, bookingId?: string): Promise<void> {
  try {
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailPassword) return;

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
    });

    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#dc2626;">CRITICAL FAILURE: ${functionName}</h2><p><b>Reservation:</b> ${reservationNumber}</p><p><b>Error:</b> ${errorMsg}</p><p><b>Time:</b> ${timestamp} EST</p>${bookingId ? `<p><b>Booking ID:</b> ${bookingId}</p>` : ""}<p style="margin-top:20px;color:#666;">This is an automated alert - immediate action required.</p></body></html>`;

    await client.send({
      from: `"OEV Alert" <${gmailUser}>`,
      to: ALERT_EMAIL,
      subject: `🚨 CRITICAL: ${functionName} Failed for ${reservationNumber}`,
      html,
    });
    await client.close();
    console.log(`[ALERT] Critical failure alert sent for ${reservationNumber}`);
  } catch (alertErr) {
    console.error("[ALERT] Failed to send critical alert:", alertErr);
  }
}

/**
 * Log critical error to booking_events table
 */
async function logCriticalError(supabase: any, bookingId: string, functionName: string, error: Error): Promise<void> {
  try {
    await supabase.from("booking_events").insert({
      booking_id: bookingId,
      event_type: `${functionName.replace(/-/g, "_")}_critical_failure`,
      channel: "system",
      metadata: {
        error_message: error.message,
        error_stack: error.stack?.substring(0, 500),
        timestamp: new Date().toISOString(),
        requires_manual_intervention: true,
      },
    });
  } catch (logErr) {
    console.error("Failed to log critical error:", logErr);
  }
}

// Orlando offset hours (EST = -5)
const ORLANDO_OFFSET_HOURS = -5;

/**
 * Converts a date string (YYYY-MM-DD) and time string (HH:MM:SS) to Orlando local time
 * and returns the equivalent UTC Date object
 */
function toOrlandoUTC(dateStr: string, timeStr: string): Date {
  const localDateTimeStr = `${dateStr}T${timeStr}`;
  const localDate = new Date(localDateTimeStr);
  const utcTime = localDate.getTime() - (ORLANDO_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(utcTime);
}

serve(async (req) => {
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
    const force_reschedule = body.force_reschedule === true;

    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("=== schedule-guest-feedback ===");
    console.log("Processing booking:", booking_id);
    console.log("Force reschedule:", force_reschedule);

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

    // Must have event_date to proceed
    if (!booking.event_date) {
      console.error("Booking has no event_date - cannot schedule guest feedback");
      return new Response(JSON.stringify({ 
        error: "Booking has no event_date",
        booking_id 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate event start time in Orlando timezone
    let eventStartOrlando: Date;

    if (booking.booking_type === "daily") {
      const startTimeStr = booking.start_time || "10:00:00";
      eventStartOrlando = toOrlandoUTC(booking.event_date, startTimeStr);
      console.log(`Daily booking - Orlando start time: ${startTimeStr}`);
    } else if (booking.start_time) {
      eventStartOrlando = toOrlandoUTC(booking.event_date, booking.start_time);
      console.log(`Hourly booking - start: ${booking.start_time}`);
    } else {
      eventStartOrlando = toOrlandoUTC(booking.event_date, "10:00:00");
      console.log(`Hourly booking without times - using fallback: 10:00 AM`);
    }

    console.log(`Event start (UTC): ${eventStartOrlando.toISOString()}`);

    // Calculate event END time
    let eventEndOrlando: Date;

    if (booking.end_time) {
      // Use actual end_time if provided
      eventEndOrlando = toOrlandoUTC(booking.event_date, booking.end_time);
      console.log(`Event has end_time: ${booking.end_time}`);
    } else {
      // Fallback based on booking_type
      const eventStartMs = eventStartOrlando.getTime();
      if (booking.booking_type === "daily") {
        // Daily: assume 24h duration
        eventEndOrlando = new Date(eventStartMs + (24 * 60 * 60 * 1000));
        console.log(`Daily booking - assuming 24h duration`);
      } else {
        // Hourly: assume 4h duration
        eventEndOrlando = new Date(eventStartMs + (4 * 60 * 60 * 1000));
        console.log(`Hourly booking - assuming 4h duration`);
      }
    }

    console.log(`Event end (UTC): ${eventEndOrlando.toISOString()}`);

    // Calculate feedback time: 30 minutes after event end
    const FEEDBACK_DELAY_MINUTES = 30;
    const feedbackTimeMs = eventEndOrlando.getTime() + (FEEDBACK_DELAY_MINUTES * 60 * 1000);
    const feedbackTime = new Date(feedbackTimeMs);

    console.log(`Guest feedback time (event end + ${FEEDBACK_DELAY_MINUTES}min): ${feedbackTime.toISOString()}`);

    const now = new Date();
    const nowMs = now.getTime();

    // Check if feedback time already passed
    if (feedbackTimeMs <= nowMs) {
      console.log("Feedback time already passed - not creating job");
      responseData.feedback_time_passed = true;
      responseData.feedback_time = feedbackTime.toISOString();
      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // If force_reschedule, cancel any existing pending jobs
    if (force_reschedule) {
      console.log("force_reschedule=true → cancelling pending guest feedback jobs");
      const { data: cancelledJobs, error: cancelErr } = await supabase
        .from("scheduled_jobs")
        .update({ 
          status: "cancelled", 
          last_error: "force_reschedule",
          updated_at: new Date().toISOString() 
        })
        .eq("booking_id", booking_id)
        .eq("job_type", "guest_feedback_post_event")
        .in("status", ["pending", "failed"])
        .select();

      if (cancelErr) {
        console.error("Error cancelling jobs for reschedule:", cancelErr);
      } else {
        console.log(`Cancelled ${cancelledJobs?.length || 0} jobs for reschedule`);
        responseData.jobs_cancelled_for_reschedule = cancelledJobs?.length || 0;
      }
    }

    // Check if job already exists (unless force_reschedule)
    if (!force_reschedule) {
      const { data: existingJobs } = await supabase
        .from("scheduled_jobs")
        .select("id, job_type")
        .eq("booking_id", booking_id)
        .eq("job_type", "guest_feedback_post_event")
        .eq("status", "pending");

      if (existingJobs && existingJobs.length > 0) {
        console.log("Guest feedback job already exists - not creating duplicate");
        responseData.job_already_exists = true;
        return new Response(JSON.stringify(responseData), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Create the job
    const { error: insertError } = await supabase
      .from("scheduled_jobs")
      .insert({
        job_type: "guest_feedback_post_event",
        booking_id: booking_id,
        run_at: feedbackTime.toISOString(),
        status: "pending",
      });

    if (insertError) {
      console.error("Failed to create guest feedback job:", insertError);
      throw new Error(`Failed to create job: ${insertError.message}`);
    }

    console.log(`Created guest feedback job - run_at: ${feedbackTime.toISOString()}`);

    // Log event
    await supabase.from("booking_events").insert({
      booking_id: booking_id,
      event_type: "guest_feedback_scheduled",
      channel: "system",
      metadata: {
        job_type: "guest_feedback_post_event",
        run_at: feedbackTime.toISOString(),
        event_end: eventEndOrlando.toISOString(),
        feedback_delay_minutes: FEEDBACK_DELAY_MINUTES,
        booking_type: booking.booking_type,
      },
    });

    responseData.job_created = {
      job_type: "guest_feedback_post_event",
      run_at: feedbackTime.toISOString(),
    };

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in schedule-guest-feedback:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    // Send critical alert
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.booking_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        const { data: booking } = await supabase
          .from("bookings")
          .select("reservation_number")
          .eq("id", body.booking_id)
          .single();
        
        if (booking) {
          const err = error instanceof Error ? error : new Error(errorMessage);
          await sendCriticalAlert("schedule-guest-feedback", booking.reservation_number || body.booking_id, errorMessage, body.booking_id);
          await logCriticalError(supabase, body.booking_id, "schedule-guest-feedback", err);
        }
      }
    } catch (alertErr) {
      console.error("Error sending failure alert:", alertErr);
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
