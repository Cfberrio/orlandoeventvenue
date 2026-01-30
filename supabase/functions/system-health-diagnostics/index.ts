import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FunctionMetrics {
  function_name: string;
  total_jobs: number;
  completed: number;
  failed: number;
  pending: number;
  cancelled: number;
  success_rate: number;
  sample_errors: string[];
}

interface AffectedBooking {
  reservation_number: string;
  event_date: string;
  guest_name?: string;
  lifecycle_status: string;
  payment_status: string;
  issues: string[];
  recommended_action: string;
}

interface DiagnosticReport {
  overall_health: "healthy" | "warning" | "critical";
  checked_at: string;
  metrics: {
    total_jobs_7d: number;
    completed_7d: number;
    failed_7d: number;
    pending_now: number;
    overdue_now: number;
    overall_success_rate: number;
  };
  function_metrics: FunctionMetrics[];
  affected_bookings: AffectedBooking[];
  stuck_jobs: {
    count: number;
    oldest_run_at?: string;
    details: { job_type: string; booking_id: string; run_at: string }[];
  };
  lifecycle_issues: {
    stuck_in_pre_event: number;
    stuck_in_in_progress: number;
    wrong_payment_lifecycle: number;
  };
  recommendations: string[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== system-health-diagnostics ===");
    console.log("Running comprehensive system diagnostics...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    const today = now.toISOString().split('T')[0];
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const recommendations: string[] = [];
    let healthScore = 100;

    // =====================================================
    // 1. JOB METRICS (last 7 days)
    // =====================================================
    console.log("Fetching job metrics...");
    
    const { data: allJobs7d, error: jobsError } = await supabase
      .from("scheduled_jobs")
      .select("id, job_type, status, attempts, last_error, created_at, run_at, completed_at")
      .gte("created_at", sevenDaysAgo);

    if (jobsError) {
      console.error("Error fetching jobs:", jobsError);
    }

    const jobs = allJobs7d || [];
    const totalJobs = jobs.length;
    const completedJobs = jobs.filter(j => j.status === "completed").length;
    const failedJobs = jobs.filter(j => j.status === "failed").length;
    const pendingJobs = jobs.filter(j => j.status === "pending").length;
    const cancelledJobs = jobs.filter(j => j.status === "cancelled").length;
    const successRate = totalJobs > 0 ? Math.round((completedJobs / (completedJobs + failedJobs)) * 100) : 100;

    // =====================================================
    // 2. OVERDUE/STUCK JOBS
    // =====================================================
    console.log("Checking for stuck jobs...");
    
    const { data: overdueJobs } = await supabase
      .from("scheduled_jobs")
      .select("id, job_type, booking_id, run_at, attempts, last_error")
      .eq("status", "pending")
      .lt("run_at", oneHourAgo)
      .order("run_at", { ascending: true })
      .limit(20);

    const stuckCount = overdueJobs?.length || 0;
    if (stuckCount > 0) {
      healthScore -= Math.min(stuckCount * 5, 30);
      recommendations.push(`Fix ${stuckCount} overdue jobs - check if process-scheduled-jobs cron is running`);
    }

    // =====================================================
    // 3. FUNCTION-LEVEL METRICS
    // =====================================================
    console.log("Calculating function-level metrics...");
    
    const functionStats: Record<string, FunctionMetrics> = {};
    const jobTypeToFunction: Record<string, string> = {
      "balance_retry_1": "create-balance-payment-link",
      "balance_retry_2": "create-balance-payment-link",
      "balance_retry_3": "create-balance-payment-link",
      "create_balance_payment_link": "create-balance-payment-link",
      "host_report_pre_start": "schedule-host-report-reminders",
      "host_report_during": "schedule-host-report-reminders",
      "host_report_post": "schedule-host-report-reminders",
      "set_lifecycle_in_progress": "process-scheduled-jobs",
      "set_lifecycle_post_event": "process-scheduled-jobs",
    };

    for (const job of jobs) {
      const funcName = jobTypeToFunction[job.job_type] || job.job_type;
      if (!functionStats[funcName]) {
        functionStats[funcName] = {
          function_name: funcName,
          total_jobs: 0,
          completed: 0,
          failed: 0,
          pending: 0,
          cancelled: 0,
          success_rate: 0,
          sample_errors: [],
        };
      }
      
      functionStats[funcName].total_jobs++;
      if (job.status === "completed") functionStats[funcName].completed++;
      if (job.status === "failed") functionStats[funcName].failed++;
      if (job.status === "pending") functionStats[funcName].pending++;
      if (job.status === "cancelled") functionStats[funcName].cancelled++;
      
      if (job.status === "failed" && job.last_error && functionStats[funcName].sample_errors.length < 3) {
        functionStats[funcName].sample_errors.push(job.last_error.substring(0, 150));
      }
    }

    // Calculate success rates
    const functionMetrics = Object.values(functionStats).map(f => {
      const denominator = f.completed + f.failed;
      f.success_rate = denominator > 0 ? Math.round((f.completed / denominator) * 100) : 100;
      
      // Add recommendations for failing functions
      if (f.success_rate < 90 && f.failed > 2) {
        healthScore -= 10;
        recommendations.push(`${f.function_name} has ${f.success_rate}% success rate (${f.failed} failures) - review error logs`);
      }
      
      return f;
    }).sort((a, b) => a.success_rate - b.success_rate);

    // =====================================================
    // 4. LIFECYCLE ISSUES
    // =====================================================
    console.log("Checking lifecycle issues...");
    
    // Bookings past event date stuck in pre_event_ready
    const { count: stuckPreEvent } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("lifecycle_status", "pre_event_ready")
      .neq("status", "cancelled")
      .lt("event_date", yesterday);

    // Bookings more than 2 days past event still in in_progress
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { count: stuckInProgress } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("lifecycle_status", "in_progress")
      .neq("status", "cancelled")
      .lt("event_date", twoDaysAgo);

    // Bookings fully paid but not in correct lifecycle
    const { count: wrongPaymentLifecycle } = await supabase
      .from("bookings")
      .select("*", { count: "exact", head: true })
      .eq("payment_status", "fully_paid")
      .eq("lifecycle_status", "pending")
      .neq("status", "cancelled");

    if ((stuckPreEvent || 0) > 0) {
      healthScore -= 15;
      recommendations.push(`${stuckPreEvent} bookings stuck in pre_event_ready with past event dates - lifecycle transitions failing`);
    }
    if ((stuckInProgress || 0) > 0) {
      healthScore -= 10;
      recommendations.push(`${stuckInProgress} bookings stuck in in_progress more than 2 days after event`);
    }
    if ((wrongPaymentLifecycle || 0) > 0) {
      healthScore -= 10;
      recommendations.push(`${wrongPaymentLifecycle} fully paid bookings with incorrect lifecycle status`);
    }

    // =====================================================
    // 5. AFFECTED BOOKINGS DETAIL
    // =====================================================
    console.log("Gathering affected bookings...");
    
    const affectedBookings: AffectedBooking[] = [];
    
    // Get bookings with failed jobs
    const { data: bookingsWithFailedJobs } = await supabase
      .from("scheduled_jobs")
      .select(`
        booking_id, job_type, last_error,
        bookings!inner(reservation_number, event_date, full_name, lifecycle_status, payment_status, status)
      `)
      .eq("status", "failed")
      .gte("attempts", 3)
      .gte("updated_at", sevenDaysAgo)
      .limit(20);

    const bookingIssueMap: Record<string, AffectedBooking> = {};

    for (const item of bookingsWithFailedJobs || []) {
      const booking = item.bookings as any;
      if (booking.status === "cancelled") continue;
      
      const key = item.booking_id;
      if (!bookingIssueMap[key]) {
        bookingIssueMap[key] = {
          reservation_number: booking.reservation_number,
          event_date: booking.event_date,
          guest_name: booking.full_name,
          lifecycle_status: booking.lifecycle_status,
          payment_status: booking.payment_status,
          issues: [],
          recommended_action: "",
        };
      }
      bookingIssueMap[key].issues.push(`${item.job_type} failed: ${(item.last_error || "unknown error").substring(0, 50)}`);
    }

    // Add stuck bookings
    const { data: stuckBookingsData } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, full_name, lifecycle_status, payment_status")
      .eq("lifecycle_status", "pre_event_ready")
      .neq("status", "cancelled")
      .lt("event_date", yesterday)
      .limit(10);

    for (const booking of stuckBookingsData || []) {
      const key = booking.id;
      if (!bookingIssueMap[key]) {
        bookingIssueMap[key] = {
          reservation_number: booking.reservation_number,
          event_date: booking.event_date,
          guest_name: booking.full_name,
          lifecycle_status: booking.lifecycle_status,
          payment_status: booking.payment_status,
          issues: [],
          recommended_action: "",
        };
      }
      bookingIssueMap[key].issues.push("Stuck in pre_event_ready with past event date");
    }

    // Generate recommendations for each booking
    for (const booking of Object.values(bookingIssueMap)) {
      if (booking.issues.some(i => i.includes("balance"))) {
        booking.recommended_action = "Call trigger-booking-automation to reschedule balance jobs";
      } else if (booking.issues.some(i => i.includes("host_report"))) {
        booking.recommended_action = "Call schedule-host-report-reminders with force_reschedule=true";
      } else if (booking.issues.some(i => i.includes("Stuck"))) {
        booking.recommended_action = "Manually transition lifecycle or check GHL pipeline stage";
      } else {
        booking.recommended_action = "Review job errors and retry manually";
      }
      affectedBookings.push(booking);
    }

    // =====================================================
    // 6. DETERMINE OVERALL HEALTH
    // =====================================================
    let overallHealth: "healthy" | "warning" | "critical" = "healthy";
    if (healthScore < 50) {
      overallHealth = "critical";
    } else if (healthScore < 80) {
      overallHealth = "warning";
    }

    // Add general recommendations
    if (failedJobs > 10) {
      recommendations.push("High number of failed jobs - review Edge Function logs for patterns");
    }
    if (pendingJobs > 50) {
      recommendations.push("Large queue of pending jobs - check processor frequency and capacity");
    }
    if (recommendations.length === 0) {
      recommendations.push("System appears healthy - no immediate action required");
    }

    // =====================================================
    // 7. BUILD REPORT
    // =====================================================
    const report: DiagnosticReport = {
      overall_health: overallHealth,
      checked_at: now.toISOString(),
      metrics: {
        total_jobs_7d: totalJobs,
        completed_7d: completedJobs,
        failed_7d: failedJobs,
        pending_now: pendingJobs,
        overdue_now: stuckCount,
        overall_success_rate: successRate,
      },
      function_metrics: functionMetrics,
      affected_bookings: affectedBookings.slice(0, 15),
      stuck_jobs: {
        count: stuckCount,
        oldest_run_at: overdueJobs?.[0]?.run_at,
        details: (overdueJobs || []).slice(0, 10).map(j => ({
          job_type: j.job_type,
          booking_id: j.booking_id,
          run_at: j.run_at,
        })),
      },
      lifecycle_issues: {
        stuck_in_pre_event: stuckPreEvent || 0,
        stuck_in_in_progress: stuckInProgress || 0,
        wrong_payment_lifecycle: wrongPaymentLifecycle || 0,
      },
      recommendations: recommendations,
    };

    console.log(`Diagnostics complete: ${overallHealth.toUpperCase()} (score: ${healthScore})`);
    console.log(`Recommendations: ${recommendations.length}`);

    // Log diagnostic run to booking_events
    await supabase.from("booking_events").insert({
      booking_id: "00000000-0000-0000-0000-000000000000",
      event_type: "system_diagnostics_run",
      channel: "system",
      metadata: {
        overall_health: overallHealth,
        health_score: healthScore,
        total_jobs_7d: totalJobs,
        failed_7d: failedJobs,
        affected_bookings_count: affectedBookings.length,
        recommendations_count: recommendations.length,
      },
    });

    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in system-health-diagnostics:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    return new Response(JSON.stringify({ 
      overall_health: "critical",
      error: errorMessage,
      recommendations: ["System diagnostics failed - check Edge Function logs"],
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
