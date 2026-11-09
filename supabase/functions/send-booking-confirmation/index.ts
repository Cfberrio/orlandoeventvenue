import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";
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
  signature,
  sanitizeForSmtp,
  textModule,
} from "../_shared/email-layout.ts";
import { resolveReceiptBooking } from "../_shared/billing-server.ts";
import { buildInvoiceModel } from "../_shared/invoice-model.ts";
import { renderInvoicePdf } from "../_shared/invoice-pdf.ts";

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
  // Persisted fee fields — set by create-checkout after Stripe session creation
  processing_fee_pct?: number | null;
  deposit_fee?: number | null;
  deposit_total_charged?: number | null;
  bar_package?: string | null;
  bar_package_label?: string | null;
  bar_guest_count?: number | null;
  bar_subtotal?: number | null;
  bar_rate_per_guest?: number | null;
}

function formatDate(dateString: string): string {
  // Parse date-only strings ("2026-08-15") as a local calendar date so the
  // rendered day never shifts due to UTC parsing in a non-UTC timezone.
  const [y, m, d] = dateString.split("T")[0].split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
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
  const firstName = escapeHtml(booking.full_name.split(" ")[0]);
  const formattedDate = formatDate(booking.event_date);
  const formattedBookingType = formatBookingType(booking.booking_type);
  const formattedEventType = formatEventType(booking.event_type);

  const eventTime = booking.start_time && booking.end_time
    ? `${formatTime(booking.start_time)} to ${formatTime(booking.end_time)}`
    : "All Day";

  // Copy is verbatim from the ClickUp spec "OEV POST BOOKING COMMUNICATIONS",
  // section I01. Do not reword — design carries emphasis, never the wording.
  const body =
    heroModule({
      display: displayTitle("We Received Your First Payment", { size: 34 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
      para(`Thank you. We have received your first fifty percent, and your booking is now with our team for review.`) +
      numberedList([
        `We take a quick look at the timing, guest count, and venue setup to make sure everything about your event will run smoothly, and we will be back in touch within about 24 hours to confirm.`,
        `Until you hear from us, please hold off on sending invitations or making any arrangements you cannot get back. And if anything about your event has changed since you booked, just reply here so we review the right details.`,
        `In the meantime, you can start getting familiar with your Event Page. It is the one place that will hold everything you need as your date gets closer. That includes your planning details, venue instructions, live door code on event day, the Before You Leave checklist, and your Guest Report:`,
      ]) +
      linkButton("https://orlandoeventvenue.org/accesscode") +
      para(`Enter your reservation number when prompted.`) +
      para(`We will reach out the moment your review is complete.`) +
      signature({ phone: true, email: true }),
    ) +
    gap() +
    referenceModule([
      ["Reservation Number", escapeHtml(booking.reservation_number)],
      ["Event Date", formattedDate],
      ["Event Time", eventTime],
      ["Event Type", formattedEventType],
      ["Booking Type", formattedBookingType],
      ["Guest Count", String(booking.number_of_guests)],
    ]);

  return emailShell({
    title: "We Received Your First Payment",
    preview: "Your booking is now being reviewed by our team.",
    body,
    footerNote: "Itemized receipt is attached as PDF.",
  });
}


serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let reservationNumber = "";
  let bookingId: string | undefined;

  try {
    // Recipient, amounts and discount come from the database, never the request.
    const lookup = await resolveReceiptBooking(req, supabase, "deposit");
    if (!lookup.ok) {
      console.warn("[send-booking-confirmation] refused:", lookup.error);
      return new Response(JSON.stringify({ ok: false, error: lookup.error }), {
        status: lookup.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const booking = lookup.booking;
    reservationNumber = booking.reservation_number;
    bookingId = booking.id;
    console.log("Sending confirmation email for booking:", reservationNumber, `(via ${lookup.via})`);

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

    // Fallback only for legacy rows without a persisted fee %.
    let processingFeePct = 3.5;
    const { data: feeRow } = await supabase
      .from("venue_pricing")
      .select("price")
      .eq("item_key", "processing_fee")
      .eq("is_active", true)
      .maybeSingle();
    if (feeRow?.price) processingFeePct = Number(feeRow.price);

    const emailHTML = sanitizeForSmtp(generateEmailHTML(booking as BookingEmailData));

    let pdfBase64: string | null = null;
    try {
      const model = buildInvoiceModel("deposit", booking, lookup.snapshot, processingFeePct);
      const pdfBytes = await renderInvoicePdf(model, booking);
      pdfBase64 = encodeBase64(pdfBytes);
    } catch (pdfErr) {
      console.error("Failed to generate deposit receipt PDF:", pdfErr);
      const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      // Email still sends (without attachment) — alert so the missing invoice is noticed.
      await sendCriticalAlert(
        "send-booking-confirmation (deposit PDF)",
        reservationNumber,
        `Deposit receipt PDF failed to generate: confirmation email sent WITHOUT the invoice attachment. ${pdfMsg}`,
        bookingId,
      );
    }

    await client.send({
      from: gmailUser,
      to: booking.email,
      subject: `We Received Your First Payment`,
      content: "We have received your first fifty percent, and your booking is now with our team for review. Please view this email in an HTML-compatible email client. Itemized receipt attached as PDF.",
      html: emailHTML,
      attachments: pdfBase64
        ? [
            {
              filename: `Invoice-${reservationNumber}.pdf`,
              content: pdfBase64,
              encoding: "base64",
              contentType: "application/pdf",
            },
          ]
        : undefined,
    });

    await client.close();

    console.log("Confirmation email sent successfully for:", reservationNumber);

    return new Response(
      JSON.stringify({ ok: true, message: "Email sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    if (reservationNumber) {
      await sendCriticalAlert("send-booking-confirmation", reservationNumber, errorMessage, bookingId);
      if (bookingId) await logCriticalError(bookingId, "send-booking-confirmation", error instanceof Error ? error : new Error(errorMessage));
    }
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
