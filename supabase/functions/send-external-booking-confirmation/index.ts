import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  BRAND,
  displayTitle,
  emailShell,
  escapeHtml,
  gap,
  heroModule,
  linkButton,
  numberedList,
  para,
  referenceModule,
  sanitizeForSmtp,
  signature,
  textModule,
} from "../_shared/email-layout.ts";

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
  const firstName = escapeHtml((booking.full_name || "there").split(" ")[0]);
  const formattedDate = booking.event_date ? formatDate(booking.event_date) : "";
  const eventTime = booking.start_time && booking.end_time
    ? `${formatTime(booking.start_time)} to ${formatTime(booking.end_time)}`
    : "All Day";
  const formattedEventType = booking.event_type ? escapeHtml(formatEventType(booking.event_type)) : "";
  const formattedBookingType = booking.booking_type ? formatBookingType(booking.booking_type) : "";
  const reservationNumber = escapeHtml(booking.reservation_number || "");

  const accessCodeUrl = "https://orlandoeventvenue.org/accesscode";

  // Copy is verbatim from the ClickUp spec "OEV POST BOOKING COMMUNICATIONS",
  // section E01. Do not reword — design carries emphasis, never the wording.
  const body =
    heroModule({
      display: displayTitle("Your Orlando Event Venue Booking Is Confirmed", { size: 34 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
      para(`Your booking at Orlando Event Venue is confirmed, and we are looking forward to hosting you.`) +
      para(`Your payment is handled through the company or platform where you reserved, so there is nothing to pay us directly. On our side, we take care of everything about the event itself: your planning, venue access, event day support, closing, and Guest Report.`) +
      para(`About a month out, we will check in on the few details that affect how we prepare the space:`) +
      numberedList([
        `Whether alcohol will be served.`,
        `Any audio and visual needs.`,
        `Any additional services you would like to add.`,
      ]) +
      para(`Everything else is in your hands, so that is all we will ask about.`) +
      para(`The most useful thing to do today is save your Event Page. It is the single place that holds your venue instructions, live door code, Wifi, venue rules, the Before You Leave checklist, and your Guest Report:`) +
      linkButton(accessCodeUrl) +
      para(`Enter your reservation number when prompted. Your live door code appears there one hour before your event begins.`) +
      para(`Questions or changes? Reply here or call 407 974 5979.`) +
      signature(),
    ) +
    gap() +
    referenceModule([
      ["Reservation Number", reservationNumber],
      ["Event Date", formattedDate],
      ["Event Time", eventTime],
      ["Event Type", formattedEventType],
      ["Booking Type", formattedBookingType],
      ["Guest Count", String(booking.number_of_guests ?? "")],
    ]);

  return emailShell({
    title: "Your Orlando Event Venue Booking Is Confirmed",
    preview: "We have your reservation. Here is what happens next.",
    body,
  });
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
    const emailHTML = sanitizeForSmtp(generateE01HTML(booking as ExternalBookingRow));

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
