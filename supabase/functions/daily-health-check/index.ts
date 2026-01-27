import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface HealthIssue {
  type: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  count: number;
  description: string;
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
    const { data: sinBalanceJobs, error: balanceError } = await supabase
      .rpc("count_bookings_without_balance_jobs");
    
    const countBalance = sinBalanceJobs || 0;

    if (balanceError) {
      console.error("Error counting bookings without balance jobs:", balanceError);
    }

    if (countBalance > 0) {
      console.log(`[ISSUE] Found ${countBalance} bookings without balance jobs`);
      issues.push({
        type: "sin_balance_jobs",
        severity: "CRITICAL",
        count: countBalance,
        description: `${countBalance} bookings with deposit_paid status do not have balance payment jobs scheduled. Guests will not receive payment reminders.`,
      });
    }

    // =====================================================
    // 4. Verificar bookings sin host report jobs
    // =====================================================
    const { data: sinHostJobs, error: hostError } = await supabase
      .rpc("count_bookings_without_host_jobs");
    
    const countHost = sinHostJobs || 0;

    if (hostError) {
      console.error("Error counting bookings without host jobs:", hostError);
    }

    if (countHost > 0) {
      console.log(`[ISSUE] Found ${countHost} bookings without host report jobs`);
      issues.push({
        type: "sin_host_jobs",
        severity: "HIGH",
        count: countHost,
        description: `${countHost} active bookings do not have host report jobs scheduled. Guests will not receive host report reminders.`,
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
  // Ordenar por severidad
  const sortedIssues = issues.sort((a, b) => {
    const order = { CRITICAL: 1, HIGH: 2, MEDIUM: 3 };
    return order[a.severity] - order[b.severity];
  });

  const issuesHTML = sortedIssues.map(issue => {
    const color = issue.severity === 'CRITICAL' ? '#dc2626' : issue.severity === 'HIGH' ? '#ea580c' : '#2563eb';
    const bgColor = issue.severity === 'CRITICAL' ? '#fef2f2' : issue.severity === 'HIGH' ? '#fff7ed' : '#eff6ff';
    const label = issue.severity === 'CRITICAL' ? 'CRITICAL' : issue.severity === 'HIGH' ? 'HIGH PRIORITY' : 'MEDIUM PRIORITY';
    
    return `
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${bgColor};border-left:4px solid ${color};margin:12px 0;">
        <tr>
          <td style="padding:16px;">
            <p style="margin:0 0 8px;">
              <strong style="color:${color};font-size:16px;">${label}</strong>
              <span style="background:${color};color:#ffffff;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:bold;margin-left:8px;">${issue.count}</span>
            </p>
            <p style="margin:0;color:#374151;line-height:1.6;font-size:14px;">${issue.description}</p>
          </td>
        </tr>
      </table>
    `;
  }).join('');

  const criticalCount = sortedIssues.filter(i => i.severity === 'CRITICAL').length;
  const highCount = sortedIssues.filter(i => i.severity === 'HIGH').length;
  const mediumCount = sortedIssues.filter(i => i.severity === 'MEDIUM').length;

  const summaryText = [
    criticalCount > 0 ? `${criticalCount} CRITICAL` : null,
    highCount > 0 ? `${highCount} HIGH PRIORITY` : null,
    mediumCount > 0 ? `${mediumCount} MEDIUM PRIORITY` : null,
  ].filter(Boolean).join(' • ');

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:Arial,Helvetica,sans-serif;background:#f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5f5f5;">
    <tr>
      <td align="center" style="padding:20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          
          <!-- Header -->
          <tr>
            <td style="background:#dc2626;padding:30px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:24px;font-weight:bold;">SYSTEM ALERT</h1>
              <p style="margin:8px 0 0;color:#ffffff;font-size:14px;">Orlando Event Venue - Automation System</p>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:30px;">
              
              <!-- Summary -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fee2e2;border:2px solid #fecaca;border-radius:8px;margin-bottom:20px;">
                <tr>
                  <td style="padding:16px;text-align:center;">
                    <p style="margin:0;color:#991b1b;font-size:18px;font-weight:bold;">${issues.length} Issue(s) Detected</p>
                    <p style="margin:4px 0 0;color:#dc2626;font-size:13px;font-weight:bold;">${summaryText}</p>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 20px;color:#333333;font-size:16px;line-height:1.6;">The monitoring system has detected the following issues that require attention:</p>

              <!-- Issues -->
              ${issuesHTML}

              <!-- Recommendations -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;margin-top:30px;">
                <tr>
                  <td style="padding:20px;">
                    <p style="margin:0 0 12px;color:#1e40af;font-weight:bold;font-size:15px;">Recommended Actions:</p>
                    <ul style="margin:0;padding-left:20px;color:#1e3a8a;font-size:14px;line-height:1.8;">
                      <li>Run the monitoring dashboard in Supabase SQL Editor to see details</li>
                      <li>Review Edge Functions logs in Supabase Dashboard</li>
                      <li>Verify that the process-scheduled-jobs cron job is active</li>
                      <li>If there are overdue jobs, check the processor configuration</li>
                      <li>The auto-repair system will attempt to fix some issues automatically every hour</li>
                    </ul>
                  </td>
                </tr>
              </table>

              <!-- Links -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;margin-top:20px;">
                <tr>
                  <td style="padding:16px;">
                    <p style="margin:0 0 8px;color:#374151;font-weight:bold;font-size:13px;">Quick Links:</p>
                    <p style="margin:0;font-size:13px;color:#6b7280;line-height:1.8;">
                      <a href="https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/editor" style="color:#2563eb;">SQL Editor</a> (to run verification queries)<br>
                      <a href="https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/logs" style="color:#2563eb;">Edge Functions Logs</a><br>
                      <a href="https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/database/cron-jobs" style="color:#2563eb;">Cron Jobs</a>
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Footer -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:30px;padding-top:20px;border-top:1px solid #e5e7eb;">
                <tr>
                  <td style="text-align:center;">
                    <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">
                      This is an automated email generated by the health monitoring system.<br>
                      <strong>Only sent when issues are detected.</strong> If everything works correctly, you will not receive emails.
                    </p>
                    <p style="margin:12px 0 0;color:#9ca3af;font-size:11px;">
                      Date: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })} EST
                    </p>
                  </td>
                </tr>
              </table>

            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
