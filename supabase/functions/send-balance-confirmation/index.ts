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
  base_rental?: number;
  cleaning_fee?: number;
  package?: string;
  package_cost?: number;
  package_start_time?: string;
  package_end_time?: string;
  setup_breakdown?: boolean;
  tablecloths?: boolean;
  tablecloth_quantity?: number;
  optional_services?: number;
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

function getPackageName(pkg: string | undefined): string {
  if (!pkg) return "No Package";
  const names: Record<string, string> = {
    none: "No Package",
    basic: "Basic A/V Package",
    led: "LED Wall Package",
    workshop: "Workshop/Streaming Package",
  };
  return names[pkg] || pkg;
}

function getPackageInclusions(pkg: string | undefined): string[] {
  if (!pkg) return [];
  const inclusions: Record<string, string[]> = {
    basic: ["AV System", "Microphones", "Speakers", "Projectors", "Tech Assistant"],
    led: ["AV System", "Microphones", "Speakers", "Projectors", "Tech Assistant", "Stage LED Wall"],
    workshop: ["AV System", "Microphones", "Speakers", "Projectors", "Tech Assistant", "Stage LED Wall", "Streaming Equipment", "Streaming Tech"],
  };
  return inclusions[pkg] || [];
}

function formatEventType(eventType: string): string {
  return eventType
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function generateEmailHTML(booking: BalanceEmailData): string {
  const firstName = booking.full_name.split(" ")[0];
  const formattedDate = formatDate(booking.event_date);
  const formattedBookingType = formatBookingType(booking.booking_type);
  const timeRange = booking.start_time && booking.end_time 
    ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
    : "All Day";

  const hasPackageData = booking.package !== undefined && booking.package !== null;
  const packageName = getPackageName(booking.package);
  const inclusions = getPackageInclusions(booking.package);
  const packageTimeRange = booking.package_start_time && booking.package_end_time
    ? `${formatTime(booking.package_start_time)} – ${formatTime(booking.package_end_time)}`
    : "";

  const addOnRows: string[] = [];
  if (booking.setup_breakdown) {
    addOnRows.push(`<tr><td style="padding:4px 0;color:#444;">Setup &amp; Breakdown of Chairs/Tables</td><td style="padding:4px 0;text-align:right;">$100.00</td></tr>`);
  }
  if (booking.tablecloths && (booking.tablecloth_quantity ?? 0) > 0) {
    const clothCost = (booking.tablecloth_quantity ?? 0) * 5 + 25;
    addOnRows.push(`<tr><td style="padding:4px 0;color:#444;">Tablecloth Rental (×${booking.tablecloth_quantity})</td><td style="padding:4px 0;text-align:right;">${formatCurrency(clothCost)}</td></tr>`);
  }

  const inclusionRows = inclusions.length > 0
    ? inclusions.map((item) => `<tr><td style="padding:3px 0 3px 15px;color:#444;font-size:14px;">✓ ${item}</td></tr>`).join("")
    : `<tr><td style="padding:3px 0 3px 15px;color:#888;font-size:14px;">Venue space only — no A/V package selected</td></tr>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

<div style="background:#1a1a2e;padding:30px;color:white;text-align:center;">
<h1 style="margin:0;font-size:24px;color:#C6A96C;">Fully Paid — Thank You!</h1>
<p style="margin:10px 0 0;color:#ccc;">Your event is confirmed and fully paid.</p>
<p style="margin:10px 0 0;font-size:13px;color:#C6A96C;">Reservation ${booking.reservation_number}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;">
Thank you for completing your payment! Your booking at Orlando Event Venue is now fully paid and confirmed.
</p>

<!-- PAID IN FULL BADGE -->
<div style="background:#ecfdf5;border:2px solid #059669;padding:20px;text-align:center;margin:20px 0;border-radius:8px;">
<p style="margin:0;font-size:12px;color:#065f46;text-transform:uppercase;letter-spacing:1px;">Balance Payment</p>
<p style="margin:5px 0;font-size:32px;font-weight:bold;color:#059669;">
${formatCurrency(booking.amount_paid)}
</p>
<p style="margin:8px 0 0;font-size:14px;font-weight:bold;color:#059669;background:#d1fae5;display:inline-block;padding:4px 16px;border-radius:20px;">PAID IN FULL</p>
</div>

<!-- EVENT DETAILS -->
<div style="background:#f8f9fa;border-left:4px solid #C6A96C;padding:15px 20px;margin:20px 0;border-radius:0 6px 6px 0;">
<p style="margin:0 0 10px;font-weight:bold;color:#1a1a2e;font-size:15px;">Event Details</p>
<table width="100%" style="margin:0;font-size:14px;">
<tr>
<td style="padding:4px 0;color:#666;width:40%;">Reservation:</td>
<td style="padding:4px 0;"><strong>${booking.reservation_number}</strong></td>
</tr>
<tr>
<td style="padding:4px 0;color:#666;">Event Type:</td>
<td style="padding:4px 0;"><strong>${formatEventType(booking.event_type)}</strong></td>
</tr>
<tr>
<td style="padding:4px 0;color:#666;">Date:</td>
<td style="padding:4px 0;"><strong>${formattedDate}</strong></td>
</tr>
<tr>
<td style="padding:4px 0;color:#666;">Time:</td>
<td style="padding:4px 0;"><strong>${timeRange}</strong></td>
</tr>
<tr>
<td style="padding:4px 0;color:#666;">Booking Type:</td>
<td style="padding:4px 0;"><strong>${formattedBookingType}</strong></td>
</tr>
<tr>
<td style="padding:4px 0;color:#666;">Guests:</td>
<td style="padding:4px 0;"><strong>${booking.number_of_guests}</strong></td>
</tr>
</table>
</div>

${hasPackageData ? `
<!-- PACKAGE DETAILS -->
<div style="background:#f8f9fa;border-left:4px solid #C6A96C;padding:15px 20px;margin:20px 0;border-radius:0 6px 6px 0;">
<p style="margin:0 0 5px;font-weight:bold;color:#1a1a2e;font-size:15px;">Package: ${packageName}</p>
${packageTimeRange ? `<p style="margin:0 0 8px;font-size:13px;color:#666;">Package Hours: ${packageTimeRange}</p>` : ""}
<table width="100%" style="margin:0;">
${inclusionRows}
</table>
</div>
` : ""}

${addOnRows.length > 0 ? `
<!-- ADD-ONS -->
<div style="background:#f8f9fa;border-left:4px solid #C6A96C;padding:15px 20px;margin:20px 0;border-radius:0 6px 6px 0;">
<p style="margin:0 0 10px;font-weight:bold;color:#1a1a2e;font-size:15px;">Add-Ons</p>
<table width="100%" style="margin:0;font-size:14px;">
${addOnRows.join("")}
</table>
</div>
` : ""}

<!-- COST BREAKDOWN -->
<div style="border:2px solid #1a1a2e;padding:20px;margin:20px 0;border-radius:6px;">
<p style="margin:0 0 12px;font-weight:bold;color:#1a1a2e;font-size:15px;">Cost Breakdown</p>
<table width="100%" style="margin:0;font-size:14px;">
${(booking.base_rental ?? 0) > 0 ? `
<tr>
<td style="padding:4px 0;color:#444;">Base Rental</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.base_rental!)}</td>
</tr>` : ""}
${(booking.cleaning_fee ?? 0) > 0 ? `
<tr>
<td style="padding:4px 0;color:#444;">Cleaning Fee</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.cleaning_fee!)}</td>
</tr>` : ""}
${(booking.package_cost ?? 0) > 0 ? `
<tr>
<td style="padding:4px 0;color:#444;">${packageName}</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.package_cost!)}</td>
</tr>` : ""}
${(booking.optional_services ?? 0) > 0 ? `
<tr>
<td style="padding:4px 0;color:#444;">Optional Services</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.optional_services!)}</td>
</tr>` : ""}
<tr style="border-top:2px solid #1a1a2e;">
<td style="padding:10px 0 4px;font-weight:bold;font-size:16px;color:#1a1a2e;">Total</td>
<td style="padding:10px 0 4px;text-align:right;font-weight:bold;font-size:16px;color:#1a1a2e;">${formatCurrency(booking.total_amount)}</td>
</tr>
<tr>
<td style="padding:4px 0;color:#059669;">Deposit Paid</td>
<td style="padding:4px 0;text-align:right;color:#059669;font-weight:bold;">${formatCurrency(booking.deposit_amount)}</td>
</tr>
<tr>
<td style="padding:4px 0;color:#059669;">Balance Paid</td>
<td style="padding:4px 0;text-align:right;color:#059669;font-weight:bold;">${formatCurrency(booking.balance_amount)}</td>
</tr>
<tr style="border-top:1px solid #ddd;">
<td style="padding:8px 0 0;font-weight:bold;color:#059669;">Payment Status</td>
<td style="padding:8px 0 0;text-align:right;font-weight:bold;color:#059669;">Fully Paid</td>
</tr>
</table>
</div>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;">
We are all set for your event! If you need to adjust anything or have questions, feel free to reply to this email.
</p>

<p style="margin:10px 0 0;">
Looking forward to hosting you!<br>
<strong>Orlando Event Venue Team</strong>
</p>

</div>

<div style="padding:20px 30px;background:#1a1a2e;font-size:11px;color:#999;">
<p style="margin:0;color:#C6A96C;font-weight:bold;">Orlando Event Venue Team</p>
<p style="margin:5px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">Orlandoeventvenue@gmail.com</p>
<p style="margin:5px 0 0;">(407) 974-5979</p>
<p style="margin:8px 0 0;">This is an automated email — please keep it for your records.</p>
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
