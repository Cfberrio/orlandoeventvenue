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

/**
 * Generate Guest Feedback Email HTML
 */
function generateGuestFeedbackHTML(reservationNumber: string, guestName: string, eventDate: string): string {
  const formattedDate = formatDate(eventDate);
  const reportUrl = `https://orlandoeventvenue.org/guest/report/${reservationNumber}`;
  
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <title>Guest Report</title>
    <style>
      @media (max-width: 600px) {
        .container { width: 100% !important; }
        .px { padding-left: 18px !important; padding-right: 18px !important; }
      }
    </style>
  </head>

  <body style="margin:0; padding:0; background:#f6f7fb;">
    <!-- Preheader (hidden) -->
    <div style="display:none; font-size:1px; color:#f6f7fb; line-height:1px; max-height:0; max-width:0; opacity:0; overflow:hidden;">
      Quick reminder to complete your Guest Report when you have a moment.
    </div>

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb; padding:24px 0;">
      <tr>
        <td align="center" style="padding:0 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" class="container"
            style="width:600px; max-width:600px; background:#ffffff; border-radius:14px; overflow:hidden;
                   box-shadow:0 6px 20px rgba(18,38,63,0.08);">

            <!-- Header -->
            <tr>
              <td style="background:#111827; padding:18px 22px;" class="px">
                <div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#cbd5e1; letter-spacing:0.2px;">
                  Orlando Event Venue
                </div>
                <div style="font-family:Arial, Helvetica, sans-serif; font-size:20px; color:#ffffff; font-weight:700; margin-top:4px;">
                  Guest Report
                </div>
              </td>
            </tr>

            <!-- Body -->
            <tr>
              <td style="padding:22px;" class="px">
                <div style="font-family:Arial, Helvetica, sans-serif; font-size:16px; color:#111827; line-height:1.5;">
                  Hi ${guestName},
                </div>

                <div style="font-family:Arial, Helvetica, sans-serif; font-size:16px; color:#111827; line-height:1.6; margin-top:10px;">
                  Hope you're doing well — just a quick reminder to complete your <strong>Guest Report</strong> using the link below.
                </div>

                <div style="margin-top:14px; padding:12px 14px; border:1px solid #e5e7eb; border-radius:12px; background:#fafafa;">
                  <div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#111827; line-height:1.6;">
                    <strong>Confirmation Code:</strong> ${reservationNumber}<br />
                    <strong>Event Date:</strong> ${formattedDate}
                  </div>
                </div>

                <div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#334155; line-height:1.6; margin-top:14px;">
                  The form will ask for a few quick photos/videos (front door, main area, tables/chairs, bathrooms, and kitchen) and a couple of checkboxes — it only takes a few minutes.
                </div>

                <!-- CTA Button -->
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:18px;">
                  <tr>
                    <td bgcolor="#2563eb" style="border-radius:10px;">
                      <a href="${reportUrl}"
                        style="display:inline-block; padding:12px 18px; font-family:Arial, Helvetica, sans-serif;
                               font-size:15px; font-weight:700; color:#ffffff; text-decoration:none; border-radius:10px;">
                        Open Guest Report
                      </a>
                    </td>
                  </tr>
                </table>

                <div style="font-family:Arial, Helvetica, sans-serif; font-size:13px; color:#64748b; line-height:1.6; margin-top:10px;">
                  Or use this link:
                  <a href="${reportUrl}"
                     style="color:#2563eb; text-decoration:underline;">
                    ${reportUrl}
                  </a>
                </div>

                <div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#334155; line-height:1.6; margin-top:14px;">
                  Once you've submitted it, you can reply to this email with <strong>DONE</strong> (optional) so we know it's taken care of.
                  If you run into any issues with the form, just reply here and we'll help.
                </div>

                <div style="font-family:Arial, Helvetica, sans-serif; font-size:14px; color:#111827; margin-top:18px;">
                  Thank you, <br />
                  — Orlando Event Venue Team
                </div>
              </td>
            </tr>

            <!-- Footer -->
            <tr>
              <td style="padding:14px 22px; background:#f1f5f9;" class="px">
                <div style="font-family:Arial, Helvetica, sans-serif; font-size:12px; color:#64748b; line-height:1.5;">
                  Orlando Event Venue · 3847 E Colonial Dr, Orlando, FL 32803
                </div>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
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
      subject: `Guest Report Link for Your Reservation #${booking.reservation_number}`,
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
