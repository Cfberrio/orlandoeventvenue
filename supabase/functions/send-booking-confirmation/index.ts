import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BookingEmailData {
  email: string;
  full_name: string;
  reservation_number: string;
  event_date: string;
  event_type: string;
  number_of_guests: number;
  booking_type: string;
  start_time?: string;
  end_time?: string;
  total_amount: number;
  deposit_amount: number;
  balance_amount: number;
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime(timeString: string | undefined): string {
  if (!timeString) return "N/A";
  const [hours, minutes] = timeString.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount);
}

function generateEmailHTML(booking: BookingEmailData): string {
  const timeInfo = booking.booking_type === "hourly" 
    ? `<tr>
        <td style="padding: 8px 0; color: #666;">Event Time:</td>
        <td style="padding: 8px 0; color: #333; font-weight: 500;">${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}</td>
      </tr>`
    : `<tr>
        <td style="padding: 8px 0; color: #666;">Rental Type:</td>
        <td style="padding: 8px 0; color: #333; font-weight: 500;">Full Day (24 hours)</td>
      </tr>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Booking Confirmation</title>
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f5f5f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 30px 40px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 600;">Orlando Event Venue</h1>
              <p style="color: #a0a0a0; margin: 10px 0 0 0; font-size: 14px;">Your Premier Event Space</p>
            </td>
          </tr>
          
          <!-- Success Banner -->
          <tr>
            <td style="background-color: #10b981; padding: 20px 40px; text-align: center;">
              <h2 style="color: #ffffff; margin: 0; font-size: 22px;">✓ Booking Confirmed!</h2>
              <p style="color: #d1fae5; margin: 8px 0 0 0; font-size: 14px;">Your deposit has been successfully processed</p>
            </td>
          </tr>
          
          <!-- Reservation Number -->
          <tr>
            <td style="padding: 30px 40px; text-align: center; border-bottom: 1px solid #eee;">
              <p style="color: #666; margin: 0 0 8px 0; font-size: 14px;">Your Reservation Number</p>
              <h2 style="color: #1a1a2e; margin: 0; font-size: 32px; font-weight: 700; letter-spacing: 2px;">${booking.reservation_number}</h2>
              <p style="color: #888; margin: 8px 0 0 0; font-size: 12px;">Please save this number for your records</p>
            </td>
          </tr>
          
          <!-- Greeting -->
          <tr>
            <td style="padding: 30px 40px 20px;">
              <p style="color: #333; margin: 0; font-size: 16px;">Dear <strong>${booking.full_name}</strong>,</p>
              <p style="color: #666; margin: 15px 0 0 0; font-size: 14px; line-height: 1.6;">
                Thank you for choosing Orlando Event Venue for your upcoming event! We are excited to host you and ensure your event is a memorable success.
              </p>
            </td>
          </tr>
          
          <!-- Booking Details -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Booking Details</h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">Event Date:</td>
                  <td style="padding: 8px 0; color: #333; font-weight: 500;">${formatDate(booking.event_date)}</td>
                </tr>
                ${timeInfo}
                <tr>
                  <td style="padding: 8px 0; color: #666;">Event Type:</td>
                  <td style="padding: 8px 0; color: #333; font-weight: 500;">${booking.event_type}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #666;">Number of Guests:</td>
                  <td style="padding: 8px 0; color: #333; font-weight: 500;">${booking.number_of_guests}</td>
                </tr>
              </table>
            </td>
          </tr>
          
          <!-- Payment Summary -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #eee; padding-bottom: 10px;">Payment Summary</h3>
              <table width="100%" cellpadding="0" cellspacing="0" style="font-size: 14px;">
                <tr>
                  <td style="padding: 8px 0; color: #666;">Total Amount:</td>
                  <td style="padding: 8px 0; color: #333; font-weight: 500;">${formatCurrency(booking.total_amount)}</td>
                </tr>
                <tr>
                  <td style="padding: 8px 0; color: #10b981;">Deposit Paid:</td>
                  <td style="padding: 8px 0; color: #10b981; font-weight: 600;">${formatCurrency(booking.deposit_amount)}</td>
                </tr>
                <tr style="border-top: 1px solid #eee;">
                  <td style="padding: 12px 0 8px; color: #333; font-weight: 600;">Balance Due:</td>
                  <td style="padding: 12px 0 8px; color: #e11d48; font-weight: 600;">${formatCurrency(booking.balance_amount)}</td>
                </tr>
              </table>
              <p style="color: #888; margin: 15px 0 0 0; font-size: 12px; background-color: #fef3c7; padding: 12px; border-radius: 4px;">
                <strong>Note:</strong> The remaining balance of ${formatCurrency(booking.balance_amount)} is due 15 days before your event date.
              </p>
            </td>
          </tr>
          
          <!-- Next Steps -->
          <tr>
            <td style="padding: 0 40px 30px;">
              <h3 style="color: #1a1a2e; margin: 0 0 15px 0; font-size: 18px; border-bottom: 2px solid #eee; padding-bottom: 10px;">What's Next?</h3>
              <ul style="color: #666; margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.8;">
                <li>Our team will review your booking and confirm availability</li>
                <li>You will receive a reminder email before your event</li>
                <li>The remaining balance will be collected 15 days before the event</li>
                <li>Contact us if you have any questions or special requests</li>
              </ul>
            </td>
          </tr>
          
          <!-- Contact Info -->
          <tr>
            <td style="background-color: #f8f9fa; padding: 25px 40px; text-align: center;">
              <p style="color: #666; margin: 0 0 5px 0; font-size: 14px;">Questions? Contact us at:</p>
              <p style="color: #1a1a2e; margin: 0; font-size: 16px; font-weight: 500;">info@orlandoeventvenue.com</p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="background-color: #1a1a2e; padding: 20px 40px; text-align: center;">
              <p style="color: #888; margin: 0; font-size: 12px;">
                © ${new Date().getFullYear()} Orlando Event Venue. All rights reserved.
              </p>
              <p style="color: #666; margin: 10px 0 0 0; font-size: 11px;">
                This is an automated confirmation email. Please do not reply directly to this message.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const booking: BookingEmailData = await req.json();
    console.log("Sending confirmation email for booking:", booking.reservation_number);

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

    const emailHTML = generateEmailHTML(booking);

    await client.send({
      from: gmailUser,
      to: booking.email,
      subject: `Booking Confirmed - ${booking.reservation_number} | Orlando Event Venue`,
      content: "Your booking has been confirmed. Please view this email in an HTML-compatible email client.",
      html: emailHTML,
    });

    await client.close();

    console.log("Confirmation email sent successfully to:", booking.email);

    return new Response(
      JSON.stringify({ ok: true, message: "Email sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
