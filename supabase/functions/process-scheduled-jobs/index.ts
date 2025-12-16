import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Balance retry job types
const BALANCE_RETRY_JOB_TYPES = ["balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"];

// Lifecycle transition job types
const LIFECYCLE_JOB_TYPES = ["set_lifecycle_in_progress"];

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

    // Fetch pending jobs that are due
    const { data: pendingJobs, error: fetchError } = await supabase
      .from("scheduled_jobs")
      .select("*")
      .eq("status", "pending")
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

    if (!pendingJobs || pendingJobs.length === 0) {
      console.log("No pending jobs to process");
      return new Response(JSON.stringify({ 
        success: true, 
        processed: 0,
        message: "No pending jobs"
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Found ${pendingJobs.length} pending jobs to process`);

    const results = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      details: [] as { job_id: string; job_type: string; status: string; error?: string }[],
    };

    for (const job of pendingJobs) {
      results.processed++;
      console.log(`Processing job ${job.id}: ${job.job_type} for booking ${job.booking_id}`);

      try {
        // Increment attempts first
        await supabase
          .from("scheduled_jobs")
          .update({ attempts: job.attempts + 1, updated_at: new Date().toISOString() })
          .eq("id", job.id);

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
              .select("id, event_date, lifecycle_status, payment_status, status, reservation_number")
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

            // Check if still in pre_event_ready
            if (booking.lifecycle_status !== "pre_event_ready") {
              console.log(`Booking ${job.booking_id} lifecycle is ${booking.lifecycle_status}, not pre_event_ready - cancelling job ${job.id}`);
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

            // Check if fully paid
            const isFullyPaid = booking.payment_status === "fully_paid";

            // Check if has staff assigned (query booking_staff_assignments)
            const { data: staffAssignments, error: staffError } = await supabase
              .from("booking_staff_assignments")
              .select("id")
              .eq("booking_id", job.booking_id)
              .limit(1);

            if (staffError) {
              console.error(`Error checking staff assignments for job ${job.id}:`, staffError);
            }

            const hasStaff = staffAssignments && staffAssignments.length > 0;

            // Validate business conditions
            if (!isFullyPaid || !hasStaff) {
              const reason = `conditions_not_met: fully_paid=${isFullyPaid}, has_staff=${hasStaff}`;
              console.log(`Booking ${job.booking_id} conditions not met - cancelling job ${job.id}: ${reason}`);
              
              await supabase
                .from("scheduled_jobs")
                .update({ 
                  status: "cancelled",
                  last_error: reason,
                  updated_at: new Date().toISOString()
                })
                .eq("id", job.id);

              // Log the cancellation event
              await supabase.from("booking_events").insert({
                booking_id: job.booking_id,
                event_type: "lifecycle_transition_cancelled",
                channel: "system",
                metadata: {
                  job_id: job.id,
                  job_type: job.job_type,
                  reason: "conditions_not_met",
                  is_fully_paid: isFullyPaid,
                  has_staff_assigned: hasStaff,
                  current_lifecycle: booking.lifecycle_status,
                },
              });
              
              results.cancelled++;
              results.details.push({ job_id: job.id, job_type: job.job_type, status: "cancelled", error: reason });
              continue;
            }

            // All conditions met - update to in_progress
            console.log(`All conditions met for booking ${job.booking_id} - transitioning to in_progress`);

            const { error: updateError } = await supabase
              .from("bookings")
              .update({
                lifecycle_status: "in_progress",
                updated_at: new Date().toISOString(),
              })
              .eq("id", job.booking_id);

            if (updateError) {
              console.error(`Failed to update booking ${job.booking_id}:`, updateError);
              
              // Increment attempts and keep as pending if under limit
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

            // Log the successful transition in booking_events
            await supabase.from("booking_events").insert({
              booking_id: job.booking_id,
              event_type: "auto_lifecycle_in_progress",
              channel: "system",
              metadata: {
                job_id: job.id,
                from_lifecycle: "pre_event_ready",
                to_lifecycle: "in_progress",
                is_fully_paid: isFullyPaid,
                has_staff_assigned: hasStaff,
                timestamp: new Date().toISOString(),
              },
            });

            // Call syncToGHL to notify GHL of the lifecycle change
            console.log(`Calling syncToGHL for booking ${job.booking_id}`);
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
                console.error(`syncToGHL failed for booking ${job.booking_id}:`, syncError);
                // Don't fail the job, just log the error - the lifecycle is already updated
              } else {
                console.log(`syncToGHL completed for booking ${job.booking_id}`);
              }
            } catch (syncError) {
              console.error(`syncToGHL exception for booking ${job.booking_id}:`, syncError);
              // Don't fail the job, just log the error
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
            console.log(`Job ${job.id} completed - booking ${job.booking_id} transitioned to in_progress`);
          }

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

    console.log(`Job processing complete. Processed: ${results.processed}, Succeeded: ${results.succeeded}, Skipped: ${results.skipped}, Cancelled: ${results.cancelled}, Failed: ${results.failed}`);

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
