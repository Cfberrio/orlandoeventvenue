import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface FunctionStats {
  function_name: string;
  total_jobs: number;
  completed_jobs: number;
  failed_jobs: number;
  success_rate: number;
}

interface RecentFailure {
  reservation_number: string;
  job_type: string;
  error_message: string;
  failed_at: string;
  attempts: number;
}

interface SystemMetrics {
  generated_at: string;
  jobs_24h: { pending: number; completed: number; failed: number };
  jobs_7d: { pending: number; completed: number; failed: number };
  jobs_30d: { pending: number; completed: number; failed: number };
  function_stats_7d: FunctionStats[];
  bookings_without_balance_jobs: number;
  bookings_without_host_jobs: number;
  bookings_stuck_lifecycle: number;
  recent_failures: RecentFailure[];
  cron_status: {
    process_scheduled_jobs: "likely_active" | "possibly_down";
    overdue_jobs_count: number;
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== get-system-metrics ===");
    
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const h24 = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const today = now.toISOString().split("T")[0];
    const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();

    // Jobs counts for different periods
    const [jobs24h, jobs7d, jobs30d] = await Promise.all([
      getJobCounts(supabase, h24),
      getJobCounts(supabase, d7),
      getJobCounts(supabase, d30),
    ]);

    // Function-level stats for last 7 days
    const { data: allJobs7d } = await supabase
      .from("scheduled_jobs")
      .select("job_type, status")
      .gte("created_at", d7);

    const functionStats = calculateFunctionStats(allJobs7d || []);

    // Bookings without required jobs
    const { data: bookingsNoBalance } = await supabase
      .from("bookings")
      .select("id")
      .eq("payment_status", "deposit_paid")
      .neq("status", "cancelled")
      .eq("lifecycle_status", "pre_event_ready")
      .is("balance_payment_url", null);

    const bookingIdsNoBalance = bookingsNoBalance?.map(b => b.id) || [];
    let bookingsWithoutBalanceJobs = 0;
    
    if (bookingIdsNoBalance.length > 0) {
      const { data: existingBalanceJobs } = await supabase
        .from("scheduled_jobs")
        .select("booking_id")
        .in("booking_id", bookingIdsNoBalance)
        .like("job_type", "balance%")
        .eq("status", "pending");
      
      const withJobs = new Set(existingBalanceJobs?.map(j => j.booking_id) || []);
      bookingsWithoutBalanceJobs = bookingIdsNoBalance.filter(id => !withJobs.has(id)).length;
    }

    // Bookings without host report jobs
    const { data: bookingsNoHost } = await supabase
      .from("bookings")
      .select("id")
      .neq("status", "cancelled")
      .in("lifecycle_status", ["pre_event_ready", "in_progress"])
      .gte("event_date", today);

    const bookingIdsNoHost = bookingsNoHost?.map(b => b.id) || [];
    let bookingsWithoutHostJobs = 0;

    if (bookingIdsNoHost.length > 0) {
      const { data: existingHostReports } = await supabase
        .from("booking_host_reports")
        .select("booking_id")
        .in("booking_id", bookingIdsNoHost);

      const { data: existingHostJobs } = await supabase
        .from("scheduled_jobs")
        .select("booking_id")
        .in("booking_id", bookingIdsNoHost)
        .like("job_type", "host_report%")
        .eq("status", "pending");

      const withReports = new Set(existingHostReports?.map(r => r.booking_id) || []);
      const withJobs = new Set(existingHostJobs?.map(j => j.booking_id) || []);
      bookingsWithoutHostJobs = bookingIdsNoHost.filter(id => !withReports.has(id) && !withJobs.has(id)).length;
    }

    // Stuck lifecycle bookings
    const yesterday = new Date(now.getTime() - 86400000).toISOString().split("T")[0];
    const { data: stuckBookings } = await supabase
      .from("bookings")
      .select("id")
      .eq("lifecycle_status", "pre_event_ready")
      .neq("status", "cancelled")
      .lt("event_date", yesterday);

    // Recent failures
    const { data: recentFailedJobs } = await supabase
      .from("scheduled_jobs")
      .select(`
        job_type, last_error, updated_at, attempts,
        bookings!inner(reservation_number)
      `)
      .eq("status", "failed")
      .gte("attempts", 3)
      .order("updated_at", { ascending: false })
      .limit(10);

    const recentFailures: RecentFailure[] = (recentFailedJobs || []).map(j => ({
      reservation_number: (j.bookings as any)?.reservation_number || "Unknown",
      job_type: j.job_type,
      error_message: (j.last_error || "Unknown error").substring(0, 200),
      failed_at: j.updated_at,
      attempts: j.attempts,
    }));

    // Cron status check
    const { data: overdueJobs } = await supabase
      .from("scheduled_jobs")
      .select("id")
      .eq("status", "pending")
      .lt("run_at", fiveMinAgo)
      .limit(20);

    const overdueCount = overdueJobs?.length || 0;

    const metrics: SystemMetrics = {
      generated_at: now.toISOString(),
      jobs_24h: jobs24h,
      jobs_7d: jobs7d,
      jobs_30d: jobs30d,
      function_stats_7d: functionStats,
      bookings_without_balance_jobs: bookingsWithoutBalanceJobs,
      bookings_without_host_jobs: bookingsWithoutHostJobs,
      bookings_stuck_lifecycle: stuckBookings?.length || 0,
      recent_failures: recentFailures,
      cron_status: {
        process_scheduled_jobs: overdueCount > 5 ? "possibly_down" : "likely_active",
        overdue_jobs_count: overdueCount,
      },
    };

    console.log("Metrics generated successfully");
    console.log(`Jobs 24h: pending=${jobs24h.pending}, completed=${jobs24h.completed}, failed=${jobs24h.failed}`);
    console.log(`Bookings missing jobs: balance=${bookingsWithoutBalanceJobs}, host=${bookingsWithoutHostJobs}`);

    return new Response(JSON.stringify(metrics), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in get-system-metrics:", error);
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

async function getJobCounts(supabase: any, since: string) {
  const [pending, completed, failed] = await Promise.all([
    supabase.from("scheduled_jobs").select("id", { count: "exact", head: true })
      .eq("status", "pending").gte("created_at", since),
    supabase.from("scheduled_jobs").select("id", { count: "exact", head: true })
      .eq("status", "completed").gte("created_at", since),
    supabase.from("scheduled_jobs").select("id", { count: "exact", head: true })
      .eq("status", "failed").gte("created_at", since),
  ]);

  return {
    pending: pending.count || 0,
    completed: completed.count || 0,
    failed: failed.count || 0,
  };
}

function calculateFunctionStats(jobs: { job_type: string; status: string }[]): FunctionStats[] {
  const mapping: Record<string, string> = {
    "balance_retry_1": "create-balance-payment-link",
    "balance_retry_2": "create-balance-payment-link",
    "balance_retry_3": "create-balance-payment-link",
    "host_report_pre_start": "schedule-host-report-reminders",
    "host_report_during": "schedule-host-report-reminders",
    "host_report_post": "schedule-host-report-reminders",
    "set_lifecycle_in_progress": "process-scheduled-jobs",
    "set_lifecycle_post_event": "process-scheduled-jobs",
  };

  const stats: Record<string, { total: number; completed: number; failed: number }> = {};

  for (const job of jobs) {
    const funcName = mapping[job.job_type] || job.job_type;
    if (!stats[funcName]) {
      stats[funcName] = { total: 0, completed: 0, failed: 0 };
    }
    stats[funcName].total++;
    if (job.status === "completed") stats[funcName].completed++;
    if (job.status === "failed") stats[funcName].failed++;
  }

  return Object.entries(stats).map(([name, s]) => ({
    function_name: name,
    total_jobs: s.total,
    completed_jobs: s.completed,
    failed_jobs: s.failed,
    success_rate: s.total > 0 ? Math.round((s.completed / s.total) * 100) : 100,
  })).sort((a, b) => b.total_jobs - a.total_jobs);
}
