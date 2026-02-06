import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_SITE_URL = "https://orlandoeventvenue.lovable.app";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function generateEmailHTML(staffName: string, cleaningType: string, scheduledTime: string, reportUrl: string): string {
  return `<table style="margin:0;padding:28px 12px;" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6"><tbody><tr><td align="center"><table style="max-width:680px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 30px rgba(15,23,42,0.10);overflow:hidden;" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"><tbody><tr><td style="background:linear-gradient(135deg,#111827,#1f2937);padding:22px 26px;color:#ffffff;text-align:left;font-family:Verdana,Arial,sans-serif;"><div style="font-size:18px;font-weight:800;letter-spacing:0.2px;margin:0;"><p style="margin:0px;"><strong>Standalone Cleaning Assignment Reminder</strong></p></div><div style="margin-top:6px;font-size:13px;line-height:1.6;color:#e5e7eb;"><p style="margin:0px;">Your cleaning assignment starts in 1 hour. Please submit the report the same day.</p></div><table style="margin-top:12px;" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="background:#f59e0b;color:#111827;border-radius:999px;padding:6px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:900;"><p style="margin:0px;"><strong>ACTION NEEDED</strong></p></td></tr></tbody></table></td></tr><tr><td style="padding:22px 26px 14px 26px;text-align:left;font-family:Verdana,Arial,sans-serif;color:#111827;"><p style="margin:0px;line-height:1.7;font-size:14px;color:#374151;">Hi <strong>${staffName}</strong>,</p><p style="margin:0px;line-height:1.75;font-size:14px;color:#374151;">This is a reminder that you have a <strong>standalone cleaning assignment</strong> starting in <strong>1 hour</strong> (at ${scheduledTime}).</p><p style="margin:0px;line-height:1.75;font-size:14px;color:#374151;">Please submit the Cleaning Report <strong>the same day</strong> the cleaning is completed.</p><table style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:12px;margin:12px 0;" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="padding:14px;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.10em;color:#6b7280;font-weight:900;margin:0 0 8px 0;"><p style="margin:0px;"><strong>ASSIGNMENT DETAILS</strong></p></div><div style="font-size:14px;line-height:1.75;color:#111827;"><p style="margin:0px;">Type: ${cleaningType}</p><p style="margin:0px;">Time: ${scheduledTime}</p></div></td></tr></tbody></table><table style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:12px;margin:0 0 12px 0;" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="padding:14px;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.10em;color:#6b7280;font-weight:900;margin:0 0 8px 0;"><p style="margin:0px;"><strong>Required Submission (English)</strong></p></div><div style="font-size:14px;line-height:1.75;color:#111827;"><p style="margin:0px;">Complete the 10-item checklist (all items checked).</p><p style="margin:0px;">Upload photos - MAIN AREA is mandatory (at least 1 photo).</p><p style="margin:0px;">Add notes for any issues.</p><p style="margin:0px;">If damage is found: mark "Damage Found" + details (photo recommended).</p><p style="margin:0px;">If inventory needs restock: mark "Inventory update needed" + list items.</p></div></td></tr></tbody></table><table style="border:1px solid #e5e7eb;background:#ffffff;border-radius:12px;margin:0 0 12px 0;" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="padding:14px;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.10em;color:#6b7280;font-weight:900;margin:0 0 8px 0;"><p style="margin:0px;"><strong>Envio requerido (Espanol)</strong></p></div><div style="font-size:14px;line-height:1.75;color:#374151;"><p style="margin:0px;">Completa la lista de 10 puntos (todos marcados).</p><p style="margin:0px;">Sube fotos - el AREA PRINCIPAL es obligatoria (minimo 1 foto).</p><p style="margin:0px;">Agrega notas si hubo algun problema.</p><p style="margin:0px;">Si encuentras danos: marca "Damage Found" + detalles (foto recomendada).</p><p style="margin:0px;">Si falta inventario: marca "Inventory update needed" + lista de articulos.</p></div></td></tr></tbody></table><table style="margin:6px 0 0 0;" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="border-radius:10px;padding:12px 24px;" bgcolor="#16a34a"><a href="${reportUrl}" target="_blank" rel="noopener noreferrer" style="color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;"><strong>Submit Cleaning Report Here</strong></a></td></tr></tbody></table><p style="margin:12px 0 0 0;line-height:1.6;font-size:12px;color:#6b7280;">If you have any trouble accessing the link or uploading photos, reply to this email immediately.<br><br>Si tienes problemas para abrir el link o subir las fotos, responde a este correo de inmediato.</p><div style="border-top:1px solid #e5e7eb;margin:16px 0;"></div><p style="margin:0px;line-height:1.75;font-size:14px;color:#374151;">-- <strong>Orlando Event Venue Admin</strong></p></td></tr><tr><td style="padding:0 26px 20px 26px;text-align:left;font-family:Verdana,Arial,sans-serif;font-size:11px;line-height:1.6;color:#9ca3af;"><p style="margin:0px;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803<br>This is an automated reminder email - please keep it for your records.</p></td></tr></tbody></table></td></tr></tbody></table>`;
}

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    
    if (!gmailUser || !gmailPassword) {
      throw new Error("GMAIL_USER or GMAIL_APP_PASSWORD not configured");
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    
    // Calculate time window: assignments starting in 60 minutes (±5 min buffer)
    const now = new Date();
    const targetTime = new Date(now.getTime() + 60 * 60 * 1000); // +1 hour
    const bufferStart = new Date(targetTime.getTime() - 5 * 60 * 1000);
    const bufferEnd = new Date(targetTime.getTime() + 5 * 60 * 1000);
    
    console.log(`[STANDALONE-REMINDER] Checking for assignments between ${bufferStart.toISOString()} and ${bufferEnd.toISOString()}`);
    
    // Find standalone assignments that haven't been reminded yet
    const { data: assignments, error } = await supabase
      .from('booking_staff_assignments')
      .select(`
        id,
        scheduled_date,
        scheduled_start_time,
        scheduled_end_time,
        cleaning_type,
        celebration_surcharge,
        staff_id,
        reminder_sent_at
      `)
      .is('booking_id', null) // Standalone only
      .eq('status', 'assigned')
      .is('reminder_sent_at', null) // Not reminded yet
      .not('scheduled_start_time', 'is', null);
    
    if (error) {
      console.error("[STANDALONE-REMINDER] Error fetching assignments:", error);
      throw error;
    }
    
    if (!assignments || assignments.length === 0) {
      console.log("[STANDALONE-REMINDER] No unnotified standalone assignments found");
      return new Response(
        JSON.stringify({ message: "No assignments found to notify" }), 
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    console.log(`[STANDALONE-REMINDER] Found ${assignments.length} potential assignments`);
    
    // For each assignment, get the staff member info
    const staffIds = [...new Set(assignments.map((a: any) => a.staff_id))];
    const { data: staffMembers } = await supabase
      .from('staff_members')
      .select('id, full_name, email')
      .in('id', staffIds);
    
    const staffMap = new Map((staffMembers || []).map((s: any) => [s.id, s]));
    
    // Filter by time window (combine scheduled_date + scheduled_start_time)
    const assignmentsToNotify = assignments.filter((a: any) => {
      if (!a.scheduled_date || !a.scheduled_start_time) return false;
      
      const assignmentDateTime = new Date(`${a.scheduled_date}T${a.scheduled_start_time}`);
      const inWindow = assignmentDateTime >= bufferStart && assignmentDateTime <= bufferEnd;
      
      if (inWindow) {
        console.log(`[STANDALONE-REMINDER] Assignment ${a.id} scheduled for ${assignmentDateTime.toISOString()} is in window`);
      }
      
      return inWindow;
    });
    
    console.log(`[STANDALONE-REMINDER] ${assignmentsToNotify.length} assignments need notification`);
    
    if (assignmentsToNotify.length === 0) {
      return new Response(
        JSON.stringify({ message: "No assignments in the 1-hour window" }), 
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Send emails via Gmail SMTP
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPassword },
      },
    });
    
    const emailResults = [];
    
    for (const assignment of assignmentsToNotify) {
      const staff = staffMap.get(assignment.staff_id);
      
      if (!staff || !staff.email) {
        console.log(`[STANDALONE-REMINDER] Skipping assignment ${assignment.id}: no staff email`);
        emailResults.push({ success: false, assignment_id: assignment.id, reason: "no_email" });
        continue;
      }
      
      // Generate report URL
      const reportUrl = `${PUBLIC_SITE_URL}/staff/standalone/${assignment.id}/cleaning-report`;
      
      // Format cleaning type
      const cleaningTypeLabel = 
        assignment.cleaning_type === 'touch_up' ? 'Touch-Up Cleaning ($40)' :
        assignment.cleaning_type === 'regular' ? 'Regular Cleaning ($80)' :
        assignment.cleaning_type === 'deep' ? 'Deep Cleaning ($150)' : 
        (assignment.cleaning_type || 'Cleaning Task');
      
      const scheduledTime = assignment.scheduled_start_time 
        ? assignment.scheduled_start_time.slice(0, 5) 
        : 'TBD';
      
      const htmlEmail = generateEmailHTML(staff.full_name, cleaningTypeLabel, scheduledTime, reportUrl);
      
      try {
        await client.send({
          from: `"Orlando Event Venue" <${gmailUser}>`,
          to: staff.email,
          subject: "🧹 Cleaning Assignment Reminder - Today in 1 Hour",
          content: "Your standalone cleaning assignment starts in 1 hour.",
          html: htmlEmail,
        });
        
        // Mark reminder as sent
        await supabase
          .from('booking_staff_assignments')
          .update({ reminder_sent_at: new Date().toISOString() })
          .eq('id', assignment.id);
        
        console.log(`[STANDALONE-REMINDER] Email sent successfully to ${staff.email} for assignment ${assignment.id}`);
        emailResults.push({ success: true, assignment_id: assignment.id, staff_email: staff.email });
        
      } catch (emailError: any) {
        console.error(`[STANDALONE-REMINDER] Error sending email for assignment ${assignment.id}:`, emailError);
        emailResults.push({ success: false, assignment_id: assignment.id, reason: emailError.message });
      }
    }
    
    await client.close();
    
    const successCount = emailResults.filter(r => r.success).length;
    
    return new Response(
      JSON.stringify({ 
        message: `Sent ${successCount}/${assignmentsToNotify.length} reminder emails`,
        total_checked: assignments.length,
        in_time_window: assignmentsToNotify.length,
        results: emailResults
      }), 
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
    
  } catch (error: any) {
    console.error("[STANDALONE-REMINDER] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }), 
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
