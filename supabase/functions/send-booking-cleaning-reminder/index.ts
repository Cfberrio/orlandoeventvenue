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

function generateEmailHTML(staffName: string, reportUrl: string): string {
  return `<table style="margin:0;padding:28px 12px;" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f3f4f6"><tbody><tr><td align="center"><table style="max-width:680px;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;box-shadow:0 12px 30px rgba(15,23,42,0.10);overflow:hidden;" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff"><tbody><tr><td style="background:linear-gradient(135deg,#111827,#1f2937);padding:22px 26px;color:#ffffff;text-align:left;font-family:Verdana,Arial,sans-serif;"><div style="font-size:18px;font-weight:800;letter-spacing:0.2px;margin:0;"><p style="margin:0px;"><strong>Cleaning Report Reminder</strong></p></div><div style="margin-top:6px;font-size:13px;line-height:1.6;color:#e5e7eb;"><p style="margin:0px;">The event has ended. Please submit your cleaning report as soon as possible.</p></div><table style="margin-top:12px;" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="background:#f59e0b;color:#111827;border-radius:999px;padding:6px 10px;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:900;"><p style="margin:0px;"><strong>ACTION NEEDED</strong></p></td></tr></tbody></table></td></tr><tr><td style="padding:22px 26px 14px 26px;text-align:left;font-family:Verdana,Arial,sans-serif;color:#111827;"><p style="margin:0px;line-height:1.7;font-size:14px;color:#374151;">Hi <strong>${staffName}</strong>,</p><p style="margin:12px 0;line-height:1.75;font-size:14px;color:#374151;">This is a reminder that the <strong>Cleaning Report</strong> for your assigned booking has <strong>not been submitted yet</strong>. The event ended over 24 hours ago.</p><p style="margin:0px;line-height:1.75;font-size:14px;color:#374151;">Please submit it as soon as possible so we can close out this booking.</p><table style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:12px;margin:12px 0;" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="padding:14px;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.10em;color:#6b7280;font-weight:900;margin:0 0 8px 0;"><p style="margin:0px;"><strong>Required Submission (English)</strong></p></div><div style="font-size:14px;line-height:1.75;color:#111827;"><p style="margin:0px;">Complete the 10-item checklist (all items checked).</p><p style="margin:0px;">Upload photos - MAIN AREA is mandatory (at least 1 photo).</p><p style="margin:0px;">Add notes for any issues.</p><p style="margin:0px;">If damage is found: mark "Damage Found" + details (photo recommended).</p><p style="margin:0px;">If inventory needs restock: mark "Inventory update needed" + list items.</p></div></td></tr></tbody></table><table style="border:1px solid #e5e7eb;background:#ffffff;border-radius:12px;margin:0 0 12px 0;" width="100%" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="padding:14px;"><div style="font-size:12px;text-transform:uppercase;letter-spacing:0.10em;color:#6b7280;font-weight:900;margin:0 0 8px 0;"><p style="margin:0px;"><strong>Envio requerido (Espanol)</strong></p></div><div style="font-size:14px;line-height:1.75;color:#374151;"><p style="margin:0px;">Completa la lista de 10 puntos (todos marcados).</p><p style="margin:0px;">Sube fotos - el AREA PRINCIPAL es obligatoria (minimo 1 foto).</p><p style="margin:0px;">Agrega notas si hubo algun problema.</p><p style="margin:0px;">Si encuentras danos: marca "Damage Found" + detalles (foto recomendada).</p><p style="margin:0px;">Si falta inventario: marca "Inventory update needed" + lista de articulos.</p></div></td></tr></tbody></table><table style="margin:6px 0 0 0;" cellpadding="0" cellspacing="0" border="0"><tbody><tr><td style="border-radius:10px;padding:12px 24px;" bgcolor="#16a34a"><a href="${reportUrl}" target="_blank" rel="noopener noreferrer" style="color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;"><strong>Submit Cleaning Report Here</strong></a></td></tr></tbody></table><p style="margin:12px 0 0 0;line-height:1.6;font-size:12px;color:#6b7280;">If you have any trouble accessing the link or uploading photos, reply to this email immediately.<br><br>Si tienes problemas para abrir el link o subir las fotos, responde a este correo de inmediato.</p><div style="border-top:1px solid #e5e7eb;margin:16px 0;"></div><p style="margin:0px;line-height:1.75;font-size:14px;color:#374151;">-- <strong>Orlando Event Venue Admin</strong></p></td></tr><tr><td style="padding:0 26px 20px 26px;text-align:left;font-family:Verdana,Arial,sans-serif;font-size:11px;line-height:1.6;color:#9ca3af;"><p style="margin:0px;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803<br>This is an automated reminder email - please keep it for your records.</p></td></tr></tbody></table></td></tr></tbody></table>`;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[BOOKING-CLEANING-REMINDER] Processing booking ${booking_id}`);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, event_date, end_time, booking_origin, full_name, reservation_number")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      console.error(`[BOOKING-CLEANING-REMINDER] Booking not found: ${booking_id}`, bookingError);
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found", skipped: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Guard: only website bookings
    if (booking.booking_origin !== "website") {
      console.log(`[BOOKING-CLEANING-REMINDER] Skipping non-website booking ${booking_id} (origin: ${booking.booking_origin})`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "not_website_booking" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Guard: check if cleaning report is already completed
    const { data: completedReports, error: reportError } = await supabase
      .from("booking_cleaning_reports")
      .select("id")
      .eq("booking_id", booking_id)
      .eq("status", "completed");

    if (reportError) {
      console.error(`[BOOKING-CLEANING-REMINDER] Error checking cleaning reports:`, reportError);
    }

    if (completedReports && completedReports.length > 0) {
      console.log(`[BOOKING-CLEANING-REMINDER] Cleaning report already completed for booking ${booking_id}, skipping`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "cleaning_report_already_completed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Fetch custodial staff assignments with staff member details
    const { data: custodialAssignments, error: staffError } = await supabase
      .from("booking_staff_assignments")
      .select(`
        id,
        staff_id,
        assignment_role,
        staff_members (
          id,
          full_name,
          email
        )
      `)
      .eq("booking_id", booking_id)
      .eq("assignment_role", "Custodial");

    if (staffError) {
      console.error(`[BOOKING-CLEANING-REMINDER] Error fetching custodial staff:`, staffError);
    }

    if (!custodialAssignments || custodialAssignments.length === 0) {
      console.log(`[BOOKING-CLEANING-REMINDER] No custodial staff assigned to booking ${booking_id}, skipping`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "no_custodial_staff" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Get Gmail credentials
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

    if (!gmailUser || !gmailPassword) {
      console.error("[BOOKING-CLEANING-REMINDER] GMAIL_USER or GMAIL_APP_PASSWORD not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "Email credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 6. Build cleaning report URL
    const reportUrl = `${PUBLIC_SITE_URL}/staff/bookings/${booking_id}/cleaning-report`;

    // 7. Send email to each custodial staff member
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPassword },
      },
    });

    const emailResults = [];

    for (const assignment of custodialAssignments) {
      const staffMember = assignment.staff_members as unknown as { id: string; full_name: string; email: string } | null;

      if (!staffMember || !staffMember.email) {
        console.log(`[BOOKING-CLEANING-REMINDER] Skipping assignment ${assignment.id}: no staff email`);
        emailResults.push({ success: false, assignment_id: assignment.id, reason: "no_email" });
        continue;
      }

      const htmlEmail = generateEmailHTML(staffMember.full_name, reportUrl);

      try {
        await client.send({
          from: `"Orlando Event Venue" <${gmailUser}>`,
          to: staffMember.email,
          subject: "Reminder: Cleaning Report Required",
          content: `Hi ${staffMember.full_name}, please submit your cleaning report for the booking. Link: ${reportUrl}`,
          html: htmlEmail,
        });

        console.log(`[BOOKING-CLEANING-REMINDER] Email sent to ${staffMember.email} for booking ${booking_id}`);
        emailResults.push({ success: true, assignment_id: assignment.id, staff_email: staffMember.email });
      } catch (emailError: unknown) {
        const errorMessage = emailError instanceof Error ? emailError.message : "Unknown email error";
        console.error(`[BOOKING-CLEANING-REMINDER] Error sending email to ${staffMember.email}:`, emailError);
        emailResults.push({ success: false, assignment_id: assignment.id, reason: errorMessage });
      }
    }

    await client.close();

    // 8. Log booking event
    const successCount = emailResults.filter(r => r.success).length;

    await supabase.from("booking_events").insert({
      booking_id: booking_id,
      event_type: "cleaning_report_reminder_sent",
      channel: "system",
      metadata: {
        emails_sent: successCount,
        emails_attempted: emailResults.length,
        reservation_number: booking.reservation_number,
        results: emailResults,
      },
    });

    console.log(`[BOOKING-CLEANING-REMINDER] Completed: ${successCount}/${emailResults.length} emails sent for booking ${booking_id}`);

    return new Response(
      JSON.stringify({
        ok: true,
        booking_id,
        emails_sent: successCount,
        emails_attempted: emailResults.length,
        results: emailResults,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("[BOOKING-CLEANING-REMINDER] Error:", error);
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
