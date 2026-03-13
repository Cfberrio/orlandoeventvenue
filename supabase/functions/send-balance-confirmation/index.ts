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

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Final Payment Received | Orlando Event Venue</title>
  <meta name="description" content="Your booking is now fully paid and confirmed.">
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:0;mso-hide:all;">
    Your booking is now fully paid and confirmed.
  </div>
  <div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);">
    <div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">
      <h1 style="margin:0;font-size:24px;letter-spacing:.2px;line-height:1.25;">
        Final Payment <span style="color:#14ADE6;">Received</span>
      </h1>
      <p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">
        Orlando Event Venue
      </p>
    </div>
    <div style="padding:28px;">
      <p style="margin:0;font-size:16px;">
        Hi <strong>${firstName}</strong>,
      </p>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        Thank you for completing your final payment.
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        Your booking at Orlando Event Venue is now <strong>fully paid and confirmed</strong>.
      </p>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:18px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Payment Received
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:10px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Amount Paid</span><br>
              <span style="font-size:18px;color:#0B0F19;font-weight:800;">${formatCurrency(booking.amount_paid)}</span>
            </td>
          </tr>
        </table>
      </div>
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Event Details
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Reservation #</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${booking.reservation_number}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Event Date</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${formattedDate}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Event Time</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${timeRange}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Booking Type</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${formattedBookingType}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Guests</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${booking.number_of_guests}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Event Type</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${formatEventType(booking.event_type)}</span>
            </td>
          </tr>
        </table>
      </div>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Payment Summary
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Total Amount</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${formatCurrency(booking.total_amount)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Deposit Paid</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${formatCurrency(booking.deposit_amount)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Balance Paid</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${formatCurrency(booking.balance_amount)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">Status</span><br>
              <span style="display:inline-block;margin-top:6px;font-size:12px;font-weight:800;padding:6px 10px;border-radius:999px;background:rgba(20,173,230,.10);color:#14ADE6;border:1px solid rgba(20,173,230,.25);">
                Fully Paid
              </span>
            </td>
          </tr>
        </table>
      </div>
      <p style="margin:16px 0 0;font-size:14px;line-height:1.6;color:#374151;">
        If you need to update anything before your event, simply reply to this email.
      </p>
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
      <p style="margin:10px 0 0;">Please keep this email for your records.</p>
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
      subject: `Final Payment Received | Orlando Event Venue`,
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
