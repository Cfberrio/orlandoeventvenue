import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BalanceEmailData {
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
  amount_paid: number;
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

function formatTime(timeString: string | undefined | null): string {
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

function formatBookingType(bookingType: string): string {
  if (bookingType === "daily") return "Full Day (24 hours)";
  if (bookingType === "hourly") return "Hourly";
  return bookingType;
}

function generateEmailHTML(booking: BalanceEmailData): string {
  const firstName = booking.full_name.split(" ")[0];
  const formattedDate = formatDate(booking.event_date);
  const formattedBookingType = formatBookingType(booking.booking_type);
  const timeRange = booking.start_time && booking.end_time 
    ? `${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}`
    : "All Day";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Payment Received</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Verdana,Arial,sans-serif;color:#111827;">
    <div style="padding:24px 12px;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 25px rgba(15,23,42,0.08);overflow:hidden;">
        
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#059669,#10b981);padding:24px 32px;color:#ffffff;">
          <div style="font-size:22px;font-weight:700;margin:0 0 6px 0;">
            ✓ Payment Received - Thank You!
          </div>
          <div style="font-size:13px;line-height:1.5;color:#ecfdf5;">
            Your final payment has been received and your booking is now fully paid.
          </div>
          <div style="display:inline-block;margin-top:12px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,0.2);color:#ffffff;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">
            Reservation #${booking.reservation_number}
          </div>
        </div>

        <!-- Body -->
        <div style="padding:24px 32px 28px 32px;">
          <p style="margin:0 0 10px 0;font-size:16px;">
            Hi <strong>${firstName}</strong>,
          </p>
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.7;color:#374151;">
            Thank you for completing your payment! Your booking at <strong>Orlando Event Venue</strong> is now <strong>fully paid</strong> and confirmed.
          </p>

          <!-- Amount Paid Box -->
          <div style="background:#ecfdf5;border:2px solid #10b981;border-radius:10px;padding:20px;text-align:center;margin:0 0 20px 0;">
            <div style="font-size:13px;color:#065f46;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px 0;font-weight:600;">
              Amount Paid
            </div>
            <div style="font-size:32px;font-weight:700;color:#059669;margin:0;">
              ${formatCurrency(booking.amount_paid)}
            </div>
            <div style="font-size:12px;color:#059669;margin:4px 0 0 0;">
              Balance (Remaining 50%)
            </div>
          </div>

          <!-- Event Details -->
          <div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:10px;padding:16px 18px;margin:0 0 18px 0;">
            <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin:0 0 10px 0;">
              Your Event Details
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Reservation #:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${booking.reservation_number}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Event Date:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Event Time:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${timeRange}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Booking Type:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${formattedBookingType}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Number of Guests:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${booking.number_of_guests}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Event Type:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${booking.event_type}</td>
              </tr>
            </table>
          </div>

          <!-- Payment Summary -->
          <div style="border:1px solid #e5e7eb;background:#ffffff;border-radius:10px;padding:16px 18px;margin:0 0 18px 0;">
            <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin:0 0 10px 0;">
              Payment Summary
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="width:50%;font-size:13px;color:#6b7280;padding:6px 0;">Total Amount:</td>
                <td style="width:50%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;text-align:right;">${formatCurrency(booking.total_amount)}</td>
              </tr>
              <tr>
                <td style="width:50%;font-size:13px;color:#6b7280;padding:6px 0;">Deposit (paid):</td>
                <td style="width:50%;font-size:13px;color:#059669;font-weight:600;padding:6px 0;text-align:right;">${formatCurrency(booking.deposit_amount)}</td>
              </tr>
              <tr>
                <td style="width:50%;font-size:13px;color:#6b7280;padding:6px 0;">Balance (paid):</td>
                <td style="width:50%;font-size:13px;color:#059669;font-weight:600;padding:6px 0;text-align:right;">${formatCurrency(booking.balance_amount)}</td>
              </tr>
              <tr style="border-top:1px solid #e5e7eb;">
                <td style="width:50%;font-size:14px;color:#111827;font-weight:700;padding:10px 0 0 0;">Payment Status:</td>
                <td style="width:50%;font-size:14px;color:#059669;font-weight:700;padding:10px 0 0 0;text-align:right;">Fully Paid ✓</td>
              </tr>
            </table>
          </div>

          <div style="border-top:1px solid #e5e7eb;margin:18px 0;"></div>

          <p style="margin:0 0 10px 0;font-size:14px;line-height:1.7;color:#374151;">
            We're all set for your event! If you need to adjust anything or have questions, feel free to reply to this email.
          </p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;">
            Looking forward to hosting you!<br>
            — <strong>Orlando Event Venue Team</strong>
          </p>
        </div>

        <!-- Footer -->
        <div style="padding:0 32px 24px 32px;font-size:11px;line-height:1.6;color:#9ca3af;">
          Questions? Contact us at orlandoglobalministries@gmail.com<br>
          Orlando Event Venue · 3847 E Colonial Dr, Orlando, FL 32803<br />
          This is an automated email — please keep it for your records.
        </div>
      </div>
    </div>
  </body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const booking: BalanceEmailData = await req.json();
    console.log("Sending balance confirmation email for booking:", booking.reservation_number);

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
      subject: `Payment Received - ${booking.reservation_number} | Orlando Event Venue`,
      content: "Your payment has been received. Please view this email in an HTML-compatible email client.",
      html: emailHTML,
    });

    await client.close();

    console.log("Balance confirmation email sent successfully to:", booking.email);

    return new Response(
      JSON.stringify({ ok: true, message: "Balance confirmation email sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending balance confirmation email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
