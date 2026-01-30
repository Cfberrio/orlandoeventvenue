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
  base_rental: number;
  cleaning_fee: number;
  package: string;
  package_cost: number;
  package_start_time?: string;
  package_end_time?: string;
  setup_breakdown: boolean;
  tablecloths: boolean;
  tablecloth_quantity: number;
  optional_services: number;
  taxes_fees: number;
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

function getPackageName(pkg: string): string {
  const names: Record<string, string> = {
    none: "No Package",
    basic: "Basic A/V Package",
    led: "LED Wall Package",
    workshop: "Workshop/Streaming Package",
  };
  return names[pkg] || pkg;
}

function formatBookingType(bookingType: string): string {
  if (bookingType === "daily") return "Full Day (24 hours)";
  if (bookingType === "hourly") return "Hourly";
  return bookingType;
}

function generateEmailHTML(booking: BookingEmailData): string {
  const firstName = booking.full_name.split(" ")[0];
  const formattedDate = formatDate(booking.event_date);
  const formattedBookingType = formatBookingType(booking.booking_type);

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#111827;padding:30px;color:white;">
<h1 style="margin:0;font-size:24px;">Deposit Received</h1>
<p style="margin:10px 0 0;">
Thank you. We will review your request within 24 hours.
</p>
<p style="margin:10px 0 0;font-size:12px;">Reservation ${booking.reservation_number}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;">
Thank you for choosing Orlando Event Venue - we are excited to host you.
</p>

<p style="margin:15px 0;">
We have secured your 50% deposit, and our team will validate the details and confirm everything within 24 hours.
</p>

<p style="margin:20px 0 10px;font-weight:bold;">Quick Reference:</p>
<table width="100%" style="margin:0;">
<tr>
<td style="padding:5px 0;color:#666;">Reservation:</td>
<td style="padding:5px 0;"><strong>${booking.reservation_number}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Type:</td>
<td style="padding:5px 0;"><strong>${booking.event_type}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Date:</td>
<td style="padding:5px 0;"><strong>${formattedDate}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Booking Type:</td>
<td style="padding:5px 0;"><strong>${formattedBookingType}</strong></td>
</tr>
</table>

<p style="margin:20px 0 10px;font-weight:bold;">What happens next:</p>

<p style="margin:10px 0;">
<strong>1) Review and confirmation (24 hours):</strong><br>
We verify timing, capacity, and venue readiness.
</p>

<p style="margin:10px 0;">
<strong>2) Please do not send invites yet:</strong><br>
This prevents confusion if we need to adjust anything.
</p>

<p style="margin:10px 0;">
<strong>3) Remaining balance:</strong><br>
The final 50% is due 15 days before your event. We will send a payment link and reminders.
</p>

<p style="margin:30px 0 10px;border-top:1px solid #ddd;padding-top:20px;">
If you need to update anything, just reply to this email and we will adjust it with you.
</p>

<p style="margin:10px 0 0;">
<strong>Orlando Event Venue Team</strong>
</p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
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
