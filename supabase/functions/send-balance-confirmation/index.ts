import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { encodeBase64 } from "https://deno.land/std@0.224.0/encoding/base64.ts";

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
  taxes_fees?: number;
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
  const formattedEventType = formatEventType(booking.event_type);
  const timeRange = booking.start_time && booking.end_time
    ? `${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`
    : "All Day";

  const detailRow = (label: string, value: string) => `
          <tr>
            <td style="padding:8px 0;border-top:1px solid #E5E7EB;">
              <span style="font-size:12px;color:#6B7280;">${label}</span><br>
              <span style="font-size:14px;color:#111827;font-weight:bold;">${value}</span>
            </td>
          </tr>`;

  const card = (title: string, body: string) => `
      <div style="background:#F9FAFB;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">${title}</p>
        ${body}
      </div>`;

  const accessCard = `
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Your Access Page
        </p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.65;color:#6B7280;">
          One link, used before and after the event.
        </p>
        <p style="margin:0 0 10px;font-size:14px;line-height:1.5;">
          <a href="https://orlandoeventvenue.org/accesscode" style="color:#14ADE6;text-decoration:none;font-weight:bold;">https://orlandoeventvenue.org/accesscode</a>
        </p>
        <p style="margin:0 0 4px;font-size:12px;color:#6B7280;">Enter your reservation number on the page:</p>
        <p style="margin:0 0 12px;font-size:16px;color:#111827;font-weight:bold;letter-spacing:.5px;">${booking.reservation_number}</p>
        <ul style="margin:0;padding:0 0 0 18px;color:#374151;line-height:1.7;font-size:14px;">
          <li style="margin:0 0 6px;"><strong>Before / during your event:</strong> the page shows your live door code + Wi-Fi. The code rotates per booking.</li>
          <li style="margin:0;"><strong>After your event ends:</strong> the same page becomes your Guest Report (2 min — photos of the venue) and your review link.</li>
        </ul>
        <p style="margin:12px 0 0;font-size:13px;line-height:1.6;color:#6B7280;">
          The day before your event you'll get a short text with the access link, and again 1 hour before.
        </p>
      </div>`;

  const entrySteps = `
        <ol style="margin:0;padding:0 0 0 20px;color:#374151;line-height:1.7;font-size:14px;">
          <li style="margin:0 0 6px;">Arrive at Colonial Town Center and look for the <strong>GLOBAL</strong> sign with <strong>3847</strong> displayed.</li>
          <li style="margin:0 0 6px;">Facing the GLOBAL sign, go to the door on the <strong>left side</strong> of the building.</li>
          <li style="margin:0 0 6px;">Find the <strong>black lockbox</strong> with the touchscreen keypad.</li>
          <li style="margin:0 0 6px;">Tap the screen to wake it, then enter the code from the access page.</li>
          <li style="margin:0 0 6px;">Open the lockbox and retrieve the <strong>magnetic key</strong>.</li>
          <li style="margin:0 0 6px;">Tap the magnetic key on the sensor on the <strong>right side</strong> of the door.</li>
          <li style="margin:0 0 6px;">Return the key to the lockbox immediately and close it.</li>
          <li style="margin:0;">Inside, locate the remote labeled <strong>"Light"</strong> on the left wall — left-side buttons turn lights on. Return the remote when done.</li>
        </ol>`;

  const beforeYouLeave = `
        <ul style="margin:0;padding:0 0 0 18px;color:#374151;line-height:1.7;font-size:14px;">
          <li style="margin:0 0 6px;">Turn off all lights (right-side buttons on the light pad).</li>
          <li style="margin:0 0 6px;">Place all trash bags on the back patio. No trash inside.</li>
          <li style="margin:0 0 6px;">Restore tables and chairs to the original layout.</li>
          <li style="margin:0 0 6px;">Take all personal items with you.</li>
          <li style="margin:0;">Lock the door securely.</li>
        </ul>`;

  const afterYouLeave = `
        <p style="margin:0;font-size:14px;line-height:1.65;color:#374151;">
          Head back to the same access page — once your booking ends, it switches to show the <strong>Guest Report</strong> (a quick photo walkthrough so we can close out your reservation) and a quick review link. Same URL, same reservation number:
        </p>
        <p style="margin:10px 0 0;font-size:14px;line-height:1.5;">
          <a href="https://orlandoeventvenue.org/accesscode" style="color:#14ADE6;text-decoration:none;font-weight:bold;">https://orlandoeventvenue.org/accesscode</a>
        </p>
        <p style="margin:10px 0 0;font-size:13px;line-height:1.6;color:#6B7280;">
          You'll also get a short text reminder 24 hours later if you haven't left a review yet.
        </p>`;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>You're Set — Access Instructions for Event Day | Orlando Event Venue</title>
  <meta name="description" content="Fully paid. Here's how access works on event day — and what to do after.">
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;line-height:0;mso-hide:all;">
    Fully paid. Here's how access works on event day — and what to do after.
  </div>
  <div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);">
    <div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">
      <h1 style="margin:0;font-size:24px;letter-spacing:.2px;line-height:1.25;">
        You're <span style="color:#14ADE6;">Set</span>
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
        You're set. Final payment is in, your booking at Orlando Event Venue is fully paid, and we're looking forward to hosting you.
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
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Your Booking
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          ${detailRow("Reservation #", booking.reservation_number)}
          ${detailRow("Event Date", formattedDate)}
          ${detailRow("Event Time", timeRange)}
          ${detailRow("Booking Type", formattedBookingType)}
          ${detailRow("Guests", String(booking.number_of_guests))}
          ${detailRow("Event Type", formattedEventType)}
        </table>
      </div>
      <div style="background:#FFFFFF;border:1px solid #E5E7EB;border-radius:12px;padding:16px;margin:16px 0 0;">
        <p style="margin:0 0 10px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Payment Summary
        </p>
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          ${detailRow("Total", formatCurrency(booking.total_amount))}
          ${detailRow("First 50%", formatCurrency(booking.deposit_amount))}
          ${detailRow("Second 50%", formatCurrency(booking.balance_amount))}
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
      ${accessCard}
      ${card("Entry Steps (once you have the code from the access page)", entrySteps)}
      ${card("Before You Leave", beforeYouLeave)}
      ${card("After You Leave", afterYouLeave)}
      <p style="margin:18px 0 0;font-size:14px;line-height:1.65;color:#374151;">
        If anything needs to change before event day, reply here.
      </p>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">
        Reservation #: <strong>${booking.reservation_number}</strong><br>
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

async function generateBalanceReceiptPDF(booking: BalanceEmailData, processingFeePct: number): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
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
  page.drawText("BALANCE RECEIPT", { x: M, y: height - 52, size: 22, font: helvBold, color: white });
  page.drawText("Orlando Event Venue · Final 50% Payment", { x: M, y: height - 76, size: 11, font: helv, color: white });
  page.drawRectangle({ x: 0, y: height - 104, width, height: 4, color: accent });

  let y = height - 130;
  const issueDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const issueText = `Issued: ${issueDate}`;
  page.drawText(`RECEIPT #: ${booking.reservation_number}`, { x: M, y, size: 10, font: helvBold, color: gray700 });
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
    drawDetail(`Time: ${formatTime(booking.start_time)} – ${formatTime(booking.end_time)}`);
  }

  y -= 14;
  page.drawText("FINAL 50% — PAID TODAY", { x: M, y, size: 9, font: helvBold, color: gray500 });
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 1, color: gray200 });
  y -= 16;

  const fullPriceX = width - M - 200;
  const colHeaderPaid = "50% Paid";
  page.drawText("Item", { x: M, y, size: 10, font: helvBold, color: gray700 });
  page.drawText("Full Price", { x: fullPriceX, y, size: 10, font: helvBold, color: gray700 });
  page.drawText(colHeaderPaid, { x: width - M - helvBold.widthOfTextAtSize(colHeaderPaid, 10), y, size: 10, font: helvBold, color: gray700 });
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: width - M, y }, thickness: 0.5, color: gray200 });
  y -= 14;

  const items: { label: string; full: number; sub?: string }[] = [];
  if ((booking.base_rental ?? 0) > 0) items.push({ label: "Base Rental", full: Number(booking.base_rental), sub: formatBookingType(booking.booking_type) });
  if ((booking.cleaning_fee ?? 0) > 0) items.push({ label: "Cleaning Fee", full: Number(booking.cleaning_fee) });
  if (booking.package && booking.package !== "none" && (booking.package_cost ?? 0) > 0) {
    items.push({ label: getPackageName(booking.package), full: Number(booking.package_cost), sub: getPackageInclusions(booking.package).join(", ") || undefined });
  }
  if (booking.bar_package && booking.bar_package !== "none" && (booking.bar_subtotal ?? 0) > 0) {
    const sub = booking.bar_guest_count ? `${booking.bar_guest_count} guests${booking.bar_rate_per_guest ? ` × ${formatCurrency(Number(booking.bar_rate_per_guest))}` : ""}` : undefined;
    items.push({ label: `Bar Service — ${booking.bar_package_label || "Standard"}`, full: Number(booking.bar_subtotal), sub });
  }
  if ((booking.optional_services ?? 0) > 0) items.push({ label: "Add-ons & Optional Services", full: Number(booking.optional_services) });
  if ((booking.taxes_fees ?? 0) > 0) items.push({ label: "Taxes & Fees", full: Number(booking.taxes_fees) });

  for (const it of items) {
    const labelMax = fullPriceX - M - 8;
    let label = it.label;
    while (helv.widthOfTextAtSize(label, 10) > labelMax && label.length > 4) label = label.slice(0, -2);
    if (label !== it.label) label = label.slice(0, -1) + "…";
    page.drawText(label, { x: M, y, size: 10, font: helv, color: gray700 });
    page.drawText(formatCurrency(it.full), { x: fullPriceX, y, size: 10, font: helv, color: gray700 });
    const halfStr = formatCurrency(it.full / 2);
    page.drawText(halfStr, { x: width - M - helv.widthOfTextAtSize(halfStr, 10), y, size: 10, font: helv, color: gray700 });
    if (it.sub) {
      y -= 11;
      let sub = it.sub;
      while (helv.widthOfTextAtSize(sub, 8) > labelMax && sub.length > 4) sub = sub.slice(0, -2);
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

  page.drawText("Balance Subtotal (50%)", { x: M, y, size: 11, font: helvBold, color: gray700 });
  const subStr = formatCurrency(booking.balance_amount);
  page.drawText(subStr, { x: width - M - helvBold.widthOfTextAtSize(subStr, 11), y, size: 11, font: helvBold, color: gray700 });
  y -= 16;

  const feeAmt = Math.round(booking.balance_amount * (processingFeePct / 100) * 100) / 100;
  const totalCharged = Math.round((booking.balance_amount + feeAmt) * 100) / 100;

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
  page.drawText(`Booking now fully paid. Event total: ${formatCurrency(booking.total_amount)}.`, { x: M, y, size: 9, font: helv, color: gray500 });
  y -= 12;
  page.drawText("This receipt reflects only the final 50% balance paid today.", { x: M, y, size: 9, font: helv, color: gray500 });

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

    const emailHTML = generateEmailHTML(booking);

    let pdfBase64: string | null = null;
    try {
      const pdfBytes = await generateBalanceReceiptPDF(booking, processingFeePct);
      pdfBase64 = encodeBase64(pdfBytes);
    } catch (pdfErr) {
      console.error("Failed to generate balance receipt PDF:", pdfErr);
      const pdfMsg = pdfErr instanceof Error ? pdfErr.message : String(pdfErr);
      // Email still sends (without attachment) — alert so the missing invoice is noticed.
      await sendCriticalAlert(
        "send-balance-confirmation (balance PDF)",
        booking.reservation_number,
        `Balance receipt PDF failed to generate — confirmation email sent WITHOUT the invoice attachment. ${pdfMsg}`
      );
    }

    await client.send({
      from: gmailUser,
      to: booking.email,
      subject: `You're Set — Access Instructions for Event Day | Orlando Event Venue`,
      content: "You're set. Please view this email in an HTML-compatible email client.",
      html: emailHTML,
      attachments: pdfBase64
        ? [
            {
              filename: `Balance-Receipt-${booking.reservation_number}.pdf`,
              content: pdfBase64,
              encoding: "base64",
              contentType: "application/pdf",
            },
          ]
        : undefined,
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

    // Alert on customer-facing email failure (re-parse body for reservation #).
    const booking: BalanceEmailData = await req.clone().json().catch(() => ({} as BalanceEmailData));
    if (booking.reservation_number) {
      await sendCriticalAlert("send-balance-confirmation", booking.reservation_number, errorMessage);
    }

    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
