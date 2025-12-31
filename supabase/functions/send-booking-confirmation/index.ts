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

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Deposit Received</title>
  </head>
  <body style="margin:0;padding:0;background:#f3f4f6;font-family:Verdana,Arial,sans-serif;color:#111827;">
    <!-- Outer wrapper -->
    <div style="padding:24px 12px;">
      <!-- Card -->
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 10px 25px rgba(15,23,42,0.08);overflow:hidden;">
        
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#111827,#1f2937);padding:24px 32px;color:#ffffff;">
          <div style="font-size:22px;font-weight:700;margin:0 0 6px 0;">
            Deposit Received
          </div>
          <div style="font-size:13px;line-height:1.5;color:#e5e7eb;">
            Deposit received — thank you. We've secured it and our team will review your request within ~24 hours.
          </div>
          <div style="display:inline-block;margin-top:12px;padding:4px 10px;border-radius:999px;background:#16a34a;color:#dcfce7;font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600;">
            Reservation #${booking.reservation_number}
          </div>
        </div>

        <!-- Body -->
        <div style="padding:24px 32px 28px 32px;">
          <p style="margin:0 0 10px 0;font-size:16px;">
            Hi <strong>${firstName}</strong>,
          </p>
          <p style="margin:0 0 10px 0;font-size:14px;line-height:1.7;color:#374151;">
            Thank you for choosing <strong>Orlando Event Venue</strong> — we're genuinely excited to host you.
          </p>
          <p style="margin:0 0 16px 0;font-size:14px;line-height:1.7;color:#374151;">
            We've secured your <strong>50% deposit</strong>, and our team will carefully validate the details and confirm everything within
            <strong>~24 hours</strong>.
          </p>

          <!-- Quick reference box -->
          <div style="border:1px solid #e5e7eb;background:#f9fafb;border-radius:10px;padding:16px 18px;margin:0 0 18px 0;">
            <div style="font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin:0 0 10px 0;">
              Quick reference (for your records)
            </div>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Reservation #:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${booking.reservation_number}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Event Type:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${booking.event_type}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Event Date:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${formattedDate}</td>
              </tr>
              <tr>
                <td style="width:42%;font-size:13px;color:#6b7280;padding:6px 0;">Booking Type:</td>
                <td style="width:58%;font-size:13px;color:#111827;font-weight:600;padding:6px 0;">${formattedBookingType}</td>
              </tr>
            </table>
          </div>

          <div style="margin:0 0 10px 0;font-size:14px;font-weight:700;color:#111827;">
            What happens next (and why):
          </div>
          <div style="margin:0 0 18px 0;">
            <div style="padding:8px 0;font-size:14px;line-height:1.7;color:#374151;">
              <strong>1) Review &amp; soft confirmation (~24 hours):</strong>
              We verify timing, capacity, and venue readiness so your confirmation is solid and accurate.
            </div>
            <div style="padding:8px 0;font-size:14px;line-height:1.7;color:#374151;">
              <strong>2) Please don't send invites yet:</strong>
              This prevents confusion if we need to adjust anything during review.
            </div>
            <div style="padding:8px 0;font-size:14px;line-height:1.7;color:#374151;">
              <strong>3) Remaining balance:</strong>
              The final 50% is due <strong>15 days before your event</strong> — we'll send a secure payment link and reminders so you don't have to track it.
            </div>
          </div>

          <div style="border-top:1px solid #e5e7eb;margin:18px 0;"></div>

          <p style="margin:0 0 10px 0;font-size:14px;line-height:1.7;color:#374151;">
            If you'd like to update anything (guest count, timing, details), just reply to this email and we'll adjust it with you.
          </p>
          <p style="margin:0;font-size:14px;line-height:1.7;color:#374151;">
            — <strong>Orlando Event Venue Team</strong>
          </p>
        </div>

        <!-- Footer -->
        <div style="padding:0 32px 24px 32px;font-size:11px;line-height:1.6;color:#9ca3af;">
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
