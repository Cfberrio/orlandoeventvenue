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

interface HealthIssue {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  count: number;
  description: string;
  bookings?: BookingDetail[];
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== daily-health-check ===");
    console.log("Starting system health check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const issues: HealthIssue[] = [];

    // =====================================================
    // 1. Verificar jobs atrasados (más de 1 hora)
    // =====================================================
    const oneHourAgo = new Date(Date.now() - 3600000).toISOString();
    
    const { count: jobsAtrasados } = await supabase
      .from("scheduled_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending")
      .lt("run_at", oneHourAgo);

    if (jobsAtrasados && jobsAtrasados > 0) {
      console.log(`[ISSUE] Found ${jobsAtrasados} overdue jobs`);
      issues.push({
        type: "jobs_atrasados",
        severity: "CRITICAL",
        count: jobsAtrasados,
        description: `${jobsAtrasados} jobs are overdue by more than 1 hour. The processor may not be working correctly.`,
      });
    }

    // =====================================================
    // 2. Verificar jobs fallidos (intentos >= 3)
    // =====================================================
    const { count: jobsFallidos } = await supabase
      .from("scheduled_jobs")
      .select("*", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("attempts", 3);

    if (jobsFallidos && jobsFallidos > 0) {
      console.log(`[ISSUE] Found ${jobsFallidos} failed jobs`);
      issues.push({
        type: "jobs_fallidos",
        severity: "HIGH",
        count: jobsFallidos,
        description: `${jobsFallidos} jobs have failed after 3 attempts and require manual review.`,
      });
    }

    // =====================================================
    // 3. Verificar bookings sin balance jobs
    // =====================================================
    const { data: bookingsSinBalance, error: balanceError } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, guest_name, guest_email")
      .eq("lifecycle_status", "deposit_paid")
      .is("balance_payment_url", null);

    if (balanceError) {
      console.error("Error getting bookings without balance jobs:", balanceError);
    }

    if (bookingsSinBalance && bookingsSinBalance.length > 0) {
      console.log(`[ISSUE] Found ${bookingsSinBalance.length} bookings without balance jobs`);
      issues.push({
        type: "sin_balance_jobs",
        severity: "CRITICAL",
        count: bookingsSinBalance.length,
        description: `${bookingsSinBalance.length} bookings with deposit_paid status do not have balance payment jobs scheduled. Guests will not receive payment reminders.`,
        bookings: bookingsSinBalance.map(b => ({
          reservation_number: b.reservation_number,
          event_date: b.event_date,
          guest_name: b.guest_name,
          guest_email: b.guest_email,
        })),
      });
    }

    // =====================================================
    // 4. Verificar bookings sin host report jobs
    // =====================================================
    const { data: bookingsSinHost, error: hostError } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, guest_name, guest_email")
      .eq("lifecycle_status", "pre_event_ready")
      .eq("host_report_step", "not_started");

    if (hostError) {
      console.error("Error getting bookings without host jobs:", hostError);
    }

    if (bookingsSinHost && bookingsSinHost.length > 0) {
      console.log(`[ISSUE] Found ${bookingsSinHost.length} bookings without host report jobs`);
      issues.push({
        type: "sin_host_jobs",
        severity: "HIGH",
        count: bookingsSinHost.length,
        description: `${bookingsSinHost.length} active bookings do not have host report jobs scheduled. Guests will not receive host report reminders.`,
        bookings: bookingsSinHost.map(b => ({
          reservation_number: b.reservation_number,
          event_date: b.event_date,
          guest_name: b.guest_name,
          guest_email: b.guest_email,
        })),
      });
    }

    // =====================================================
    // 5. Verificar fallos de sync GHL (últimas 24h)
    // =====================================================
    const twentyFourHoursAgo = new Date(Date.now() - 86400000).toISOString();
    
    const { count: syncFallos } = await supabase
      .from("booking_events")
      .select("*", { count: "exact", head: true })
      .eq("event_type", "sync_to_ghl_failed")
      .gt("created_at", twentyFourHoursAgo);

    if (syncFallos && syncFallos > 0) {
      console.log(`[ISSUE] Found ${syncFallos} GHL sync failures`);
      issues.push({
        type: "sync_ghl_failed",
        severity: "MEDIUM",
        count: syncFallos,
        description: `${syncFallos} GoHighLevel synchronizations have failed in the last 24 hours.`,
      });
    }

    // =====================================================
    // 6. Si hay problemas, enviar email de alerta
    // =====================================================
    if (issues.length > 0) {
      console.log(`[ALERT] Found ${issues.length} issues, sending email alert...`);
      
      try {
        await sendAlertEmail(issues);
        console.log("[ALERT] Email sent successfully");
        
        return new Response(JSON.stringify({
          ok: true,
          alert_sent: true,
          issues_count: issues.length,
          issues: issues,
          email_to: "orlandoglobalministries@gmail.com",
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
    // 7. Todo está bien, no enviar email
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
 * Envía email de alerta con los problemas detectados
 */
async function sendAlertEmail(issues: HealthIssue[]): Promise<void> {
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!gmailUser || !gmailPassword) {
    console.error("Gmail credentials not configured");
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
  const mediumCount = issues.filter(i => i.severity === 'MEDIUM').length;
  
  const subject = criticalCount > 0 
    ? `[CRITICAL] OEV System has ${criticalCount} critical issue(s)`
    : highCount > 0
    ? `[ALERT] OEV System requires attention (${issues.length} issue(s))`
    : `[INFO] Alert: OEV System - ${issues.length} issue(s) detected`;

  const emailHTML = generateAlertHTML(issues);

  await client.send({
    from: `"Orlando Event Venue" <${gmailUser}>`,
    to: "orlandoglobalministries@gmail.com",
    subject: subject,
    html: emailHTML,
  });

  await client.close();
  console.log("Alert email sent successfully to orlandoglobalministries@gmail.com");
}

/**
 * Genera el HTML del email de alerta
 */
function generateAlertHTML(issues: HealthIssue[]): string {
  const sortedIssues = issues.sort((a, b) => {
    const order = { CRITICAL: 1, HIGH: 2, MEDIUM: 3 };
    return order[a.severity] - order[b.severity];
  });

  const issuesHTML = sortedIssues.map(issue => {
    const severityLabel = issue.severity === 'CRITICAL' ? '[CRITICAL]' : 
                         issue.severity === 'HIGH' ? '[HIGH]' : '[MEDIUM]';
    
    let bookingsHTML = '';
    if (issue.bookings && issue.bookings.length > 0) {
      bookingsHTML = '<br><br><strong>Affected Bookings:</strong><br>';
      issue.bookings.forEach(booking => {
        const eventDate = new Date(booking.event_date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric'
        });
        bookingsHTML += `<br>- ${booking.reservation_number} | ${eventDate}`;
        if (booking.guest_name) {
          bookingsHTML += ` | ${booking.guest_name}`;
        }
      });
    }
    
    return `<p><strong>${severityLabel} ${issue.description}</strong>${bookingsHTML}</p>`;
  }).join('');

  const criticalCount = sortedIssues.filter(i => i.severity === 'CRITICAL').length;
  const highCount = sortedIssues.filter(i => i.severity === 'HIGH').length;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="font-family:Arial,sans-serif;padding:20px;background:#f5f5f5;">
<div style="max-width:600px;margin:0 auto;background:white;padding:30px;">

<h1 style="color:#dc2626;margin:0 0 10px;">OEV SYSTEM ALERT</h1>
<p style="margin:0 0 20px;color:#666;">Orlando Event Venue - Automation System</p>

<div style="background:#fee2e2;padding:15px;margin:20px 0;">
<p style="margin:0;"><strong>${issues.length} Issue(s) Detected</strong></p>
${criticalCount > 0 ? `<p style="margin:5px 0 0;color:#dc2626;">${criticalCount} CRITICAL</p>` : ''}
${highCount > 0 ? `<p style="margin:5px 0 0;color:#ea580c;">${highCount} HIGH PRIORITY</p>` : ''}
</div>

<div style="margin:20px 0;">
${issuesHTML}
</div>

<div style="background:#eff6ff;padding:15px;margin:20px 0;">
<p style="margin:0;"><strong>Recommended Actions:</strong></p>
<p style="margin:10px 0 0;">Review the affected bookings listed above and verify job scheduling. The auto-repair system runs hourly to fix missing jobs automatically.</p>
</div>

<p style="margin:30px 0 0;color:#666;font-size:12px;border-top:1px solid #ddd;padding-top:15px;">
This is an automated alert sent only when issues are detected.<br>
Date: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} EST
</p>

</div>
</body>
</html>`;
}
