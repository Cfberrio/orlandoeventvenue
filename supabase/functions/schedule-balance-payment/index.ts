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

    const responseData: Record<string, unknown> = {
      success: true,
      booking_id,
    };

    // ===============================
    // PART 1: Schedule lifecycle transition job (set_lifecycle_in_progress)
    // ===============================
    if (booking.lifecycle_status === "pre_event_ready" && booking.event_date) {
      // Check if lifecycle job already exists for this booking
      const { data: existingLifecycleJob } = await supabase
        .from("scheduled_jobs")
        .select("id")
        .eq("booking_id", booking_id)
        .eq("job_type", "set_lifecycle_in_progress")
        .in("status", ["pending"]);

      if (!existingLifecycleJob || existingLifecycleJob.length === 0) {
        // Schedule job for the start of event_date (or start_time if available)
        let runAt: Date;
        if (booking.start_time) {
          // Combine event_date with start_time
          runAt = new Date(`${booking.event_date}T${booking.start_time}`);
        } else {
          // Use start of day (6 AM Orlando time as approximation)
          runAt = new Date(`${booking.event_date}T06:00:00`);
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
    // PART 1.5: Schedule Host Report Reminder jobs
    // ===============================
    if (booking.lifecycle_status === "pre_event_ready" && booking.event_date && booking.start_time) {
      const HOST_REPORT_JOB_TYPES = ["host_report_pre_start", "host_report_during", "host_report_post"];
      
      // Check if host report jobs already exist for this booking
      const { data: existingHostReportJobs } = await supabase
        .from("scheduled_jobs")
        .select("id, job_type")
        .eq("booking_id", booking_id)
        .in("job_type", HOST_REPORT_JOB_TYPES)
        .in("status", ["pending"]);

      if (!existingHostReportJobs || existingHostReportJobs.length === 0) {
        // Calculate event start and end times
        const eventStart = new Date(`${booking.event_date}T${booking.start_time}`);
        
        // For end_time, use booking.end_time or default to start + 4 hours
        let eventEnd: Date;
        if (booking.end_time) {
          eventEnd = new Date(`${booking.event_date}T${booking.end_time}`);
        } else {
          eventEnd = new Date(eventStart.getTime() + 4 * 60 * 60 * 1000); // Default 4 hours
        }

        const now = new Date();

        // Calculate run_at for each job
        // Job 1: 30 min before start
        const preStartRunAt = new Date(eventStart.getTime() - 30 * 60 * 1000);
        // Job 2: 2 hours after start
        const duringRunAt = new Date(eventStart.getTime() + 2 * 60 * 60 * 1000);
        // Job 3: 30 min after end
        const postRunAt = new Date(eventEnd.getTime() + 30 * 60 * 1000);

        const hostReportJobs: { job_type: string; run_at: string }[] = [];

        // Only schedule jobs that are in the future
        if (preStartRunAt > now) {
          hostReportJobs.push({
            job_type: "host_report_pre_start",
            run_at: preStartRunAt.toISOString(),
          });
        } else {
          console.log(`Skipping host_report_pre_start - run_at ${preStartRunAt.toISOString()} is in the past`);
        }

        if (duringRunAt > now) {
          hostReportJobs.push({
            job_type: "host_report_during",
            run_at: duringRunAt.toISOString(),
          });
        } else {
          console.log(`Skipping host_report_during - run_at ${duringRunAt.toISOString()} is in the past`);
        }

        if (postRunAt > now) {
          hostReportJobs.push({
            job_type: "host_report_post",
            run_at: postRunAt.toISOString(),
          });
        } else {
          console.log(`Skipping host_report_post - run_at ${postRunAt.toISOString()} is in the past`);
        }

        if (hostReportJobs.length > 0) {
          const jobsToInsert = hostReportJobs.map((j) => ({
            job_type: j.job_type,
            booking_id: booking_id,
            run_at: j.run_at,
            status: "pending",
          }));

          const { error: hostReportJobError } = await supabase
            .from("scheduled_jobs")
            .insert(jobsToInsert);

          if (hostReportJobError) {
            console.error("Failed to schedule host report jobs:", hostReportJobError);
          } else {
            console.log(`Scheduled ${hostReportJobs.length} host report reminder jobs`);

            await supabase.from("booking_events").insert({
              booking_id: booking_id,
              event_type: "host_report_reminders_scheduled",
              channel: "system",
              metadata: {
                jobs_scheduled: hostReportJobs.map((j) => ({
                  job_type: j.job_type,
                  run_at: j.run_at,
                })),
                event_start: eventStart.toISOString(),
                event_end: eventEnd.toISOString(),
              },
            });

            responseData.host_report_jobs_scheduled = true;
            responseData.host_report_jobs = hostReportJobs;
          }
        } else {
          console.log("All host report job times are in the past, skipping");
          responseData.host_report_jobs_scheduled = false;
          responseData.host_report_jobs_reason = "all_times_in_past";
        }
      } else {
        console.log("Host report jobs already exist for this booking, skipping");
        responseData.host_report_jobs_scheduled = false;
        responseData.host_report_jobs_reason = "already_exists";
      }
    } else if (booking.lifecycle_status === "pre_event_ready" && booking.event_date && !booking.start_time) {
      console.log("Cannot schedule host report jobs - start_time is null");
      responseData.host_report_jobs_scheduled = false;
      responseData.host_report_jobs_reason = "start_time_null";
    }

    // ===============================
    // PART 2: Balance payment scheduling (existing logic)
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

      responseData.balance_action = "short_notice_scheduled";
      responseData.first_link_created = true;
      responseData.payment_url = result.payment_url;
      responseData.retry_scheduled_at = retryAt.toISOString();
      responseData.days_until_event = diffDays;
      responseData.max_balance_attempts = 2;

      return new Response(JSON.stringify(responseData), {
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
          ...responseData,
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

      responseData.balance_action = "long_notice_scheduled";
      responseData.scheduled_jobs = [
        { attempt: 1, job_type: "balance_retry_1", run_at: firstRun.toISOString() },
        { attempt: 2, job_type: "balance_retry_2", run_at: secondRun.toISOString() },
        { attempt: 3, job_type: "balance_retry_3", run_at: thirdRun.toISOString() },
      ];
      responseData.days_until_event = diffDays;
      responseData.max_balance_attempts = 3;

      return new Response(JSON.stringify(responseData), {
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
