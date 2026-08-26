import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
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

async function generateDepositReceiptPDF(booking: BookingEmailData, processingFeePct: number): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle("Invoice");
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const helvBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const dark = rgb(0.043, 0.059, 0.098);
  const accent = rgb(0.078, 0.678, 0.902);
  const gray700 = rgb(0.216, 0.255, 0.318);
  const gray500 = rgb(0.42, 0.447, 0.502);
  const gray200 = rgb(0.898, 0.91, 0.922);
  const success = rgb(0.022, 0.588, 0.412);
  const white = rgb(1, 1, 1);

  const M = 50;

  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: dark });
  page.drawText("INVOICE", { x: M, y: height - 52, size: 22, font: helvBold, color: white });
  page.drawText("Orlando Event Venue", { x: M, y: height - 76, size: 11, font: helv, color: white });
  page.drawRectangle({ x: 0, y: height - 104, width, height: 4, color: accent });

  let y = height - 130;

  const issueDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const issueText = `Issued: ${issueDate}`;
  page.drawText(`INVOICE #: ${booking.reservation_number}`, { x: M, y, size: 10, font: helvBold, color: gray700 });
  page.drawText(issueText, { x: width - M - helv.widthOfTextAtSize(issueText, 10), y, size: 10, font: helv, color: gray500 });

  y -= 30;
  page.drawText("BILLED TO", { x: M, y, size: 9, font: helvBold, color: gray500 });
  y -= 14;
  page.drawText(booking.full_name, { x: M, y, size: 11, font: helvBold, color: gray700 });
  y -= 13;
  page.drawText(booking.email, { x: M, y, size: 10, font: helv, color: gray500 });

  y -= 28;
  page.drawText("EVENT DETAILS", { x: M, y, size: 9, font: helvBold, color: gray500 });
  y -= 14;
  const eventDateLong = formatDate(booking.event_date);
  const drawDetail = (text: string) => {
    page.drawText(text, { x: M, y, size: 10, font: helv, color: gray700 });
    y -= 13;
  };
  drawDetail(`Date: ${eventDateLong}`);
  drawDetail(`Type: ${formatEventType(booking.event_type)}`);
  drawDetail(`Guests: ${booking.number_of_guests}`);
  drawDetail(`Booking: ${formatBookingType(booking.booking_type)}`);
  if (booking.start_time && booking.end_time) {
    drawDetail(`Time: ${formatTime(booking.start_time)} to ${formatTime(booking.end_time)}`);
  }

  y -= 14;
  page.drawText("50% DEPOSIT: PAID TODAY", { x: M, y, size: 9, font: helvBold, color: gray500 });
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray200 });
  y -= 16;

  const fullPriceX = width - M - 200;
  const colHeaderFull = "Full Price";
  const colHeaderPaid = "50% Paid";
  page.drawText("Item", { x: M, y, size: 10, font: helvBold, color: gray700 });
  page.drawText(colHeaderFull, { x: fullPriceX, y, size: 10, font: helvBold, color: gray700 });
  page.drawText(colHeaderPaid, { x: width - M - helvBold.widthOfTextAtSize(colHeaderPaid, 10), y, size: 10, font: helvBold, color: gray700 });
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: gray200 });
  y -= 14;

  const items: { label: string; full: number; sub?: string }[] = [];
  if (booking.base_rental > 0) items.push({ label: "Base Rental", full: booking.base_rental, sub: formatBookingType(booking.booking_type) });
  if (booking.cleaning_fee > 0) items.push({ label: "Cleaning Fee", full: booking.cleaning_fee });
  if (booking.package && booking.package !== "none" && booking.package_cost > 0) {
    items.push({ label: getPackageName(booking.package), full: booking.package_cost, sub: getPackageInclusions(booking.package).join(", ") || undefined });
  }
  if (booking.bar_package && booking.bar_package !== "none" && (booking.bar_subtotal ?? 0) > 0) {
    const sub = booking.bar_guest_count ? `${booking.bar_guest_count} guests${booking.bar_rate_per_guest ? ` × ${formatCurrency(Number(booking.bar_rate_per_guest))}` : ""}` : undefined;
    items.push({ label: `Bar Service: ${booking.bar_package_label || "Standard"}`, full: Number(booking.bar_subtotal), sub });
  }
  if (booking.optional_services > 0) items.push({ label: "Add-ons & Optional Services", full: booking.optional_services });
  if (booking.taxes_fees > 0) items.push({ label: "Taxes & Fees", full: booking.taxes_fees });

  for (const it of items) {
    const labelMax = fullPriceX - M - 8;
    let label = it.label;
    while (helv.widthOfTextAtSize(label, 10) > labelMax && label.length > 4) {
      label = label.slice(0, -2);
    }
    if (label !== it.label) label = label.slice(0, -1) + "…";
    page.drawText(label, { x: M, y, size: 10, font: helv, color: gray700 });
    page.drawText(formatCurrency(it.full), { x: fullPriceX, y, size: 10, font: helv, color: gray700 });
    const halfStr = formatCurrency(it.full / 2);
    page.drawText(halfStr, { x: width - M - helv.widthOfTextAtSize(halfStr, 10), y, size: 10, font: helv, color: gray700 });
    if (it.sub) {
      y -= 11;
      let sub = it.sub;
      while (helv.widthOfTextAtSize(sub, 8) > labelMax && sub.length > 4) {
        sub = sub.slice(0, -2);
      }
      if (sub !== it.sub) sub = sub.slice(0, -1) + "…";
      page.drawText(sub, { x: M, y, size: 8, font: helv, color: gray500 });
      y -= 14;
    } else {
      y -= 16;
    }
  }

  y -= 2;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: dark });
  y -= 16;

  page.drawText("Deposit Subtotal (50%)", { x: M, y, size: 11, font: helvBold, color: gray700 });
  const subStr = formatCurrency(booking.deposit_amount);
  page.drawText(subStr, { x: width - M - helvBold.widthOfTextAtSize(subStr, 11), y, size: 11, font: helvBold, color: gray700 });
  y -= 16;

  // Use persisted values when available (set by create-checkout after Stripe session).
  // Fall back to local computation only for legacy bookings that predate the migration.
  const feeAmt = booking.deposit_fee != null
    ? Number(booking.deposit_fee)
    : Math.round(booking.deposit_amount * (processingFeePct / 100) * 100) / 100;
  const totalCharged = booking.deposit_total_charged != null
    ? Number(booking.deposit_total_charged)
    : Math.round((booking.deposit_amount + feeAmt) * 100) / 100;

  page.drawText(`Processing Fee (${processingFeePct}%)`, { x: M, y, size: 10, font: helv, color: gray500 });
  const feeStr = formatCurrency(feeAmt);
  page.drawText(feeStr, { x: width - M - helv.widthOfTextAtSize(feeStr, 10), y, size: 10, font: helv, color: gray500 });
  y -= 14;

  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: gray200 });
  y -= 18;

  page.drawText("TOTAL CHARGED TODAY", { x: M, y, size: 12, font: helvBold, color: success });
  const totalStr = formatCurrency(totalCharged);
  page.drawText(totalStr, { x: width - M - helvBold.widthOfTextAtSize(totalStr, 12), y, size: 12, font: helvBold, color: success });

  y -= 26;
  const balStr = formatCurrency(booking.balance_amount);
  page.drawText(`Remaining 50% balance: ${balStr}, due 15 days before your event.`, { x: M, y, size: 9, font: helv, color: gray500 });
  y -= 12;
  page.drawText("This invoice reflects only the 50% deposit portion paid today.", { x: M, y, size: 9, font: helv, color: gray500 });

  const footerY = 50;
  page.drawLine({ start: { x: M, y: footerY + 30 }, end: { x: width - M, y: footerY + 30 }, thickness: 0.5, color: gray200 });
  page.drawText("Orlando Event Venue · 3847 E Colonial Dr, Orlando, FL 32803", { x: M, y: footerY + 14, size: 8, font: helv, color: gray500 });
  page.drawText("(407) 974-5979 · orlandoeventvenue@gmail.com · orlandoeventvenue.org", { x: M, y: footerY, size: 8, font: helv, color: gray500 });

  return await pdfDoc.save();
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

    let processingFeePct = 3.5;
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const { data: feeRow } = await supabase
        .from("venue_pricing")
        .select("price")
        .eq("item_key", "processing_fee")
        .eq("is_active", true)
        .single();
      if (feeRow?.price) processingFeePct = Number(feeRow.price);
    } catch (e) {
      console.error("Failed to fetch processing fee, using default 3.5%:", e);
    }

    const emailHTML = sanitizeForSmtp(generateEmailHTML(booking));

    let pdfBase64: string | null = null;
    try {
      const pdfBytes = await generateDepositReceiptPDF(booking, processingFeePct);
      pdfBase64 = encodeBase64(pdfBytes);
    } catch (pdfErr) {
      console.error("Failed to generate deposit receipt PDF:", pdfErr);
      const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      // Email still sends (without attachment) — alert so the missing invoice is noticed.
      await sendCriticalAlert(
        "send-booking-confirmation (deposit PDF)",
        booking.reservation_number,
        `Deposit receipt PDF failed to generate: confirmation email sent WITHOUT the invoice attachment. ${pdfMsg}`
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
              filename: `Invoice-${booking.reservation_number}.pdf`,
              content: pdfBase64,
              encoding: "base64",
              contentType: "application/pdf",
            },
          ]
        : undefined,
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
