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

function generateEmailHTML(booking: BookingEmailData): string {
  const year = new Date().getFullYear();
  
  // Build time info row
  let timeInfo = "";
  if (booking.booking_type === "hourly") {
    timeInfo = `
      <tr>
        <td style="padding:10px 0;color:#64748b;font-size:14px;">Event Time</td>
        <td style="padding:10px 0;color:#1e293b;font-size:14px;font-weight:600;text-align:right;">
          ${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}
        </td>
      </tr>`;
  } else {
    timeInfo = `
      <tr>
        <td style="padding:10px 0;color:#64748b;font-size:14px;">Rental Type</td>
        <td style="padding:10px 0;color:#1e293b;font-size:14px;font-weight:600;text-align:right;">
          Full Day (24 hours)
        </td>
      </tr>`;
  }

  // Build package row if selected
  let packageRow = "";
  if (booking.package && booking.package !== "none") {
    let packageTime = "";
    if (booking.package_start_time && booking.package_end_time) {
      packageTime = ` (${formatTime(booking.package_start_time)} - ${formatTime(booking.package_end_time)})`;
    }
    packageRow = `
      <tr>
        <td style="padding:8px 0;color:#475569;font-size:14px;">
          ${getPackageName(booking.package)}${packageTime}
        </td>
        <td style="padding:8px 0;color:#1e293b;font-size:14px;text-align:right;">
          ${formatCurrency(booking.package_cost)}
        </td>
      </tr>`;
  }

  // Build optional services rows
  let optionalRows = "";
  if (booking.setup_breakdown) {
    optionalRows += `
      <tr>
        <td style="padding:8px 0;color:#475569;font-size:14px;">
          Setup &amp; Breakdown Service
        </td>
        <td style="padding:8px 0;color:#1e293b;font-size:14px;text-align:right;">
          $100.00
        </td>
      </tr>`;
  }
  if (booking.tablecloths && booking.tablecloth_quantity > 0) {
    const tableclothCost = (booking.tablecloth_quantity * 5) + 25;
    optionalRows += `
      <tr>
        <td style="padding:8px 0;color:#475569;font-size:14px;">
          Tablecloths (${booking.tablecloth_quantity}x) + Cleaning
        </td>
        <td style="padding:8px 0;color:#1e293b;font-size:14px;text-align:right;">
          ${formatCurrency(tableclothCost)}
        </td>
      </tr>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Booking Confirmation</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:40px 20px;">
<tr>
<td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">

<!-- Header -->
<tr>
<td style="background-color:#0f172a;padding:32px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;">
Orlando Event Venue
</h1>
<p style="color:#94a3b8;margin:8px 0 0 0;font-size:14px;">
Your Premier Event Space
</p>
</td>
</tr>

<!-- Success Icon -->
<tr>
<td style="padding:32px 32px 16px;text-align:center;">
<div style="width:64px;height:64px;background-color:#dcfce7;border-radius:50%;margin:0 auto;line-height:64px;">
<span style="color:#16a34a;font-size:32px;">&#10003;</span>
</div>
<h2 style="color:#16a34a;margin:16px 0 0 0;font-size:22px;font-weight:700;">
Booking Confirmed!
</h2>
<p style="color:#64748b;margin:8px 0 0 0;font-size:14px;">
Your deposit has been successfully processed
</p>
</td>
</tr>

<!-- Reservation Number -->
<tr>
<td style="padding:16px 32px 32px;text-align:center;">
<p style="color:#64748b;margin:0 0 8px 0;font-size:13px;text-transform:uppercase;letter-spacing:1px;">
Reservation Number
</p>
<div style="background-color:#f8fafc;border:2px dashed #cbd5e1;border-radius:8px;padding:16px;">
<span style="color:#0f172a;font-size:28px;font-weight:700;letter-spacing:2px;">
${booking.reservation_number}
</span>
</div>
<p style="color:#94a3b8;margin:12px 0 0 0;font-size:12px;">
Please save this number for your records
</p>
</td>
</tr>

<!-- Greeting -->
<tr>
<td style="padding:0 32px 24px;">
<p style="color:#1e293b;margin:0;font-size:15px;">
Dear <strong>${booking.full_name}</strong>,
</p>
<p style="color:#64748b;margin:12px 0 0 0;font-size:14px;line-height:1.6;">
Thank you for choosing Orlando Event Venue! We are excited to host your upcoming event.
</p>
</td>
</tr>

<!-- Event Details -->
<tr>
<td style="padding:0 32px 24px;">
<h3 style="color:#0f172a;margin:0 0 16px 0;font-size:16px;font-weight:700;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
Event Details
</h3>
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:10px 0;color:#64748b;font-size:14px;">Event Date</td>
<td style="padding:10px 0;color:#1e293b;font-size:14px;font-weight:600;text-align:right;">
${formatDate(booking.event_date)}
</td>
</tr>
${timeInfo}
<tr>
<td style="padding:10px 0;color:#64748b;font-size:14px;">Event Type</td>
<td style="padding:10px 0;color:#1e293b;font-size:14px;font-weight:600;text-align:right;">
${booking.event_type}
</td>
</tr>
<tr>
<td style="padding:10px 0;color:#64748b;font-size:14px;">Number of Guests</td>
<td style="padding:10px 0;color:#1e293b;font-size:14px;font-weight:600;text-align:right;">
${booking.number_of_guests}
</td>
</tr>
</table>
</td>
</tr>

<!-- Price Breakdown -->
<tr>
<td style="padding:0 32px 24px;">
<h3 style="color:#0f172a;margin:0 0 16px 0;font-size:16px;font-weight:700;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
Price Breakdown
</h3>
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:8px 0;color:#475569;font-size:14px;">
${booking.booking_type === "daily" ? "Daily Rental (24 hours)" : "Venue Rental"}
</td>
<td style="padding:8px 0;color:#1e293b;font-size:14px;text-align:right;">
${formatCurrency(booking.base_rental)}
</td>
</tr>
<tr>
<td style="padding:8px 0;color:#475569;font-size:14px;">
Cleaning Fee
</td>
<td style="padding:8px 0;color:#1e293b;font-size:14px;text-align:right;">
${formatCurrency(booking.cleaning_fee)}
</td>
</tr>
${packageRow}
${optionalRows}
${booking.taxes_fees > 0 ? `
<tr>
<td style="padding:8px 0;color:#475569;font-size:14px;">
Taxes &amp; Fees
</td>
<td style="padding:8px 0;color:#1e293b;font-size:14px;text-align:right;">
${formatCurrency(booking.taxes_fees)}
</td>
</tr>` : ""}
<tr>
<td colspan="2" style="padding:12px 0 0 0;border-top:1px solid #e2e8f0;"></td>
</tr>
<tr>
<td style="padding:8px 0;color:#0f172a;font-size:15px;font-weight:700;">
Total Amount
</td>
<td style="padding:8px 0;color:#0f172a;font-size:15px;font-weight:700;text-align:right;">
${formatCurrency(booking.total_amount)}
</td>
</tr>
</table>
</td>
</tr>

<!-- Payment Summary -->
<tr>
<td style="padding:0 32px 24px;">
<div style="background-color:#f0fdf4;border-radius:8px;padding:16px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:6px 0;color:#166534;font-size:14px;font-weight:600;">
Deposit Paid
</td>
<td style="padding:6px 0;color:#166534;font-size:16px;font-weight:700;text-align:right;">
${formatCurrency(booking.deposit_amount)}
</td>
</tr>
</table>
</div>
<div style="background-color:#fef3c7;border-radius:8px;padding:16px;margin-top:12px;">
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:6px 0;color:#92400e;font-size:14px;font-weight:600;">
Balance Due
</td>
<td style="padding:6px 0;color:#92400e;font-size:16px;font-weight:700;text-align:right;">
${formatCurrency(booking.balance_amount)}
</td>
</tr>
</table>
<p style="color:#a16207;margin:8px 0 0 0;font-size:12px;">
Due 15 days before your event date
</p>
</div>
</td>
</tr>

<!-- Next Steps -->
<tr>
<td style="padding:0 32px 32px;">
<h3 style="color:#0f172a;margin:0 0 16px 0;font-size:16px;font-weight:700;border-bottom:2px solid #e2e8f0;padding-bottom:8px;">
What Happens Next?
</h3>
<table width="100%" cellpadding="0" cellspacing="0">
<tr>
<td style="padding:8px 0;color:#475569;font-size:14px;line-height:1.5;">
1. Our team will review and confirm your booking
</td>
</tr>
<tr>
<td style="padding:8px 0;color:#475569;font-size:14px;line-height:1.5;">
2. You will receive a reminder before your event
</td>
</tr>
<tr>
<td style="padding:8px 0;color:#475569;font-size:14px;line-height:1.5;">
3. Remaining balance collected 15 days before event
</td>
</tr>
<tr>
<td style="padding:8px 0;color:#475569;font-size:14px;line-height:1.5;">
4. Contact us for any questions or special requests
</td>
</tr>
</table>
</td>
</tr>

<!-- Contact -->
<tr>
<td style="background-color:#f8fafc;padding:24px 32px;text-align:center;">
<p style="color:#64748b;margin:0 0 4px 0;font-size:13px;">
Questions? Contact us at
</p>
<a href="mailto:info@orlandoeventvenue.com" style="color:#0f172a;font-size:15px;font-weight:600;text-decoration:none;">
info@orlandoeventvenue.com
</a>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="background-color:#0f172a;padding:24px 32px;text-align:center;">
<p style="color:#94a3b8;margin:0;font-size:12px;">
${year} Orlando Event Venue. All rights reserved.
</p>
<p style="color:#64748b;margin:8px 0 0 0;font-size:11px;">
This is an automated confirmation email.
</p>
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
