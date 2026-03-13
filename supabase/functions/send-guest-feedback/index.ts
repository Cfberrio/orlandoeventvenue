import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALERT_EMAIL = "orlandoglobalministries@gmail.com";

/**
 * Send instant critical failure alert email
 */
async function sendCriticalAlert(functionName: string, reservationNumber: string, errorMsg: string, bookingId?: string): Promise<void> {
  try {
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailPassword) return;

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
    });

    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#dc2626;">CRITICAL FAILURE: ${functionName}</h2><p><b>Reservation:</b> ${reservationNumber}</p><p><b>Error:</b> ${errorMsg}</p><p><b>Time:</b> ${timestamp} EST</p>${bookingId ? `<p><b>Booking ID:</b> ${bookingId}</p>` : ""}<p style="margin-top:20px;color:#666;">This is an automated alert - immediate action required.</p></body></html>`;

    await client.send({
      from: `"OEV Alert" <${gmailUser}>`,
      to: ALERT_EMAIL,
      subject: `🚨 CRITICAL: ${functionName} Failed for ${reservationNumber}`,
      html,
    });
    await client.close();
    console.log(`[ALERT] Critical failure alert sent for ${reservationNumber}`);
  } catch (alertErr) {
    console.error("[ALERT] Failed to send critical alert:", alertErr);
  }
}

/**
 * Log critical error to booking_events table
 */
async function logCriticalError(supabase: any, bookingId: string, functionName: string, error: Error): Promise<void> {
  try {
    await supabase.from("booking_events").insert({
      booking_id: bookingId,
      event_type: `${functionName.replace(/-/g, "_")}_critical_failure`,
      channel: "system",
      metadata: {
        error_message: error.message,
        error_stack: error.stack?.substring(0, 500),
        timestamp: new Date().toISOString(),
        requires_manual_intervention: true,
      },
    });
  } catch (logErr) {
    console.error("Failed to log critical error:", logErr);
  }
}

/**
 * Format date to long format: "Monday, January 31, 2026"
 */
function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const REVIEW_LINK = "https://g.page/r/CU-yUA0El90UEAE/review";

/**
 * Generate Guest Feedback Email HTML
 */
function generateGuestFeedbackHTML(reservationNumber: string, guestName: string, eventDate: string): string {
  const formattedDate = formatDate(eventDate);
  const reportUrl = `https://orlandoeventvenue.org/guest/report/${reservationNumber}`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Guest Report Required | Orlando Event Venue</title>
  <meta name="description" content="There's one final step remaining after your event.">
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:0;mso-hide:all;">
    There's one final step remaining after your event.
  </div>
  <div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);">
    <div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">
      <h1 style="margin:0;font-size:24px;letter-spacing:.2px;line-height:1.25;">
        Guest Report <span style="color:#14ADE6;">Required</span>
      </h1>
      <p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">
        Orlando Event Venue
      </p>
    </div>
    <div style="padding:28px;">
      <p style="margin:0;font-size:16px;">
        Hi <strong>${guestName}</strong>,
      </p>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        We hope your event went well.
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        To officially close out your reservation, please complete your <strong>Guest Report</strong>.
      </p>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:18px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Reservation Details
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Reservation #</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${reservationNumber}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:10px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Event Date</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${formattedDate}</span>
            </td>
          </tr>
        </table>
      </div>
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Complete Your Guest Report Here
        </p>
        <div style="text-align:center;margin:10px 0 8px;">
          <a href="${reportUrl}"
             style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 30px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">
            Complete Guest Report
          </a>
        </div>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">
          If the button doesn't work, copy and paste this link into your browser:<br>
          <span style="word-break:break-all;color:#14ADE6;">${reportUrl}</span>
        </p>
      </div>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0;font-size:14px;line-height:1.65;color:#374151;">
          This report takes about <strong>2–3 minutes</strong> and includes photos or videos of the front door, main area, tables/chairs, bathrooms, and kitchen, plus a few final checkboxes.
        </p>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.65;color:#374151;">
          After submitting, please reply <strong>DONE</strong> to this email.
        </p>
        <p style="margin:12px 0 0;font-size:14px;line-height:1.65;color:#374151;">
          If you had any issues, reply here and let us know.
        </p>
      </div>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Optional Review
        </p>
        <p style="margin:0;font-size:14px;line-height:1.65;color:#374151;">
          If you have a moment, we'd appreciate a quick review of your experience.
        </p>
        <div style="text-align:center;margin:12px 0 0;">
          <a href="${REVIEW_LINK}"
             style="display:inline-block;background:#FFFFFF;color:#14ADE6;text-decoration:none;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:bold;border:1px solid rgba(20,173,230,.45);">
            Leave a Review
          </a>
        </div>
        <p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">
          Or copy/paste: <span style="word-break:break-all;color:#14ADE6;">${REVIEW_LINK}</span>
        </p>
      </div>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">
        Orlando Event Venue Team<br>
        <strong>407-974-5979</strong><br>
        <span style="color:#14ADE6;">orlandoeventvenue.org</span><br>
        orlandoeventvenue@gmail.com<br>
        3847 E Colonial Dr, Orlando, FL 32803
      </p>
    </div>
    <div style="padding:18px 26px;background:#F9FAFB;font-size:11px;color:#6B7280;border-top:1px solid #E5E7EB;">
      <p style="margin:0;font-weight:bold;color:#111827;">Orlando Event Venue Team</p>
      <p style="margin:6px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p>
      <p style="margin:6px 0 0;">orlandoeventvenue@gmail.com</p>
      <p style="margin:6px 0 0;">(407) 974-5979</p>
      <p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p>
    </div>
  </div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json();
    const booking_id = body.booking_id;

    if (!booking_id) {
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("=== send-guest-feedback ===");
    console.log("Processing booking:", booking_id);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, reservation_number, full_name, email, event_date")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate email
    if (!booking.email) {
      console.error("Booking has no email");
      await supabase.from("booking_events").insert({
        booking_id: booking_id,
        event_type: "guest_feedback_email_failed",
        channel: "system",
        metadata: {
          error: "No email",
          reservation_number: booking.reservation_number,
        },
      });
      return new Response(JSON.stringify({ error: "Booking has no email" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Sending guest feedback email to: ${booking.email}`);

    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

    if (!gmailUser || !gmailPassword) {
      console.error("Gmail credentials not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "Email service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const emailHTML = generateGuestFeedbackHTML(
      booking.reservation_number,
      booking.full_name,
      booking.event_date
    );

    await client.send({
      from: gmailUser,
      to: booking.email,
      subject: `Guest Report Needed to Close Out Your Reservation | Orlando Event Venue`,
      content: "Please view this email in an HTML-compatible email client.",
      html: emailHTML,
    });

    await client.close();

    console.log("Guest feedback email sent successfully");

    // Log success event
    await supabase.from("booking_events").insert({
      booking_id: booking_id,
      event_type: "guest_feedback_email_sent",
      channel: "email",
      metadata: {
        recipient: booking.email,
        reservation_number: booking.reservation_number,
        sent_at: new Date().toISOString(),
      },
    });

    return new Response(
      JSON.stringify({ 
        ok: true, 
        message: "Guest feedback email sent successfully",
        recipient: booking.email,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: unknown) {
    console.error("Error in send-guest-feedback:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    
    // Send critical alert and log error
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.booking_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        const { data: booking } = await supabase
          .from("bookings")
          .select("reservation_number")
          .eq("id", body.booking_id)
          .single();
        
        if (booking) {
          const err = error instanceof Error ? error : new Error(errorMessage);
          await sendCriticalAlert("send-guest-feedback", booking.reservation_number || body.booking_id, errorMessage, body.booking_id);
          await logCriticalError(supabase, body.booking_id, "send-guest-feedback", err);
        }
        
        // Log failure event
        await supabase.from("booking_events").insert({
          booking_id: body.booking_id,
          event_type: "guest_feedback_email_failed",
          channel: "system",
          metadata: {
            error: errorMessage,
            timestamp: new Date().toISOString(),
          },
        });
      }
    } catch (alertErr) {
      console.error("Error sending failure alert:", alertErr);
    }
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
