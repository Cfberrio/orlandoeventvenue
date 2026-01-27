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
        description: `${jobsAtrasados} jobs llevan más de 1 hora atrasados. El procesador puede no estar funcionando correctamente.`,
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
        description: `${jobsFallidos} jobs han fallado después de 3 intentos y necesitan revisión manual.`,
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
        description: `${countBalance} bookings con deposit_paid no tienen balance payment jobs programados. Los guests no recibirán recordatorios de pago.`,
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
        description: `${countHost} bookings activos no tienen host report jobs programados. Los guests no recibirán reminders para el host report.`,
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
        description: `${syncFallos} sincronizaciones con GoHighLevel han fallado en las últimas 24 horas.`,
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
      message: "Sistema funcionando correctamente - no se requiere alerta",
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
    ? `🚨 CRÍTICO: Sistema OEV tiene ${criticalCount} problema(s) crítico(s)`
    : highCount > 0
    ? `⚠️ Alta Prioridad: Sistema OEV requiere atención (${issues.length} problema(s))`
    : `ℹ️ Alerta: Sistema OEV - ${issues.length} problema(s) detectado(s)`;

  const emailHTML = generateAlertHTML(issues);

  await client.send({
    from: gmailUser,
    to: "orlandoglobalministries@gmail.com",
    subject: subject,
    content: "Sistema de Automatización - Alerta de Problemas",
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
    const icon = issue.severity === 'CRITICAL' ? '🚨' : issue.severity === 'HIGH' ? '⚠️' : 'ℹ️';
    const color = issue.severity === 'CRITICAL' ? '#dc2626' : issue.severity === 'HIGH' ? '#ea580c' : '#2563eb';
    const bgColor = issue.severity === 'CRITICAL' ? '#fef2f2' : issue.severity === 'HIGH' ? '#fff7ed' : '#eff6ff';
    
    return `
      <div style="background:${bgColor};border-left:4px solid ${color};padding:16px;margin:12px 0;border-radius:4px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <span style="font-size:20px;">${icon}</span>
          <strong style="color:${color};font-size:16px;">${issue.severity}</strong>
          <span style="background:${color};color:white;padding:4px 12px;border-radius:12px;font-size:13px;font-weight:600;">${issue.count}</span>
        </div>
        <p style="margin:0;color:#374151;line-height:1.6;font-size:14px;">${issue.description}</p>
      </div>
    `;
  }).join('');

  const criticalCount = sortedIssues.filter(i => i.severity === 'CRITICAL').length;
  const highCount = sortedIssues.filter(i => i.severity === 'HIGH').length;
  const mediumCount = sortedIssues.filter(i => i.severity === 'MEDIUM').length;

  const summaryText = [
    criticalCount > 0 ? `${criticalCount} CRÍTICO(S)` : null,
    highCount > 0 ? `${highCount} ALTA PRIORIDAD` : null,
    mediumCount > 0 ? `${mediumCount} MEDIA PRIORIDAD` : null,
  ].filter(Boolean).join(' • ');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f3f4f6;">
  <div style="max-width:600px;margin:0 auto;padding:20px;">
    <div style="background:white;border-radius:8px;box-shadow:0 1px 3px rgba(0,0,0,0.1);overflow:hidden;">
      
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#dc2626 0%,#ea580c 100%);padding:32px 24px;text-align:center;">
        <h1 style="margin:0;color:white;font-size:26px;font-weight:700;">
          🚨 Alerta del Sistema
        </h1>
        <p style="margin:8px 0 0;color:rgba(255,255,255,0.95);font-size:15px;font-weight:500;">
          Orlando Event Venue - Sistema de Automatización
        </p>
      </div>

      <!-- Content -->
      <div style="padding:32px 24px;">
        
        <!-- Summary Badge -->
        <div style="background:#fee2e2;border:2px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;text-align:center;">
          <p style="margin:0;color:#991b1b;font-size:18px;font-weight:700;">
            ${issues.length} Problema(s) Detectado(s)
          </p>
          <p style="margin:4px 0 0;color:#dc2626;font-size:13px;font-weight:600;">
            ${summaryText}
          </p>
        </div>

        <p style="margin:0 0 20px;color:#1f2937;font-size:16px;line-height:1.6;">
          El sistema de monitoreo ha detectado los siguientes problemas que requieren atención:
        </p>

        <!-- Issues List -->
        ${issuesHTML}

        <!-- Recommendations Box -->
        <div style="margin-top:32px;padding:20px;background:#eff6ff;border-radius:8px;border:1px solid #bfdbfe;">
          <p style="margin:0 0 12px;color:#1e40af;font-weight:600;font-size:15px;">📋 Acciones Recomendadas:</p>
          <ul style="margin:0;padding-left:20px;color:#1e3a8a;font-size:14px;line-height:1.8;">
            <li>Ejecutar el dashboard de monitoreo en Supabase SQL Editor para ver detalles</li>
            <li>Revisar los logs de las Edge Functions en Supabase Dashboard</li>
            <li>Verificar que el cron job <code style="background:#dbeafe;padding:2px 6px;border-radius:3px;">process-scheduled-jobs</code> esté activo</li>
            <li>Si hay jobs atrasados, verificar la configuración del procesador</li>
            <li>El sistema de auto-reparación intentará corregir algunos problemas automáticamente cada hora</li>
          </ul>
        </div>

        <!-- Quick Links Box -->
        <div style="margin-top:20px;padding:16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;">
          <p style="margin:0 0 8px;color:#374151;font-weight:600;font-size:13px;">🔗 Enlaces Rápidos:</p>
          <div style="font-size:13px;color:#6b7280;line-height:1.8;">
            • <a href="https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/editor" style="color:#2563eb;">SQL Editor</a> (para ejecutar queries de verificación)<br>
            • <a href="https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/logs" style="color:#2563eb;">Edge Functions Logs</a><br>
            • <a href="https://supabase.com/dashboard/project/vsvsgesgqjtwutadcshi/database/cron-jobs" style="color:#2563eb;">Cron Jobs</a>
          </div>
        </div>

        <!-- Footer -->
        <div style="margin-top:32px;padding-top:24px;border-top:1px solid #e5e7eb;text-align:center;">
          <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.6;">
            Este es un email automático generado por el sistema de monitoreo de salud.<br>
            <strong>Solo se envía cuando se detectan problemas.</strong> Si todo funciona correctamente, no recibirás emails.
          </p>
          <p style="margin:12px 0 0;color:#9ca3af;font-size:11px;">
            Fecha: ${new Date().toLocaleString('es-US', { timeZone: 'America/New_York', dateStyle: 'full', timeStyle: 'short' })} EST
          </p>
        </div>
      </div>

    </div>
  </div>
</body>
</html>
  `;
}
