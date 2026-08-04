import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExternalBookingRow {
  id: string;
  booking_origin: string | null;
  reservation_number: string | null;
  full_name: string | null;
  email: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  event_type: string | null;
  booking_type: string | null;
  number_of_guests: number | null;
  status: string | null;
}

function formatDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC",
  });
}

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${String(minutes).padStart(2, "0")} ${period}`;
}

function formatEventType(eventType: string): string {
  return eventType
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatBookingType(bookingType: string): string {
  return bookingType === "daily" ? "Full Day" : "Hourly";
}

function generateE01HTML(booking: ExternalBookingRow): string {
  // full_name for externals is "Real Name - External": first word = real first name
  const firstName = (booking.full_name || "there").split(" ")[0];
  const formattedDate = booking.event_date ? formatDate(booking.event_date) : "";
  const eventTime = booking.start_time && booking.end_time
    ? `${formatTime(booking.start_time)} to ${formatTime(booking.end_time)}`
    : "All Day";
  const formattedEventType = booking.event_type ? formatEventType(booking.event_type) : "";
  const formattedBookingType = booking.booking_type ? formatBookingType(booking.booking_type) : "";

  const detailRow = (label: string, value: string) => `
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">${label}</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${value}</span>
            </td>
          </tr>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your Orlando Event Venue Booking Is Confirmed</title>
  <meta name="description" content="We have your reservation. Here is what happens next.">
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:0;mso-hide:all;">
    We have your reservation. Here is what happens next.
  </div>
  <div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);">
    <div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">
      <h1 style="margin:0;font-size:24px;letter-spacing:.2px;line-height:1.25;">
        Booking <span style="color:#14ADE6;">Confirmed</span>
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
        Your booking at Orlando Event Venue is confirmed, and we are looking forward to hosting you.
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        Your payment is handled through the company or platform where you reserved, so there is nothing to pay us directly. On our side, we take care of everything about the event itself: your planning, venue access, event day support, closing, and Guest Report.
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        About a month out, we will check in on the few details that affect how we prepare the space:
      </p>
      <ul style="margin:8px 0 0;padding-left:22px;font-size:15px;line-height:1.65;color:#374151;">
        <li>Whether alcohol will be served.</li>
        <li>Any audio and visual needs.</li>
        <li>Any additional services you would like to add.</li>
      </ul>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        Everything else is in your hands, so that is all we will ask about.
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        The most useful thing to do today is save your Event Page. It is the single place that holds your venue instructions, live door code, Wifi, venue rules, the Before You Leave checklist, and your Guest Report:
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;">
        <a href="https://orlandoeventvenue.org/accesscode" style="color:#14ADE6;font-weight:bold;">orlandoeventvenue.org/accesscode</a>
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        Enter your reservation number when prompted. Your live door code appears there one hour before your event begins.
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        Questions or changes? Reply here or call 407 974 5979.
      </p>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">
        Luis and the Orlando Event Venue Team<br>
        <strong>407 974 5979</strong><br>
        orlandoeventvenue@gmail.com
      </p>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:18px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          For Reference
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          ${detailRow("Reservation Number", booking.reservation_number || "")}
          ${detailRow("Event Date", formattedDate)}
          ${detailRow("Event Time", eventTime)}
          ${detailRow("Event Type", formattedEventType)}
          ${detailRow("Booking Type", formattedBookingType)}
          ${detailRow("Guest Count", String(booking.number_of_guests ?? ""))}
        </table>
      </div>
    </div>
    <div style="padding:18px 26px;background:#F9FAFB;font-size:11px;color:#6B7280;border-top:1px solid #E5E7EB;">
      <p style="margin:0;font-weight:bold;color:#111827;">Orlando Event Venue Team</p>
      <p style="margin:6px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p>
      <p style="margin:6px 0 0;">orlandoeventvenue@gmail.com</p>
      <p style="margin:6px 0 0;">(407) 974-5979</p>
      <p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p>
    </div>
  </div>
</body>
</html>`;
}

/**
 * E01 — Booking Confirmed (external bookings only).
 * Sent exactly once, when the admin completes the external booking wizard.
 * Idempotent via the external_confirmation_sent booking event: retries and
 * accidental double-invokes never email the client twice.
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, booking_origin, reservation_number, full_name, email, event_date, start_time, end_time, event_type, booking_type, number_of_guests, status")
      .eq("id", booking_id)
      .maybeSingle();

    if (bookingError || !booking) {
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (booking.booking_origin !== "external") {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "not_external" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!booking.email) {
      return new Response(
        JSON.stringify({ ok: false, error: "Booking has no email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency: one E01 per booking, ever
    const { data: alreadySent } = await supabase
      .from("booking_events")
      .select("id")
      .eq("booking_id", booking_id)
      .eq("event_type", "external_confirmation_sent")
      .limit(1);

    if (alreadySent && alreadySent.length > 0) {
      console.log(`E01 already sent for ${booking.reservation_number}, skipping`);
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "already_sent" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailPassword) {
      return new Response(
        JSON.stringify({ ok: false, error: "Gmail credentials not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: { username: gmailUser, password: gmailPassword },
      },
    });

    // Strip trailing whitespace per line: denomailer's quoted-printable encoder
    // renders whitespace-only lines as a literal "=20" in the email body.
    const emailHTML = generateE01HTML(booking as ExternalBookingRow)
      .split("\n")
      .map((line) => line.replace(/[ \t]+$/, ""))
      .join("\n");

    await client.send({
      from: gmailUser,
      to: booking.email,
      subject: "Your Orlando Event Venue Booking Is Confirmed",
      content: "We have your reservation. Here is what happens next. Please view this email in an HTML-compatible email client.",
      html: emailHTML,
    });

    await client.close();

    await supabase.from("booking_events").insert({
      booking_id,
      event_type: "external_confirmation_sent",
      channel: "email",
      metadata: {
        template: "E01",
        to: booking.email,
        subject: "Your Orlando Event Venue Booking Is Confirmed",
        sent_at: new Date().toISOString(),
      },
    });

    console.log(`E01 sent to ${booking.email} for ${booking.reservation_number}`);

    return new Response(
      JSON.stringify({ ok: true, booking_id, reservation_number: booking.reservation_number }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in send-external-booking-confirmation:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
