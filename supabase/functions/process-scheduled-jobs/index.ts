import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { retryFailedMetaEvents } from "../_shared/meta-capi.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Balance retry job types
const BALANCE_RETRY_JOB_TYPES = ["balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"];

// Lifecycle transition job types
const LIFECYCLE_JOB_TYPES = ["set_lifecycle_in_progress", "set_lifecycle_post_event"];
// set_lifecycle_in_progress may start from either state (ClickUp 86e3zjfq6).
const IN_PROGRESS_SOURCE_STATES = ["confirmed", "pre_event_ready"];

// Host report reminder job types
const HOST_REPORT_JOB_TYPES = ["host_report_pre_start", "host_report_during", "host_report_post"];

// One hour report (guest report closeout trigger) job types
const ONE_HOUR_REPORT_JOB_TYPES = ["one_hour_report"];

// Guest feedback job types
const GUEST_FEEDBACK_JOB_TYPES = ["guest_feedback_post_event"];

// Cleaning report reminder job types
const CLEANING_REMINDER_JOB_TYPES = ["cleaning_report_reminder"];

// M-26: a claimed job whose run died is retried after this long.
const PROCESSING_LEASE_MS = 15 * 60 * 1000;


serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Processing scheduled jobs...");

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date().toISOString();
    const leaseExpired = new Date(Date.now() - PROCESSING_LEASE_MS).toISOString();

    // M-27: a job that used up its attempts was left "pending" forever (never
    // picked again, still looking alive). Mark it failed so it is visible.
    const { error: exhaustError } = await supabase
      .from("scheduled_jobs")
      .update({ status: "failed", last_error: "max_attempts_reached", updated_at: now })
      .gte("attempts", 3)
      .or(`status.eq.pending,and(status.eq.processing,updated_at.lt.${leaseExpired})`);
    if (exhaustError) console.error("Could not mark exhausted jobs failed:", exhaustError);

    // Fetch due jobs: pending, or "processing" whose run died (lease expired).
    const { data: pendingJobs, error: fetchError } = await supabase
      .from("scheduled_jobs")
      .select("*")
      .or(`status.eq.pending,and(status.eq.processing,updated_at.lt.${leaseExpired})`)
      .lte("run_at", now)
      .lt("attempts", 3) // Max 3 attempts per job
      .order("run_at", { ascending: true })
      .limit(50); // Process up to 50 jobs at a time

    if (fetchError) {
      console.error("Error fetching pending jobs:", fetchError);
      return new Response(JSON.stringify({ error: "Failed to fetch jobs" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // NOTE: do NOT return early when there are no pending jobs. The standalone
    // cleaning reminders and the lead-magnet discount drip run at the end of this
    // handler on every tick; returning here silently skipped them on most runs,
    // which is what made the OEV lead sequence fire days late and in bursts.
    const jobs = pendingJobs ?? [];
    console.log(
      jobs.length === 0
        ? "No pending jobs to process (continuing to reminders + discount drip)"
        : `Found ${jobs.length} pending jobs to process`
    );

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      details: [] as { job_id: string; job_type: string; status: string; error?: string }[],
    };

    for (const job of jobs) {
      results.processed++;
      console.log(`Processing job ${job.id}: ${job.job_type} for booking ${job.booking_id}`);

      // M-26 (86e40ach2): atomic claim. Overlapping runs (cron + manual, or a
      // slow tick) used to read the same pending job and both send it. The
      // claim is a compare-and-set on the status and attempts this run read;
      // only one run wins. A run that dies leaves the job "processing"; it is
      // picked up again after PROCESSING_LEASE_MS.
      const { data: claimed, error: claimError } = await supabase
        .from("scheduled_jobs")
        .update({ status: "processing", attempts: job.attempts + 1, updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", job.status)
        .eq("attempts", job.attempts)
        .select("id");
      if (claimError || !claimed || claimed.length === 0) {
        if (claimError) console.error(`Could not claim job ${job.id}:`, claimError);
        results.skipped++;
        results.details.push({ job_id: job.id, job_type: job.job_type, status: "skipped", error: claimError ? "claim_failed" : "claimed_by_another_run" });
        continue;
      }

      // One-pass inner loop: a `continue` inside the handlers below ends this
      // job's handling and still reaches the release step after it.
      for (const _job of [job]) {
      try {

        // ===============================
        // BALANCE RETRY JOBS
        // ===============================
        if (BALANCE_RETRY_JOB_TYPES.includes(job.job_type)) {
          // Fetch booking to check current payment status
          const { data: booking, error: bookingError } = await supabase
            .from("bookings")
            .select("id, payment_status, reservation_number")
            .eq("id", job.booking_id)
            .single();

          if (bookingError || !booking) {
            console.error(`Booking not found for job ${job.id}:`, bookingError);
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "failed",
                last_error: "Booking not found",
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);
            
            results.failed++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "failed", error: "Booking not found" });
            continue;
          }

          // Check if already fully paid - skip without creating new link
          if (booking.payment_status === "fully_paid") {
            console.log(`Booking ${job.booking_id} already fully paid - skipping job ${job.id}`);
            
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "completed",
                completed_at: new Date().toISOString(),
                last_error: "Skipped: already fully paid",
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);

            // Log the skip event
            await supabase.from("booking_events").insert({
              booking_id: job.booking_id,
              event_type: "balance_payment_retry_skipped_already_paid",
              channel: "system",
              metadata: {
                job_id: job.id,
                job_type: job.job_type,
                reason: "already_fully_paid",
              },
            });

            results.skipped++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "skipped", error: "Already fully paid" });
            continue;
          }

          // Check if deposit is paid (required for balance link)
          if (booking.payment_status !== "deposit_paid") {
            console.log(`Booking ${job.booking_id} deposit not paid - skipping job ${job.id}`);
            
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "failed",
                last_error: `Cannot create balance link: payment_status is ${booking.payment_status}`,
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);

            results.failed++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "failed", error: `Deposit not paid: ${booking.payment_status}` });
            continue;
          }

          // Extract attempt number from job_type (balance_retry_1 -> 1, balance_retry_2 -> 2, etc.)
          let attemptNumber = 1;
          const match = job.job_type.match(/balance_retry_(\d+)/);
          if (match) {
            attemptNumber = parseInt(match[1], 10);
          }

          console.log(`Creating balance payment link for booking ${job.booking_id} (attempt ${attemptNumber})`);

          // Call create-balance-payment-link function
          const response = await fetch(
            `${supabaseUrl}/functions/v1/create-balance-payment-link`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-ghl-backend-token": Deno.env.get("GHL_BACKEND_TOKEN") || "",
              },
              body: JSON.stringify({ booking_id: job.booking_id }),
            }
          );

          const result = await response.json();

          if (!response.ok) {
            // Check if it's an expected error (already paid, etc.)
            if (result.error?.includes("already fully paid") || 
                result.error?.includes("Deposit must be paid")) {
              // Mark as completed since there's nothing to do
              await supabase
                .from("scheduled_jobs")
                .update({ 
                  status: "completed",
                  completed_at: new Date().toISOString(),
                  last_error: result.error,
                  updated_at: new Date().toISOString()
                })
                .eq("id", job.id);

              results.skipped++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: "skipped", error: result.error });
              console.log(`Job ${job.id} completed (skipped): ${result.error}`);
              continue;
            }

            throw new Error(result.error || "Unknown error from create-balance-payment-link");
          }

          // Success - log the execution event
          await supabase.from("booking_events").insert({
            booking_id: job.booking_id,
            event_type: "balance_payment_retry_executed",
            channel: "system",
            metadata: {
              job_id: job.id,
              job_type: job.job_type,
              attempt: attemptNumber,
              payment_url: result.payment_url,
            },
          });

          // Mark job as completed
          await supabase
            .from("scheduled_jobs")
            .update({ 
              status: "completed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", job.id);

          results.succeeded++;
          results.details.push({ job_id: job.id, job_type: job.job_type, status: "completed" });
          console.log(`Job ${job.id} completed successfully - balance link created (attempt ${attemptNumber})`);

        // ===============================
        // LIFECYCLE TRANSITION JOBS
        // ===============================
        } else if (LIFECYCLE_JOB_TYPES.includes(job.job_type)) {
          
          if (job.job_type === "set_lifecycle_in_progress") {
            // Fetch booking with all needed fields
            const { data: booking, error: bookingError } = await supabase
              .from("bookings")
              .select("id, event_date, lifecycle_status, payment_status, status, reservation_number, booking_origin")
              .eq("id", job.booking_id)
              .maybeSingle();

            if (bookingError || !booking) {
              console.error(`Booking not found for lifecycle job ${job.id}:`, bookingError);
              await supabase
                .from("scheduled_jobs")
                .update({ 
                  status: "cancelled",
                  last_error: "booking_not_found",
                  updated_at: new Date().toISOString()
                })
                .eq("id", job.id);
              
              results.cancelled++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: "booking_not_found" });
              continue;
            }

            // Same rule as the lifecycle cron (lifecycle_moves_due, Codex review):
            // declined bookings and bookings with no money in (pending, failed,
            // refunded) never move to in_progress.
            if (booking.status === "declined" || ["pending", "failed", "refunded"].includes(booking.payment_status)) {
              const reason = `not_moved_status=${booking.status}_payment=${booking.payment_status}`;
              await supabase
                .from("scheduled_jobs")
                .update({ status: "cancelled", last_error: reason, updated_at: new Date().toISOString() })
                .eq("id", job.id);
              results.cancelled++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: reason });
              continue;
            }

            // Check if booking is cancelled
            if (booking.status === "cancelled") {
              console.log(`Booking ${job.booking_id} is cancelled - cancelling lifecycle job ${job.id}`);
              await supabase
                .from("scheduled_jobs")
                .update({ 
                  status: "cancelled",
                  last_error: "booking_cancelled_before_event",
                  updated_at: new Date().toISOString()
                })
                .eq("id", job.id);
              
              results.cancelled++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: "booking_cancelled_before_event" });
              continue;
            }

            // Event start moves the booking forward from pre_event_ready OR from
            // confirmed (staff acceptance still pending): the event happens
            // either way, and post-event automation depends on in_progress.
            // ClickUp 86e3zjfq6.
            if (!IN_PROGRESS_SOURCE_STATES.includes(booking.lifecycle_status)) {
              console.log(`Booking ${job.booking_id} lifecycle is ${booking.lifecycle_status}, not confirmed/pre_event_ready - cancelling job ${job.id}`);
              await supabase
                .from("scheduled_jobs")
                .update({ 
                  status: "cancelled",
                  last_error: `lifecycle_not_pre_event_ready_current=${booking.lifecycle_status}`,
                  updated_at: new Date().toISOString()
                })
                .eq("id", job.id);
              
              results.cancelled++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: `lifecycle_not_pre_event_ready_current=${booking.lifecycle_status}` });
              continue;
            }

            // M-24 (86e40ach2): the event happening moves the booking forward,
            // whatever the payment state (the fully_paid + staff condition here
            // blocked every deposit-paid / invoiced booking: 0 of 61 jobs ever
            // completed). transition_booking locks the row, refuses a cancelled
            // booking and compare-and-sets on the state read above.
            const { data: moved, error: transitionError } = await supabase.rpc("transition_booking", {
              p_booking_id: job.booking_id,
              p_to: "in_progress",
              p_expected_from: [booking.lifecycle_status],
              p_reason: "event_started_job",
              p_channel: "system",
            });
            const move = moved as { ok?: boolean; changed?: boolean; reason?: string } | null;

            if (transitionError) {
              console.error(`transition_booking failed for ${job.booking_id}:`, transitionError);
              const newAttempts = job.attempts + 1;
              const newStatus = newAttempts >= 3 ? "failed" : "pending";
              await supabase
                .from("scheduled_jobs")
                .update({
                  status: newStatus,
                  last_error: `transition_failed: ${transitionError.message}`,
                  updated_at: new Date().toISOString()
                })
                .eq("id", job.id);
              results.failed++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: newStatus, error: `transition_failed: ${transitionError.message}` });
              continue;
            }

            if (!move?.ok || move.changed === false) {
              const reason = move?.reason ?? "already_in_progress";
              console.log(`Booking ${job.booking_id} not moved (${reason}) - closing job ${job.id}`);
              await supabase
                .from("scheduled_jobs")
                .update({
                  status: "cancelled",
                  last_error: `lifecycle_not_moved: ${reason}`,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", job.id);
              results.cancelled++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: reason });
              continue;
            }

            // Log the successful transition in booking_events
            await supabase.from("booking_events").insert({
              booking_id: job.booking_id,
              event_type: "auto_lifecycle_in_progress",
              channel: "system",
              metadata: {
                job_id: job.id,
                from_lifecycle: booking.lifecycle_status,
                to_lifecycle: "in_progress",
                payment_status: booking.payment_status,
                timestamp: new Date().toISOString(),
              },
            });

            // Call syncToGHL to notify GHL of the lifecycle change. Same retry +
            // visible failure as the lifecycle cron (Codex review, 86e40ach2):
            // once in_progress, nothing re-selects this booking for a sync.
            let ghlSynced = false;
            let ghlSyncError = "";
            for (let attempt = 1; attempt <= 2 && !ghlSynced; attempt++) {
              try {
                const syncResponse = await fetch(`${supabaseUrl}/functions/v1/sync-to-ghl`, {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${supabaseServiceKey}`,
                  },
                  body: JSON.stringify({ booking_id: job.booking_id, sync_reason: "event_started" }),
                });
                const syncText = await syncResponse.text();
                let syncBody: { ok?: boolean } = {};
                try { syncBody = JSON.parse(syncText); } catch { /* not JSON */ }
                if (syncResponse.ok && syncBody.ok !== false) ghlSynced = true;
                else ghlSyncError = syncText.slice(0, 300);
              } catch (syncError) {
                ghlSyncError = syncError instanceof Error ? syncError.message : String(syncError);
              }
              if (!ghlSynced && attempt === 1) await new Promise((r) => setTimeout(r, 2000));
            }
            if (!ghlSynced) {
              console.error(`syncToGHL failed for booking ${job.booking_id}:`, ghlSyncError);
              const { error: ghlLogError } = await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "ghl_sync_failed_after_lifecycle",
                channel: "system",
                metadata: { to_lifecycle: "in_progress", error: ghlSyncError, job_id: job.id },
              });
              if (ghlLogError) console.error("Could not log GHL sync failure:", ghlLogError);
            }

            // Mark job as completed
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "completed",
                completed_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);

            // M-27: no set_lifecycle_post_event job any more (the lifecycle cron
            // closes events 24h after they end, Luis D7), and the cleaning
            // reminder is scheduled in SQL in Orlando time when the booking
            // enters in_progress (trg_schedule_cleaning_reminder).

            results.succeeded++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "completed" });
            console.log(`Job ${job.id} completed - booking ${job.booking_id} transitioned to in_progress`);
          
          } else if (job.job_type === "set_lifecycle_post_event") {
            // Retired (86e40ach2, Codex review): the lifecycle cron
            // (check-post-event-transition -> transition_booking) closes events
            // 24h after they end. This path wrote post_event with no lock or
            // cancelled check; any leftover job is closed without touching the
            // booking.
            await supabase
              .from("scheduled_jobs")
              .update({
                status: "cancelled",
                last_error: "replaced_by_lifecycle_cron",
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);
            results.cancelled++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: "replaced_by_lifecycle_cron" });
            continue;
          }

        // ===============================
        // CLEANING REPORT REMINDER JOBS
        // ===============================
        } else if (CLEANING_REMINDER_JOB_TYPES.includes(job.job_type)) {
          console.log(`Processing cleaning_report_reminder for booking ${job.booking_id}`);

          try {
            const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
            const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

            const reminderResponse = await fetch(
              `${supabaseUrl}/functions/v1/send-booking-cleaning-reminder`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({ booking_id: job.booking_id }),
              }
            );

            const reminderResult = await reminderResponse.json();
            console.log(`send-booking-cleaning-reminder result for ${job.booking_id}:`, JSON.stringify(reminderResult));
          } catch (reminderError) {
            console.error(`Error calling send-booking-cleaning-reminder for ${job.booking_id}:`, reminderError);
          }

          // Mark job as completed regardless of email result (avoid retrying forever)
          await supabase
            .from("scheduled_jobs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.succeeded++;
          results.details.push({ job_id: job.id, job_type: job.job_type, status: "completed" });
          console.log(`Job ${job.id} completed - cleaning_report_reminder processed for booking ${job.booking_id}`);

        // ===============================
        // HOST REPORT REMINDER JOBS
        // ===============================
        } else if (HOST_REPORT_JOB_TYPES.includes(job.job_type)) {
          // Fetch booking with needed fields
          const { data: booking, error: bookingError } = await supabase
            .from("bookings")
            .select("id, status, lifecycle_status, reservation_number, host_report_step")
            .eq("id", job.booking_id)
            .maybeSingle();

          if (bookingError || !booking) {
            console.error(`Booking not found for host report job ${job.id}:`, bookingError);
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "cancelled",
                last_error: "booking_not_found_for_host_report",
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);
            
            results.cancelled++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: "booking_not_found_for_host_report" });
            continue;
          }

          // Check if booking is cancelled
          if (booking.status === "cancelled") {
            console.log(`Booking ${job.booking_id} is cancelled - cancelling host report job ${job.id}`);
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "cancelled",
                last_error: "booking_cancelled_before_host_report",
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);
            
            results.cancelled++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: "booking_cancelled_before_host_report" });
            continue;
          }

          // Check if host report is already completed (by checking booking_host_reports table)
          const { data: hostReports } = await supabase
            .from("booking_host_reports")
            .select("id")
            .eq("booking_id", job.booking_id)
            .limit(1);

          const hostReportCompleted = hostReports && hostReports.length > 0;

          if (hostReportCompleted) {
            console.log(`Host report already completed for booking ${job.booking_id} - cancelling job ${job.id}`);
            
            // Cancel this and all other pending host report jobs for this booking
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "cancelled",
                last_error: "host_report_already_completed",
                updated_at: new Date().toISOString()
              })
              .eq("booking_id", job.booking_id)
              .in("job_type", HOST_REPORT_JOB_TYPES)
              .eq("status", "pending");
            
            results.cancelled++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: "host_report_already_completed" });
            continue;
          }

          // Determine the new host_report_step based on job_type
          let newStep: string | null = null;
          if (job.job_type === "host_report_pre_start") newStep = "pre_start";
          if (job.job_type === "host_report_during") newStep = "during_event";
          if (job.job_type === "host_report_post") newStep = "post_event";

          if (!newStep) {
            console.error(`Invalid host report job type: ${job.job_type}`);
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "failed",
                last_error: "invalid_host_report_job_type",
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);
            
            results.failed++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "failed", error: "invalid_host_report_job_type" });
            continue;
          }

          // Only update if the step is different (CRITICAL for GHL trigger)
          const previousStep = booking.host_report_step;
          if (previousStep === newStep) {
            console.log(`Booking ${job.booking_id} already at step '${newStep}' - marking job complete without update`);
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: "completed",
                completed_at: new Date().toISOString(),
                last_error: `step_already_at_${newStep}`,
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);
            
            results.skipped++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "skipped", error: `step_already_at_${newStep}` });
            continue;
          }

          // Update booking.host_report_step
          console.log(`Updating booking ${job.booking_id} host_report_step from '${previousStep}' to '${newStep}'`);
          const { error: updateError } = await supabase
            .from("bookings")
            .update({
              host_report_step: newStep,
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.booking_id);

          if (updateError) {
            console.error(`Failed to update host_report_step for booking ${job.booking_id}:`, updateError);
            
            const newAttempts = job.attempts + 1;
            const newStatus = newAttempts >= 3 ? "failed" : "pending";
            
            await supabase
              .from("scheduled_jobs")
              .update({ 
                status: newStatus,
                last_error: `db_update_failed: ${updateError.message}`,
                updated_at: new Date().toISOString()
              })
              .eq("id", job.id);

            results.failed++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: newStatus, error: `db_update_failed: ${updateError.message}` });
            continue;
          }

          // Log the step change in booking_events
          await supabase.from("booking_events").insert({
            booking_id: job.booking_id,
            event_type: "host_report_step_changed",
            channel: "system",
            metadata: {
              job_id: job.id,
              job_type: job.job_type,
              new_step: newStep,
              previous_step: previousStep,
              timestamp: new Date().toISOString(),
            },
          });

          // CRITICAL: Call syncToGHL IMMEDIATELY after changing host_report_step
          console.log(`CRITICAL: Calling syncToGHL for booking ${job.booking_id} after host_report_step change: ${previousStep} -> ${newStep}`);
          try {
            const syncResponse = await fetch(
              `${supabaseUrl}/functions/v1/sync-to-ghl`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({ booking_id: job.booking_id }),
              }
            );

            if (!syncResponse.ok) {
              const syncError = await syncResponse.text();
              console.error(`syncToGHL FAILED for booking ${job.booking_id}:`, syncError);
              // Log the sync failure but don't fail the job
              await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "sync_to_ghl_failed",
                channel: "system",
                metadata: {
                  context: "host_report_step_change",
                  new_step: newStep,
                  error: syncError,
                },
              });
            } else {
              console.log(`syncToGHL SUCCESS for booking ${job.booking_id} (step: ${newStep})`);
              // Log successful sync
              await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "sync_to_ghl_success",
                channel: "system",
                metadata: {
                  context: "host_report_step_change",
                  new_step: newStep,
                },
              });
            }
          } catch (syncError) {
            console.error(`syncToGHL EXCEPTION for booking ${job.booking_id}:`, syncError);
          }

          // Mark job as completed
          await supabase
            .from("scheduled_jobs")
            .update({ 
              status: "completed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", job.id);

          results.succeeded++;
          results.details.push({ job_id: job.id, job_type: job.job_type, status: "completed" });
          console.log(`Job ${job.id} completed - booking ${job.booking_id} host_report_step changed: ${previousStep} -> ${newStep}`);

        // ===============================
        // ONE HOUR REPORT JOBS (guest report closeout trigger)
        // ===============================
        } else if (ONE_HOUR_REPORT_JOB_TYPES.includes(job.job_type)) {
          const { data: booking, error: bookingError } = await supabase
            .from("bookings")
            .select("id, status, payment_status, reservation_number, one_hour_report")
            .eq("id", job.booking_id)
            .maybeSingle();

          // Helper to cancel this job with a reason
          const cancelOneHourJob = async (reason: string) => {
            await supabase
              .from("scheduled_jobs")
              .update({
                status: "cancelled",
                last_error: reason,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.cancelled++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: reason });
          };

          if (bookingError || !booking) {
            console.error(`Booking not found for one_hour_report job ${job.id}:`, bookingError);
            await cancelOneHourJob("booking_not_found_for_one_hour_report");
            continue;
          }

          if (booking.status === "cancelled") {
            console.log(`Booking ${job.booking_id} cancelled - cancelling one_hour_report job ${job.id}`);
            await cancelOneHourJob("booking_cancelled_before_one_hour_report");
            continue;
          }

          if (booking.payment_status !== "deposit_paid" && booking.payment_status !== "fully_paid") {
            console.log(`Booking ${job.booking_id} deposit not paid (${booking.payment_status}) - cancelling one_hour_report job`);
            await cancelOneHourJob("deposit_not_paid");
            continue;
          }

          // Requires at least 1 staff assigned (any role)
          const { data: staffRows } = await supabase
            .from("booking_staff_assignments")
            .select("id")
            .eq("booking_id", job.booking_id)
            .limit(1);

          if (!staffRows || staffRows.length === 0) {
            console.log(`Booking ${job.booking_id} has no staff assigned - cancelling one_hour_report job`);
            await cancelOneHourJob("no_staff_assigned");
            continue;
          }

          // Skip if host (guest) report already submitted - email would be pointless
          const { data: hostReports } = await supabase
            .from("booking_host_reports")
            .select("id")
            .eq("booking_id", job.booking_id)
            .limit(1);

          if (hostReports && hostReports.length > 0) {
            console.log(`Host report already completed for booking ${job.booking_id} - cancelling one_hour_report job`);
            await cancelOneHourJob("host_report_already_completed");
            continue;
          }

          // Idempotency: already fired → complete without update (no GHL re-trigger)
          if (booking.one_hour_report === "true") {
            console.log(`Booking ${job.booking_id} one_hour_report already 'true' - marking job complete without update`);
            await supabase
              .from("scheduled_jobs")
              .update({
                status: "completed",
                completed_at: new Date().toISOString(),
                last_error: "already_fired",
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.skipped++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: "skipped", error: "already_fired" });
            continue;
          }

          // Flip the flag
          console.log(`Setting one_hour_report='true' for booking ${job.booking_id}`);
          const { error: updateError } = await supabase
            .from("bookings")
            .update({
              one_hour_report: "true",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.booking_id);

          if (updateError) {
            console.error(`Failed to set one_hour_report for booking ${job.booking_id}:`, updateError);
            const newAttempts = job.attempts + 1;
            const newStatus = newAttempts >= 3 ? "failed" : "pending";
            await supabase
              .from("scheduled_jobs")
              .update({
                status: newStatus,
                last_error: `db_update_failed: ${updateError.message}`,
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.id);
            results.failed++;
            results.details.push({ job_id: job.id, job_type: job.job_type, status: newStatus, error: `db_update_failed: ${updateError.message}` });
            continue;
          }

          // Log the trigger event
          await supabase.from("booking_events").insert({
            booking_id: job.booking_id,
            event_type: "one_hour_report_triggered",
            channel: "system",
            metadata: {
              job_id: job.id,
              reservation_number: booking.reservation_number,
              timestamp: new Date().toISOString(),
            },
          });

          // CRITICAL: sync to GHL immediately - Contact Changed fires the email/SMS
          console.log(`CRITICAL: Calling syncToGHL for booking ${job.booking_id} after one_hour_report flip`);
          try {
            const syncResponse = await fetch(
              `${supabaseUrl}/functions/v1/sync-to-ghl`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Bearer ${supabaseServiceKey}`,
                },
                body: JSON.stringify({ booking_id: job.booking_id }),
              }
            );

            if (!syncResponse.ok) {
              const syncError = await syncResponse.text();
              console.error(`syncToGHL FAILED for booking ${job.booking_id}:`, syncError);
              await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "sync_to_ghl_failed",
                channel: "system",
                metadata: {
                  context: "one_hour_report_trigger",
                  error: syncError,
                },
              });
            } else {
              console.log(`syncToGHL SUCCESS for booking ${job.booking_id} (one_hour_report)`);
              await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "sync_to_ghl_success",
                channel: "system",
                metadata: {
                  context: "one_hour_report_trigger",
                },
              });
            }
          } catch (syncError) {
            console.error(`syncToGHL EXCEPTION for booking ${job.booking_id}:`, syncError);
          }

          // Mark job as completed
          await supabase
            .from("scheduled_jobs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.succeeded++;
          results.details.push({ job_id: job.id, job_type: job.job_type, status: "completed" });
          console.log(`Job ${job.id} completed - one_hour_report fired for booking ${job.booking_id}`);

        // ===============================
        // GUEST FEEDBACK JOBS
        // ===============================
        } else if (GUEST_FEEDBACK_JOB_TYPES.includes(job.job_type)) {
          console.log(`[JOB ${job.id}] Sending guest feedback email...`);
          
          const feedbackEmailResponse = await fetch(
            `${supabaseUrl}/functions/v1/send-guest-feedback`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                booking_id: job.booking_id,
              }),
            }
          );

          if (!feedbackEmailResponse.ok) {
            throw new Error(`send-guest-feedback failed: ${await feedbackEmailResponse.text()}`);
          }
          
          console.log(`[JOB ${job.id}] Guest feedback email sent successfully`);
          
          await supabase
            .from("scheduled_jobs")
            .update({
              status: "completed",
              completed_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.id);

          results.succeeded++;
          results.details.push({
            job_id: job.id,
            job_type: job.job_type,
            status: "completed",
          });

        } else {
          // Unknown job type
          console.warn(`Unknown job type: ${job.job_type}`);
          await supabase
            .from("scheduled_jobs")
            .update({ 
              status: "failed",
              last_error: `Unknown job type: ${job.job_type}`,
              updated_at: new Date().toISOString()
            })
            .eq("id", job.id);

          results.failed++;
          results.details.push({ job_id: job.id, job_type: job.job_type, status: "failed", error: `Unknown job type: ${job.job_type}` });
        }

      } catch (jobError: unknown) {
        const errorMessage = jobError instanceof Error ? jobError.message : "Unknown error";
        console.error(`Error processing job ${job.id}:`, errorMessage);

        // Update job with error
        const newAttempts = job.attempts + 1;
        const newStatus = newAttempts >= 3 ? "failed" : "pending";

        await supabase
          .from("scheduled_jobs")
          .update({ 
            status: newStatus,
            last_error: errorMessage,
            updated_at: new Date().toISOString()
          })
          .eq("id", job.id);

        results.failed++;
        results.details.push({ job_id: job.id, job_type: job.job_type, status: newStatus, error: errorMessage });
      }
      }

      // Release: a handler that did not set a final status leaves the job
      // pending for the next tick, exactly as before the claim existed.
      const { error: releaseError } = await supabase
        .from("scheduled_jobs")
        .update({ status: "pending", updated_at: new Date().toISOString() })
        .eq("id", job.id)
        .eq("status", "processing");
      if (releaseError) console.error(`Could not release job ${job.id}:`, releaseError);
    }

    console.log(`Job processing complete. Processed: ${results.processed}, Succeeded: ${results.succeeded}, Skipped: ${results.skipped}, Cancelled: ${results.cancelled}, Failed: ${results.failed}`);

    // ===============================
    // STANDALONE CLEANING REMINDERS
    // ===============================
    // Call standalone cleaning reminder function every time this cron runs
    console.log("Triggering standalone cleaning reminders...");
    try {
      const standaloneRemindersResponse = await fetch(
        `${supabaseUrl}/functions/v1/send-standalone-cleaning-reminder`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (standaloneRemindersResponse.ok) {
        const reminderResult = await standaloneRemindersResponse.json();
        console.log("Standalone reminders result:", reminderResult);
      } else {
        const reminderError = await standaloneRemindersResponse.text();
        console.error("Standalone reminders failed:", reminderError);
      }
    } catch (reminderError) {
      console.error("Exception calling standalone reminders:", reminderError);
    }

    // ===============================
    // DISCOUNT DRIP EMAILS
    // ===============================
    console.log("Triggering discount drip email processing...");
    try {
      const discountDripResponse = await fetch(
        `${supabaseUrl}/functions/v1/process-discount-drip`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${supabaseServiceKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (discountDripResponse.ok) {
        const dripResult = await discountDripResponse.json();
        console.log("Discount drip result:", dripResult);
      } else {
        const dripError = await discountDripResponse.text();
        console.error("Discount drip failed:", dripError);
      }
    } catch (dripError) {
      console.error("Exception calling discount drip:", dripError);
    }

    // CAPI is non-critical to booking operations. Retry journaled failures and
    // skipped_no_secrets rows once credentials exist; missing credentials do
    // not consume an attempt or fail this scheduled-jobs invocation.
    try {
      const metaRetries = await retryFailedMetaEvents();
      console.log("Meta CAPI retry result:", metaRetries);
    } catch (metaRetryError) {
      console.error(
        "Meta CAPI retry failed:",
        metaRetryError instanceof Error ? metaRetryError.message : "Unknown error",
      );
    }

    return new Response(JSON.stringify({ 
      success: true, 
      ...results
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in process-scheduled-jobs:", error);
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
