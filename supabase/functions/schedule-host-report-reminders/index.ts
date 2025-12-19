import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Orlando timezone offset: UTC-5 (EST) or UTC-4 (EDT)
// We'll use a simple -5 hours offset (EST) for consistency
const ORLANDO_OFFSET_HOURS = -5;

/**
 * Converts a date string (YYYY-MM-DD) and time string (HH:MM:SS) to Orlando local time
 * and returns the equivalent UTC Date object
 */
function toOrlandoUTC(dateStr: string, timeStr: string): Date {
  // Parse as Orlando local time
  const localDateTimeStr = `${dateStr}T${timeStr}`;
  const localDate = new Date(localDateTimeStr);
  
  // Convert Orlando local to UTC: add the offset (since Orlando is behind UTC)
  // If Orlando is at 09:00, UTC is 14:00 (09:00 - (-5) = 14:00)
  const utcTime = localDate.getTime() - (ORLANDO_OFFSET_HOURS * 60 * 60 * 1000);
  return new Date(utcTime);
}

/**
 * Gets current time in Orlando timezone
 */
function getNowInOrlando(): Date {
  const now = new Date();
  // Shift to Orlando time for comparison
  return new Date(now.getTime() + (ORLANDO_OFFSET_HOURS * 60 * 60 * 1000));
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

    console.log("=== schedule-host-report-reminders ===");
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

    // Check if host report is already completed
    const { data: hostReports } = await supabase
      .from("booking_host_reports")
      .select("id")
      .eq("booking_id", booking_id)
      .limit(1);

    const hostReportCompleted = hostReports && hostReports.length > 0;

    if (hostReportCompleted) {
      console.log("Host report already completed - cancelling any pending jobs");
      
      // Cancel any pending host report jobs
      const { data: pendingJobs, error: cancelError } = await supabase
        .from("scheduled_jobs")
        .update({ 
          status: "cancelled", 
          last_error: "host_report_already_completed",
          updated_at: new Date().toISOString() 
        })
        .eq("booking_id", booking_id)
        .in("job_type", ["host_report_pre_start", "host_report_during", "host_report_post"])
        .eq("status", "pending")
        .select();

      if (cancelError) {
        console.error("Error cancelling pending jobs:", cancelError);
      } else if (pendingJobs && pendingJobs.length > 0) {
        console.log(`Cancelled ${pendingJobs.length} pending host report jobs`);
      }

      responseData.host_report_completed = true;
      responseData.action = "cancelled_pending_jobs";
      responseData.jobs_cancelled = pendingJobs?.length || 0;

      return new Response(JSON.stringify(responseData), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Must have event_date to proceed
    if (!booking.event_date) {
      console.error("Booking has no event_date - cannot schedule host report reminders");
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
      // Daily bookings: use start_time if provided, else default 10:00 AM Orlando time
      const startTimeStr = booking.start_time || "10:00:00";
      eventStartOrlando = toOrlandoUTC(booking.event_date, startTimeStr);
      console.log(`Daily booking - Orlando start time: ${startTimeStr}`);
    } else if (booking.start_time) {
      // Hourly bookings with start_time
      eventStartOrlando = toOrlandoUTC(booking.event_date, booking.start_time);
      console.log(`Hourly booking - start: ${booking.start_time}`);
    } else {
      // Fallback: 10:00 AM Orlando time
      eventStartOrlando = toOrlandoUTC(booking.event_date, "10:00:00");
      console.log(`Hourly booking without times - using fallback: 10:00 AM`);
    }

    console.log(`Event start (UTC): ${eventStartOrlando.toISOString()}`);

    const now = new Date();
    console.log(`Current time (UTC): ${now.toISOString()}`);

    // Calculate the three timestamps for host report email scheduling:
    // pre_start = event_start - 7 days
    const t_pre_start = new Date(eventStartOrlando.getTime() - 7 * 24 * 60 * 60 * 1000);
    // during_event = event_start - 1 day
    const t_during_event = new Date(eventStartOrlando.getTime() - 1 * 24 * 60 * 60 * 1000);
    // post_event = event_start - 3 hours
    const t_post_event = new Date(eventStartOrlando.getTime() - 3 * 60 * 60 * 1000);

    console.log(`Host report scheduled times (UTC):`);
    console.log(`  pre_start (event-7d): ${t_pre_start.toISOString()}`);
    console.log(`  during_event (event-1d): ${t_during_event.toISOString()}`);
    console.log(`  post_event (event-3h): ${t_post_event.toISOString()}`);

    // Determine current step and catch-up logic
    let immediateStep: string | null = null;
    const jobsToCreate: { job_type: string; run_at: string }[] = [];

    if (now >= t_post_event) {
      // All times have passed - set to post_event
      immediateStep = "post_event";
      console.log("All times passed - setting immediately to post_event");
    } else if (now >= t_during_event) {
      // During event time has passed - set to during_event, schedule post
      immediateStep = "during_event";
      jobsToCreate.push({
        job_type: "host_report_post",
        run_at: t_post_event.toISOString(),
      });
      console.log("During event time passed - setting to during_event, scheduling post");
    } else if (now >= t_pre_start) {
      // Pre-start time has passed - set to pre_start, schedule during and post
      immediateStep = "pre_start";
      jobsToCreate.push({
        job_type: "host_report_during",
        run_at: t_during_event.toISOString(),
      });
      jobsToCreate.push({
        job_type: "host_report_post",
        run_at: t_post_event.toISOString(),
      });
      console.log("Pre-start time passed - setting to pre_start, scheduling during & post");
    } else {
      // All times are in the future - schedule all three
      jobsToCreate.push({
        job_type: "host_report_pre_start",
        run_at: t_pre_start.toISOString(),
      });
      jobsToCreate.push({
        job_type: "host_report_during",
        run_at: t_during_event.toISOString(),
      });
      jobsToCreate.push({
        job_type: "host_report_post",
        run_at: t_post_event.toISOString(),
      });
      console.log("All times in future - scheduling all three jobs");
    }

    // If there's an immediate step to set
    if (immediateStep) {
      // Only update if different from current
      if (booking.host_report_step !== immediateStep) {
        console.log(`Updating host_report_step from '${booking.host_report_step}' to '${immediateStep}'`);
        
        const { error: updateError } = await supabase
          .from("bookings")
          .update({ 
            host_report_step: immediateStep,
            updated_at: new Date().toISOString()
          })
          .eq("id", booking_id);

        if (updateError) {
          console.error("Failed to update host_report_step:", updateError);
        } else {
          // Log the event
          await supabase.from("booking_events").insert({
            booking_id: booking_id,
            event_type: "host_report_step_set_immediately",
            channel: "system",
            metadata: {
              new_step: immediateStep,
              previous_step: booking.host_report_step,
              reason: "catch_up_logic",
              t_pre_start: t_pre_start.toISOString(),
              t_during_event: t_during_event.toISOString(),
              t_post_event: t_post_event.toISOString(),
            },
          });

          // CRITICAL: Sync to GHL immediately after changing host_report_step
          console.log(`Calling sync-to-ghl for immediate step change`);
          try {
            const syncResponse = await fetch(
              `${supabaseUrl}/functions/v1/sync-to-ghl`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({ booking_id }),
              }
            );

            if (!syncResponse.ok) {
              const syncError = await syncResponse.text();
              console.error(`sync-to-ghl failed: ${syncError}`);
            } else {
              console.log(`sync-to-ghl completed successfully`);
            }
          } catch (syncErr) {
            console.error(`sync-to-ghl exception:`, syncErr);
          }

          responseData.immediate_step_set = true;
          responseData.host_report_step = immediateStep;
        }
      } else {
        console.log(`host_report_step already at '${immediateStep}' - no update needed`);
        responseData.immediate_step_set = false;
        responseData.host_report_step = immediateStep;
        responseData.reason = "already_at_step";
      }
    }

    // Create scheduled jobs (only if not already exist)
    if (jobsToCreate.length > 0) {
      // Check for existing pending jobs
      const { data: existingJobs } = await supabase
        .from("scheduled_jobs")
        .select("id, job_type")
        .eq("booking_id", booking_id)
        .in("job_type", jobsToCreate.map(j => j.job_type))
        .eq("status", "pending");

      const existingJobTypes = new Set(existingJobs?.map(j => j.job_type) || []);
      const newJobs = jobsToCreate.filter(j => !existingJobTypes.has(j.job_type));

      if (newJobs.length > 0) {
        const jobsToInsert = newJobs.map(j => ({
          job_type: j.job_type,
          booking_id: booking_id,
          run_at: j.run_at,
          status: "pending",
        }));

        const { error: insertError } = await supabase
          .from("scheduled_jobs")
          .insert(jobsToInsert);

        if (insertError) {
          console.error("Failed to create host report jobs:", insertError);
        } else {
          console.log(`Created ${newJobs.length} host report jobs`);
          
          await supabase.from("booking_events").insert({
            booking_id: booking_id,
            event_type: "host_report_reminders_scheduled",
            channel: "system",
            metadata: {
              jobs_created: newJobs,
              event_start: eventStartOrlando.toISOString(),
              booking_type: booking.booking_type,
              orlando_offset: ORLANDO_OFFSET_HOURS,
            },
          });

          responseData.jobs_created = newJobs;
        }
      } else {
        console.log("All required jobs already exist - no new jobs created");
        responseData.jobs_created = [];
        responseData.jobs_reason = "already_exist";
      }
    }

    responseData.jobs_scheduled = jobsToCreate.length;

    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in schedule-host-report-reminders:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
