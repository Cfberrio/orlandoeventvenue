import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

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
async function logCriticalError(bookingId: string, functionName: string, error: Error): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

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

function getPackageInclusions(pkg: string): string[] {
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

function generateEmailHTML(booking: BookingEmailData): string {
  const firstName = booking.full_name.split(" ")[0];
  const formattedDate = formatDate(booking.event_date);
  const formattedBookingType = formatBookingType(booking.booking_type);
  const packageName = getPackageName(booking.package);
  const inclusions = getPackageInclusions(booking.package);
  const timeRange = booking.start_time && booking.end_time
    ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
    : "All Day";
  const packageTimeRange = booking.package_start_time && booking.package_end_time
    ? `${formatTime(booking.package_start_time)} – ${formatTime(booking.package_end_time)}`
    : "";

  const inclusionRows = inclusions.length > 0
    ? inclusions.map((item) => `<tr><td style="padding:3px 0 3px 15px;color:#444;font-size:14px;">✓ ${item}</td></tr>`).join("")
    : `<tr><td style="padding:3px 0 3px 15px;color:#888;font-size:14px;">Venue space only — no A/V package selected</td></tr>`;

  const addOnRows: string[] = [];
  if (booking.setup_breakdown) {
    addOnRows.push(`<tr><td style="padding:4px 0;color:#444;">Setup &amp; Breakdown of Chairs/Tables</td><td style="padding:4px 0;text-align:right;">$100.00</td></tr>`);
  }
  if (booking.tablecloths && booking.tablecloth_quantity > 0) {
    const clothCost = booking.tablecloth_quantity * 5 + 25;
    addOnRows.push(`<tr><td style="padding:4px 0;color:#444;">Tablecloth Rental (×${booking.tablecloth_quantity})</td><td style="padding:4px 0;text-align:right;">${formatCurrency(clothCost)}</td></tr>`);
  }

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

<div style="background:#1a1a2e;padding:30px;color:white;text-align:center;">
<h1 style="margin:0;font-size:24px;color:#C6A96C;">Deposit Received</h1>
<p style="margin:10px 0 0;color:#ccc;">
Thank you. We will review your request within 24 hours.
</p>
<p style="margin:10px 0 0;font-size:13px;color:#C6A96C;">Reservation ${booking.reservation_number}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;">
Thank you for choosing Orlando Event Venue — we are excited to host you.
We have secured your 50% deposit, and our team will confirm everything within 24 hours.
</p>

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

<!-- PACKAGE DETAILS -->
<div style="background:#f8f9fa;border-left:4px solid #C6A96C;padding:15px 20px;margin:20px 0;border-radius:0 6px 6px 0;">
<p style="margin:0 0 5px;font-weight:bold;color:#1a1a2e;font-size:15px;">Package: ${packageName}</p>
${packageTimeRange ? `<p style="margin:0 0 8px;font-size:13px;color:#666;">Package Hours: ${packageTimeRange}</p>` : ""}
<table width="100%" style="margin:0;">
${inclusionRows}
</table>
</div>

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
<tr>
<td style="padding:4px 0;color:#444;">Base Rental</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.base_rental)}</td>
</tr>
<tr>
<td style="padding:4px 0;color:#444;">Cleaning Fee</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.cleaning_fee)}</td>
</tr>
${booking.package_cost > 0 ? `
<tr>
<td style="padding:4px 0;color:#444;">${packageName}</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.package_cost)}</td>
</tr>` : ""}
${booking.optional_services > 0 ? `
<tr>
<td style="padding:4px 0;color:#444;">Optional Services</td>
<td style="padding:4px 0;text-align:right;">${formatCurrency(booking.optional_services)}</td>
</tr>` : ""}
<tr style="border-top:2px solid #1a1a2e;">
<td style="padding:10px 0 4px;font-weight:bold;font-size:16px;color:#1a1a2e;">Total</td>
<td style="padding:10px 0 4px;text-align:right;font-weight:bold;font-size:16px;color:#1a1a2e;">${formatCurrency(booking.total_amount)}</td>
</tr>
<tr>
<td style="padding:4px 0;color:#059669;">Deposit Paid (50%)</td>
<td style="padding:4px 0;text-align:right;color:#059669;font-weight:bold;">${formatCurrency(booking.deposit_amount)}</td>
</tr>
<tr>
<td style="padding:4px 0;color:#b45309;">Balance Remaining</td>
<td style="padding:4px 0;text-align:right;color:#b45309;font-weight:bold;">${formatCurrency(booking.balance_amount)}</td>
</tr>
</table>
</div>

<!-- NEXT STEPS -->
<p style="margin:20px 0 10px;font-weight:bold;color:#1a1a2e;">What happens next:</p>

<p style="margin:8px 0;font-size:14px;">
<strong>1) Review &amp; confirmation (24 hours):</strong><br>
We verify timing, capacity, and venue readiness.
</p>

<p style="margin:8px 0;font-size:14px;">
<strong>2) Please do not send invites yet:</strong><br>
This prevents confusion if we need to adjust anything.
</p>

<p style="margin:8px 0;font-size:14px;">
<strong>3) Remaining balance:</strong><br>
The final 50% is due 15 days before your event. We will send a payment link and reminders.
</p>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;">
If you need to update anything, just reply to this email and we will adjust it with you.
</p>

<p style="margin:10px 0 0;">
<strong>Orlando Event Venue Team</strong>
</p>

</div>

<div style="padding:20px 30px;background:#1a1a2e;font-size:11px;color:#999;">
<p style="margin:0;color:#C6A96C;">Orlando Event Venue</p>
<p style="margin:5px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email — please keep it for your records.</p>
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
    
    // Send critical alert for customer-facing email failure
    const booking: BookingEmailData = await req.clone().json().catch(() => ({}));
    if (booking.reservation_number) {
      const err = error instanceof Error ? error : new Error(errorMessage);
      await sendCriticalAlert("send-booking-confirmation", booking.reservation_number, errorMessage);
      // Note: Can't log to booking_events without booking_id
    }
    
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
