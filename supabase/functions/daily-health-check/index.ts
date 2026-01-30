import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BookingDetail {
  reservation_number: string;
  event_date: string;
  guest_name?: string;
  guest_email?: string;
}

interface FailedJobDetail {
  reservation_number: string;
  event_date: string;
  guest_name?: string;
  guest_email?: string;
  job_type: string;
  error_message: string;
  failed_at: string;
  attempts: number;
  function_name?: string;
}

interface ErrorGroup {
  function_name: string;
  error_pattern: string;
  count: number;
  bookings: FailedJobDetail[];
}

interface HealthIssue {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  count: number;
  description: string;
  bookings?: BookingDetail[];
  failed_jobs?: FailedJobDetail[];
  error_groups?: ErrorGroup[];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== daily-health-check v2 ===");
    console.log("Starting comprehensive system health check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const issues: HealthIssue[] = [];
    const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();

    // =====================================================
    // 1. CRITICAL: Jobs atrasados (más de 1 hora)
    // =====================================================
    const { data: overdueJobs, error: overdueError } = await supabase
      .from("scheduled_jobs")
      .select(`
        id, job_type, run_at, attempts, last_error,
        bookings!inner(id, reservation_number, event_date, full_name, email)
      `)
      .eq("status", "pending")
      .lt("run_at", oneHourAgo)
      .limit(20);

    if (overdueError) {
      console.error("Error fetching overdue jobs:", overdueError);
    }

    if (overdueJobs && overdueJobs.length > 0) {
      console.log(`[CRITICAL] Found ${overdueJobs.length} overdue jobs`);
      
      const failedDetails: FailedJobDetail[] = overdueJobs.map(job => {
        const booking = job.bookings as any;
        return {
          reservation_number: booking?.reservation_number || "Unknown",
          event_date: booking?.event_date || "Unknown",
          guest_name: booking?.full_name,
          guest_email: booking?.email,
          job_type: job.job_type,
          error_message: job.last_error || "Job overdue - processor may not be running",
          failed_at: job.run_at,
          attempts: job.attempts,
          function_name: extractFunctionName(job.job_type),
        };
      });

      issues.push({
        type: "jobs_overdue",
        severity: "CRITICAL",
        count: overdueJobs.length,
        description: `${overdueJobs.length} jobs are overdue by more than 1 hour. The cron processor may not be running!`,
        failed_jobs: failedDetails,
        error_groups: groupByFunction(failedDetails),
      });
    }

    // =====================================================
    // 2. CRITICAL: Jobs fallidos con 3+ intentos
    // =====================================================
    const { data: failedJobs, error: failedError } = await supabase
      .from("scheduled_jobs")
      .select(`
        id, job_type, run_at, attempts, last_error, updated_at,
        bookings!inner(id, reservation_number, event_date, full_name, email)
      `)
      .eq("status", "failed")
      .gte("attempts", 3)
      .gt("updated_at", twentyFourHoursAgo)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (failedError) {
      console.error("Error fetching failed jobs:", failedError);
    }

    if (failedJobs && failedJobs.length > 0) {
      console.log(`[CRITICAL] Found ${failedJobs.length} failed jobs (3+ attempts)`);
      
      const failedDetails: FailedJobDetail[] = failedJobs.map(job => {
        const booking = job.bookings as any;
        return {
          reservation_number: booking?.reservation_number || "Unknown",
          event_date: booking?.event_date || "Unknown",
          guest_name: booking?.full_name,
          guest_email: booking?.email,
          job_type: job.job_type,
          error_message: job.last_error || "Unknown error",
          failed_at: job.updated_at,
          attempts: job.attempts,
          function_name: extractFunctionName(job.job_type),
        };
      });

      const errorGroups = groupByFunction(failedDetails);

      issues.push({
        type: "jobs_failed_max_attempts",
        severity: "CRITICAL",
        count: failedJobs.length,
        description: `${failedJobs.length} jobs have failed after 3 attempts and require IMMEDIATE attention.`,
        failed_jobs: failedDetails,
        error_groups: errorGroups,
      });
    }

    // =====================================================
    // 3. HIGH: Bookings sin balance payment jobs
    // =====================================================
    const { data: bookingsNoBalance } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, full_name, email")
      .eq("payment_status", "deposit_paid")
      .neq("status", "cancelled")
      .eq("lifecycle_status", "pre_event_ready")
      .is("balance_payment_url", null)
      .order("event_date", { ascending: true })
      .limit(20);

    if (bookingsNoBalance && bookingsNoBalance.length > 0) {
      // Check which ones actually don't have scheduled jobs
      const bookingIds = bookingsNoBalance.map(b => b.id);
      const { data: existingJobs } = await supabase
        .from("scheduled_jobs")
        .select("booking_id")
        .in("booking_id", bookingIds)
        .like("job_type", "balance%")
        .eq("status", "pending");

      const bookingsWithJobs = new Set((existingJobs || []).map(j => j.booking_id));
      const actualMissing = bookingsNoBalance.filter(b => !bookingsWithJobs.has(b.id));

      if (actualMissing.length > 0) {
        console.log(`[HIGH] Found ${actualMissing.length} bookings without balance jobs`);
        issues.push({
          type: "missing_balance_jobs",
          severity: "CRITICAL",
          count: actualMissing.length,
          description: `${actualMissing.length} bookings with deposit_paid have NO balance payment jobs. Guests will NOT receive payment reminders!`,
          bookings: actualMissing.map(b => ({
            reservation_number: b.reservation_number,
            event_date: b.event_date,
            guest_name: b.full_name,
            guest_email: b.email,
          })),
        });
      }
    }

    // =====================================================
    // 4. HIGH: Bookings sin host report jobs
    // =====================================================
    const today = new Date().toISOString().split('T')[0];
    const { data: bookingsNoHost } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, full_name, email")
      .neq("status", "cancelled")
      .in("lifecycle_status", ["pre_event_ready", "in_progress"])
      .gte("event_date", today)
      .order("event_date", { ascending: true })
      .limit(20);

    if (bookingsNoHost && bookingsNoHost.length > 0) {
      const bookingIds = bookingsNoHost.map(b => b.id);
      
      // Check for existing host reports
      const { data: existingReports } = await supabase
        .from("booking_host_reports")
        .select("booking_id")
        .in("booking_id", bookingIds);
      
      // Check for pending host jobs
      const { data: existingHostJobs } = await supabase
        .from("scheduled_jobs")
        .select("booking_id")
        .in("booking_id", bookingIds)
        .like("job_type", "host_report%")
        .eq("status", "pending");

      const bookingsWithReports = new Set((existingReports || []).map(r => r.booking_id));
      const bookingsWithJobs = new Set((existingHostJobs || []).map(j => j.booking_id));
      
      const actualMissing = bookingsNoHost.filter(b => 
        !bookingsWithReports.has(b.id) && !bookingsWithJobs.has(b.id)
      );

      if (actualMissing.length > 0) {
        console.log(`[HIGH] Found ${actualMissing.length} bookings without host report jobs`);
        issues.push({
          type: "missing_host_jobs",
          severity: "HIGH",
          count: actualMissing.length,
          description: `${actualMissing.length} active bookings have NO host report jobs scheduled. Guests will NOT receive host report reminders!`,
          bookings: actualMissing.map(b => ({
            reservation_number: b.reservation_number,
            event_date: b.event_date,
            guest_name: b.full_name,
            guest_email: b.email,
          })),
        });
      }
    }

    // =====================================================
    // 5. MEDIUM: GHL sync failures
    // =====================================================
    const { data: ghlFailures } = await supabase
      .from("booking_events")
      .select(`
        id, booking_id, event_type, metadata, created_at,
        bookings!inner(reservation_number, event_date, full_name)
      `)
      .in("event_type", ["sync_to_ghl_failed", "ghl_sync_error"])
      .gt("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(20);

    if (ghlFailures && ghlFailures.length > 0) {
      console.log(`[MEDIUM] Found ${ghlFailures.length} GHL sync failures`);
      
      const failedDetails: FailedJobDetail[] = ghlFailures.map(evt => {
        const booking = evt.bookings as any;
        const metadata = evt.metadata as any;
        return {
          reservation_number: booking?.reservation_number || "Unknown",
          event_date: booking?.event_date || "Unknown",
          guest_name: booking?.full_name,
          job_type: evt.event_type,
          error_message: metadata?.error || metadata?.message || "GHL sync failed",
          failed_at: evt.created_at,
          attempts: 1,
          function_name: "sync-to-ghl",
        };
      });

      issues.push({
        type: "ghl_sync_failures",
        severity: "MEDIUM",
        count: ghlFailures.length,
        description: `${ghlFailures.length} GoHighLevel sync failures in last 24 hours.`,
        failed_jobs: failedDetails,
      });
    }

    // =====================================================
    // 6. CRITICAL: Bookings stuck in wrong lifecycle
    // =====================================================
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    // Bookings past event date still in pre_event_ready
    const { data: stuckBookings } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, full_name, lifecycle_status, payment_status")
      .eq("lifecycle_status", "pre_event_ready")
      .neq("status", "cancelled")
      .lt("event_date", yesterday)
      .limit(10);

    if (stuckBookings && stuckBookings.length > 0) {
      console.log(`[CRITICAL] Found ${stuckBookings.length} bookings stuck in wrong lifecycle`);
      issues.push({
        type: "stuck_lifecycle",
        severity: "CRITICAL",
        count: stuckBookings.length,
        description: `${stuckBookings.length} bookings have past event dates but are still in pre_event_ready. Lifecycle transitions may be broken!`,
        bookings: stuckBookings.map(b => ({
          reservation_number: b.reservation_number,
          event_date: b.event_date,
          guest_name: b.full_name,
        })),
      });
    }

    // =====================================================
    // 7. Check for error events in booking_events
    // =====================================================
    const { data: errorEvents } = await supabase
      .from("booking_events")
      .select(`
        id, booking_id, event_type, metadata, created_at,
        bookings!inner(reservation_number, event_date, full_name)
      `)
      .or("event_type.ilike.%error%,event_type.ilike.%failed%")
      .gt("created_at", twentyFourHoursAgo)
      .order("created_at", { ascending: false })
      .limit(30);

    if (errorEvents && errorEvents.length > 0) {
      // Filter out already counted GHL failures
      const nonGhlErrors = errorEvents.filter(e => 
        !e.event_type.includes("ghl") && !e.event_type.includes("sync_to_ghl")
      );

      if (nonGhlErrors.length > 0) {
        console.log(`[HIGH] Found ${nonGhlErrors.length} error events in last 24h`);
        
        const failedDetails: FailedJobDetail[] = nonGhlErrors.map(evt => {
          const booking = evt.bookings as any;
          const metadata = evt.metadata as any;
          return {
            reservation_number: booking?.reservation_number || "Unknown",
            event_date: booking?.event_date || "Unknown",
            guest_name: booking?.full_name,
            job_type: evt.event_type,
            error_message: metadata?.error || metadata?.message || metadata?.reason || "Error occurred",
            failed_at: evt.created_at,
            attempts: 1,
            function_name: extractFunctionFromEventType(evt.event_type),
          };
        });

        const errorGroups = groupByFunction(failedDetails);

        issues.push({
          type: "booking_error_events",
          severity: "HIGH",
          count: nonGhlErrors.length,
          description: `${nonGhlErrors.length} error events logged in last 24 hours across Edge Functions.`,
          failed_jobs: failedDetails.slice(0, 10), // Limit to 10 most recent
          error_groups: errorGroups,
        });
      }
    }

    // =====================================================
    // 8. Send alert email if issues found
    // =====================================================
    if (issues.length > 0) {
      console.log(`[ALERT] Found ${issues.length} issue categories, sending email alert...`);
      
      // Calculate totals
      const totalProblems = issues.reduce((sum, i) => sum + i.count, 0);
      const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
      const highCount = issues.filter(i => i.severity === 'HIGH').length;
      
      try {
        await sendAlertEmail(issues);
        console.log("[ALERT] Email sent successfully");
        
        // Log health check alert to booking_events for audit
        await supabase.from("booking_events").insert({
          booking_id: "00000000-0000-0000-0000-000000000000", // System event
          event_type: "system_health_alert_sent",
          channel: "email",
          metadata: {
            issues_count: issues.length,
            total_problems: totalProblems,
            critical_count: criticalCount,
            high_count: highCount,
            checked_at: new Date().toISOString(),
          },
        });
        
        return new Response(JSON.stringify({
          ok: true,
          alert_sent: true,
          issues_count: issues.length,
          total_problems: totalProblems,
          critical: criticalCount,
          high: highCount,
          issues: issues,
        }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (emailError) {
        console.error("[ALERT] Failed to send email:", emailError);
        
        return new Response(JSON.stringify({
          ok: false,
          alert_sent: false,
          issues_count: issues.length,
          issues: issues,
          error: "Failed to send email: " + (emailError instanceof Error ? emailError.message : "Unknown error"),
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // =====================================================
    // 9. All healthy
    // =====================================================
    console.log("[SUCCESS] No issues found, system is healthy");
    
    return new Response(JSON.stringify({
      ok: true,
      alert_sent: false,
      message: "System running correctly - no alert required",
      checked_at: new Date().toISOString(),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error: unknown) {
    console.error("Error in daily-health-check:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    return new Response(JSON.stringify({ 
      ok: false,
      error: errorMessage 
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

/**
 * Extract function name from job_type
 */
function extractFunctionName(jobType: string): string {
  const mapping: Record<string, string> = {
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
  return mapping[jobType] || jobType;
}

/**
 * Extract function name from event_type
 */
function extractFunctionFromEventType(eventType: string): string {
  if (eventType.includes("balance")) return "create-balance-payment-link";
  if (eventType.includes("host_report")) return "schedule-host-report-reminders";
  if (eventType.includes("ghl") || eventType.includes("sync")) return "sync-to-ghl";
  if (eventType.includes("lifecycle")) return "process-scheduled-jobs";
  if (eventType.includes("booking_confirmation")) return "send-booking-confirmation";
  if (eventType.includes("staff")) return "send-staff-assignment";
  return "unknown";
}

/**
 * Group failed jobs by function name
 */
function groupByFunction(jobs: FailedJobDetail[]): ErrorGroup[] {
  const groups: Record<string, ErrorGroup> = {};
  
  for (const job of jobs) {
    const key = job.function_name || "unknown";
    if (!groups[key]) {
      groups[key] = {
        function_name: key,
        error_pattern: job.error_message.substring(0, 100),
        count: 0,
        bookings: [],
      };
    }
    groups[key].count++;
    groups[key].bookings.push(job);
  }
  
  return Object.values(groups).sort((a, b) => b.count - a.count);
}

/**
 * Send alert email with detailed issues
 */
async function sendAlertEmail(issues: HealthIssue[]): Promise<void> {
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!gmailUser || !gmailPassword) {
    throw new Error("Email service not configured - GMAIL_USER or GMAIL_APP_PASSWORD missing");
  }

  console.log(`Sending alert email to orlandoglobalministries@gmail.com from ${gmailUser}`);

  const client = new SMTPClient({
    connection: {
      hostname: "smtp.gmail.com",
      port: 465,
      tls: true,
      auth: {
        username: gmailUser,
        password: gmailPassword,
      },
    },
  });

  const criticalCount = issues.filter(i => i.severity === 'CRITICAL').length;
  const highCount = issues.filter(i => i.severity === 'HIGH').length;
  const totalProblems = issues.reduce((sum, i) => sum + i.count, 0);
  
  const subject = criticalCount > 0 
    ? `[CRITICAL] OEV: ${totalProblems} system problem(s) require immediate attention`
    : highCount > 0
    ? `[ALERT] OEV: ${totalProblems} issue(s) detected`
    : `[INFO] OEV: ${totalProblems} issue(s) detected`;

  const emailHTML = generateAlertHTML(issues);

  await client.send({
    from: `"Orlando Event Venue" <${gmailUser}>`,
    to: "orlandoglobalministries@gmail.com",
    subject: subject,
    html: emailHTML,
  });

  await client.close();
  console.log("Alert email sent successfully");
}

/**
 * Generate simple HTML email (avoiding encoding issues)
 */
function generateAlertHTML(issues: HealthIssue[]): string {
  const sortedIssues = issues.sort((a, b) => {
    const order = { CRITICAL: 1, HIGH: 2, MEDIUM: 3 };
    return order[a.severity] - order[b.severity];
  });

  const criticalCount = sortedIssues.filter(i => i.severity === 'CRITICAL').length;
  const highCount = sortedIssues.filter(i => i.severity === 'HIGH').length;
  const totalProblems = sortedIssues.reduce((sum, i) => sum + i.count, 0);

  let issuesHTML = '';
  
  for (const issue of sortedIssues) {
    const severityColor = issue.severity === 'CRITICAL' ? '#dc2626' : 
                          issue.severity === 'HIGH' ? '#ea580c' : '#ca8a04';
    const severityBg = issue.severity === 'CRITICAL' ? '#fef2f2' : 
                       issue.severity === 'HIGH' ? '#fff7ed' : '#fefce8';
    
    issuesHTML += `<div style="border-left:4px solid ${severityColor};background:${severityBg};padding:15px;margin:15px 0;">`;
    issuesHTML += `<p style="margin:0 0 10px;font-weight:bold;color:${severityColor};">[${issue.severity}] ${issue.type.toUpperCase()}</p>`;
    issuesHTML += `<p style="margin:0 0 10px;">${issue.description}</p>`;
    
    // Show error groups if available
    if (issue.error_groups && issue.error_groups.length > 0) {
      issuesHTML += `<p style="margin:10px 0 5px;font-weight:bold;">Errors by Function:</p>`;
      for (const group of issue.error_groups.slice(0, 5)) {
        issuesHTML += `<p style="margin:2px 0;font-size:13px;">- ${group.function_name}: ${group.count} failure(s)</p>`;
      }
    }
    
    // Show affected bookings
    if (issue.bookings && issue.bookings.length > 0) {
      issuesHTML += `<p style="margin:10px 0 5px;font-weight:bold;">Affected Bookings:</p>`;
      for (const booking of issue.bookings.slice(0, 5)) {
        const eventDate = new Date(booking.event_date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric'
        });
        issuesHTML += `<p style="margin:2px 0;font-size:13px;">- ${booking.reservation_number} | ${eventDate}`;
        if (booking.guest_name) issuesHTML += ` | ${booking.guest_name}`;
        issuesHTML += `</p>`;
      }
      if (issue.bookings.length > 5) {
        issuesHTML += `<p style="margin:2px 0;font-size:12px;color:#666;">...and ${issue.bookings.length - 5} more</p>`;
      }
    }
    
    // Show failed job details
    if (issue.failed_jobs && issue.failed_jobs.length > 0 && !issue.bookings) {
      issuesHTML += `<p style="margin:10px 0 5px;font-weight:bold;">Failed Jobs:</p>`;
      for (const job of issue.failed_jobs.slice(0, 5)) {
        const eventDate = new Date(job.event_date).toLocaleDateString('en-US', {
          month: 'short', day: 'numeric', year: 'numeric'
        });
        issuesHTML += `<p style="margin:2px 0;font-size:13px;">- ${job.reservation_number} | ${eventDate} | ${job.job_type}</p>`;
        issuesHTML += `<p style="margin:2px 0 5px 15px;font-size:12px;color:#666;">Error: ${job.error_message.substring(0, 80)}${job.error_message.length > 80 ? '...' : ''}</p>`;
      }
      if (issue.failed_jobs.length > 5) {
        issuesHTML += `<p style="margin:2px 0;font-size:12px;color:#666;">...and ${issue.failed_jobs.length - 5} more</p>`;
      }
    }
    
    issuesHTML += `</div>`;
  }

  const now = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' });

  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;padding:20px;background:#f5f5f5;">
<div style="max-width:650px;margin:0 auto;background:white;padding:30px;">

<h1 style="color:#dc2626;margin:0 0 5px;">OEV SYSTEM ALERT</h1>
<p style="margin:0 0 20px;color:#666;">Orlando Event Venue - Automation Health Check</p>

<div style="background:#fee2e2;padding:15px;margin:20px 0;border-radius:4px;">
<p style="margin:0;font-size:18px;font-weight:bold;">${totalProblems} Problem(s) Detected</p>
${criticalCount > 0 ? `<p style="margin:5px 0 0;color:#dc2626;font-weight:bold;">${criticalCount} CRITICAL - Immediate action required</p>` : ''}
${highCount > 0 ? `<p style="margin:5px 0 0;color:#ea580c;">${highCount} HIGH PRIORITY</p>` : ''}
</div>

${issuesHTML}

<div style="background:#eff6ff;padding:15px;margin:20px 0;border-radius:4px;">
<p style="margin:0;font-weight:bold;">Recommended Actions:</p>
<p style="margin:10px 0 0;">1. Check the process-scheduled-jobs cron is running (every 5 minutes)</p>
<p style="margin:5px 0 0;">2. Review failed jobs in scheduled_jobs table</p>
<p style="margin:5px 0 0;">3. Check Edge Function logs for detailed error traces</p>
<p style="margin:5px 0 0;">4. The auto-repair system runs hourly at :15 to fix missing jobs</p>
</div>

<p style="margin:30px 0 0;color:#666;font-size:12px;border-top:1px solid #ddd;padding-top:15px;">
Automated health check - sent only when issues detected.<br>
Checked at: ${now} EST
</p>

</div>
</body>
</html>`;
}
