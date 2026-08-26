import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import {
  BRAND,
  displayTitle,
  emailShell,
  escapeHtml,
  gap,
  heroModule,
  linkButton,
  numberedList,
  para,
  referenceModule,
  signature,
  sanitizeForSmtp,
  textModule,
} from "../_shared/email-layout.ts";

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

const SUBJECT = "Thank You for Hosting. One Quick Step to Close Out Your Event";

/**
 * Generate Guest Feedback Email HTML
 */
function generateGuestFeedbackHTML(reservationNumber: string, guestName: string, eventDate: string): string {
  const formattedDate = formatDate(eventDate);
  const reportUrl = `https://orlandoeventvenue.org/accesscode`;
  const safeName = escapeHtml(guestName);

  // Copy is verbatim from the ClickUp spec "OEV POST BOOKING COMMUNICATIONS",
  // section S06. Do not reword — design carries emphasis, never the wording.
  const body =
    heroModule({
      display: displayTitle(SUBJECT, { size: 32 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${safeName}</strong>,</p>` +
      para(`Thank you for choosing Orlando Event Venue, and thank you for trusting us to host your event. It genuinely means a lot.`) +
      para(`Now that your reservation has ended, there is one last step: your Guest Report. It is how we confirm the venue was closed out properly, and it takes about two minutes on your Event Page:`) +
      linkButton(reportUrl) +
      para(`Before you submit, just make sure:`) +
      numberedList([
        `Everyone has left.`,
        `The lights are off.`,
        `The trash is on the back patio with nothing left inside.`,
        `The tables and chairs are back in their original arrangement.`,
        `The prep kitchen and both bathrooms are checked.`,
        `Your personal items and equipment are cleared.`,
        `The entrance is locked.`,
      ]) +
      para(`Then upload a few quick photos. The report shows you exactly which ones.`) +
      para(`Your reservation stays open until we receive it, so please complete it while you are still on site if you can.`) +
      para(`One more thing. If your event went well, an honest Google review is the single biggest way you can help future hosts find us. We would be grateful:`) +
      linkButton(REVIEW_LINK) +
      para(`Thank you again for hosting with us.`) +
      signature({ phone: true }),
    ) +
    gap() +
    referenceModule([
      ["Reservation Number", escapeHtml(reservationNumber)],
      ["Event Date", formattedDate],
    ]);

  return emailShell({
    title: SUBJECT,
    preview: "Submit your Guest Report and tell us how it went.",
    body,
  });
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

    const emailHTML = sanitizeForSmtp(generateGuestFeedbackHTML(
      booking.reservation_number,
      booking.full_name,
      booking.event_date
    ));

    await client.send({
      from: gmailUser,
      to: booking.email,
      subject: SUBJECT,
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
