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

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#059669;padding:30px;color:white;">
<h1 style="margin:0;font-size:24px;">Payment Received - Thank You</h1>
<p style="margin:10px 0 0;">Your final payment has been received.</p>
<p style="margin:10px 0 0;font-size:12px;">Reservation ${booking.reservation_number}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;">
Thank you for completing your payment! Your booking at Orlando Event Venue is now fully paid and confirmed.
</p>

<div style="background:#ecfdf5;border:2px solid #10b981;padding:20px;text-align:center;margin:20px 0;">
<p style="margin:0;font-size:12px;color:#065f46;">AMOUNT PAID</p>
<p style="margin:5px 0;font-size:32px;font-weight:bold;color:#059669;">
${formatCurrency(booking.amount_paid)}
</p>
<p style="margin:5px 0 0;font-size:12px;color:#059669;">Balance Payment</p>
</div>

<p style="margin:20px 0 10px;font-weight:bold;">Event Details:</p>
<table width="100%" style="margin:0;">
<tr>
<td style="padding:5px 0;color:#666;">Reservation:</td>
<td style="padding:5px 0;"><strong>${booking.reservation_number}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Date:</td>
<td style="padding:5px 0;"><strong>${formattedDate}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Time:</td>
<td style="padding:5px 0;"><strong>${timeRange}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Booking Type:</td>
<td style="padding:5px 0;"><strong>${formattedBookingType}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Guests:</td>
<td style="padding:5px 0;"><strong>${booking.number_of_guests}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Type:</td>
<td style="padding:5px 0;"><strong>${booking.event_type}</strong></td>
</tr>
</table>

<p style="margin:20px 0 10px;font-weight:bold;">Payment Summary:</p>
<table width="100%" style="margin:0;">
<tr>
<td style="padding:5px 0;color:#666;">Total Amount:</td>
<td style="padding:5px 0;text-align:right;"><strong>${formatCurrency(booking.total_amount)}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Deposit (paid):</td>
<td style="padding:5px 0;text-align:right;color:#059669;"><strong>${formatCurrency(booking.deposit_amount)}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Balance (paid):</td>
<td style="padding:5px 0;text-align:right;color:#059669;"><strong>${formatCurrency(booking.balance_amount)}</strong></td>
</tr>
<tr style="border-top:1px solid #ddd;">
<td style="padding:10px 0 0;"><strong>Payment Status:</strong></td>
<td style="padding:10px 0 0;text-align:right;color:#059669;"><strong>Fully Paid</strong></td>
</tr>
</table>

<p style="margin:30px 0 10px;border-top:1px solid #ddd;padding-top:20px;">
We are all set for your event! If you need to adjust anything or have questions, feel free to reply to this email.
</p>

<p style="margin:10px 0 0;">
Looking forward to hosting you!<br>
<strong>Orlando Event Venue Team</strong>
</p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Questions? Contact us at orlandoglobalministries@gmail.com</p>
<p style="margin:5px 0 0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email - please keep it for your records.</p>
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
