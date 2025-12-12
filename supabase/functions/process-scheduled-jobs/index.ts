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
      .lt("attempts", 3) // Max 3 attempts
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
      details: [] as { job_id: string; status: string; error?: string }[],
    };

    for (const job of pendingJobs) {
      results.processed++;
      console.log(`Processing job ${job.id}: ${job.job_type} for booking ${job.booking_id}`);

      try {
        // Increment attempts
        await supabase
          .from("scheduled_jobs")
          .update({ attempts: job.attempts + 1, updated_at: new Date().toISOString() })
          .eq("id", job.id);

        if (job.job_type === "create_balance_payment_link") {
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
            // Check if it's a "already paid" or similar expected error
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

              results.succeeded++;
              results.details.push({ job_id: job.id, status: "completed_skipped", error: result.error });
              console.log(`Job ${job.id} completed (skipped): ${result.error}`);
              continue;
            }

            throw new Error(result.error || "Unknown error");
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
          results.details.push({ job_id: job.id, status: "completed" });
          console.log(`Job ${job.id} completed successfully`);

        } else {
          console.warn(`Unknown job type: ${job.job_type}`);
          // Mark unknown job types as failed
          await supabase
            .from("scheduled_jobs")
            .update({ 
              status: "failed",
              last_error: `Unknown job type: ${job.job_type}`,
              updated_at: new Date().toISOString()
            })
            .eq("id", job.id);

          results.failed++;
          results.details.push({ job_id: job.id, status: "failed", error: `Unknown job type: ${job.job_type}` });
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
        results.details.push({ job_id: job.id, status: newStatus, error: errorMessage });
      }
    }

    console.log(`Job processing complete. Processed: ${results.processed}, Succeeded: ${results.succeeded}, Failed: ${results.failed}`);

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
