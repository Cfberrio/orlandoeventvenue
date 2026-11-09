// Deposit / balance invoice PDF. Layout only: every number comes from
// invoice-model.ts, which guarantees the columns sum and the discount shows.

import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import type { InvoiceBooking, InvoiceModel } from "./invoice-model.ts";

function money(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateString: string): string {
  const [y, m, d] = dateString.split("T")[0].split("-").map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  return date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function formatTime(t: string | null | undefined): string {
  if (!t) return "N/A";
  const [h, mm] = t.split(":");
  const hour = parseInt(h, 10);
  return `${hour % 12 || 12}:${mm} ${hour >= 12 ? "PM" : "AM"}`;
}

function formatEventType(t: string | null): string {
  return (t || "Event").split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

export async function renderInvoicePdf(model: InvoiceModel, b: InvoiceBooking): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  pdfDoc.setTitle("Invoice");
  const page = pdfDoc.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();

  const helv = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const dark = rgb(0.043, 0.059, 0.098);
  const accent = rgb(0.078, 0.678, 0.902);
  const gray700 = rgb(0.216, 0.255, 0.318);
  const gray500 = rgb(0.42, 0.447, 0.502);
  const gray200 = rgb(0.898, 0.91, 0.922);
  const success = rgb(0.022, 0.588, 0.412);
  const discountColor = rgb(0.75, 0.2, 0.2);
  const white = rgb(1, 1, 1);

  const M = 50;
  const R = width - M;

  const right = (text: string, x: number, y: number, size: number, font = helv, color = gray700) =>
    page.drawText(text, { x: x - font.widthOfTextAtSize(text, size), y, size, font, color });
  const fit = (text: string, max: number, size: number, font = helv) => {
    let t = text;
    while (font.widthOfTextAtSize(t, size) > max && t.length > 4) t = t.slice(0, -2);
    return t === text ? t : t.slice(0, -1) + "…";
  };

  // Header band
  page.drawRectangle({ x: 0, y: height - 100, width, height: 100, color: dark });
  page.drawText("INVOICE", { x: M, y: height - 52, size: 22, font: bold, color: white });
  page.drawText(model.kind === "deposit" ? "Orlando Event Venue" : "Orlando Event Venue · Final 50% Payment", {
    x: M, y: height - 76, size: 11, font: helv, color: white,
  });
  page.drawRectangle({ x: 0, y: height - 104, width, height: 4, color: accent });

  let y = height - 130;
  const issueText = `Issued: ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "America/New_York" })}`;
  page.drawText(`INVOICE #: ${b.reservation_number}`, { x: M, y, size: 10, font: bold, color: gray700 });
  right(issueText, R, y, 10, helv, gray500);

  y -= 30;
  page.drawText("BILLED TO", { x: M, y, size: 9, font: bold, color: gray500 });
  y -= 14;
  page.drawText(b.full_name, { x: M, y, size: 11, font: bold, color: gray700 });
  y -= 13;
  page.drawText(b.email, { x: M, y, size: 10, font: helv, color: gray500 });

  y -= 28;
  page.drawText("EVENT DETAILS", { x: M, y, size: 9, font: bold, color: gray500 });
  y -= 14;
  const detail = (text: string) => {
    page.drawText(text, { x: M, y, size: 10, font: helv, color: gray700 });
    y -= 13;
  };
  detail(`Date: ${formatDate(b.event_date)}`);
  detail(`Type: ${formatEventType(b.event_type)}`);
  if (b.number_of_guests) detail(`Guests: ${b.number_of_guests}`);
  detail(`Booking: ${b.booking_type === "daily" ? "Full Day (24 hours)" : "Hourly"}`);
  if (b.start_time && b.end_time && b.booking_type !== "daily") {
    detail(`Time: ${formatTime(b.start_time)} to ${formatTime(b.end_time)}`);
  }

  // Table
  y -= 14;
  page.drawText(model.kind === "deposit" ? "50% DEPOSIT: PAID TODAY" : "FINAL 50% BALANCE: PAID TODAY", {
    x: M, y, size: 9, font: bold, color: gray500,
  });
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 1, color: gray200 });
  y -= 16;

  const colPaid = R;
  const colNet = R - 78;
  const colDisc = R - 156;
  const colFull = R - 234;
  const labelMax = colFull - 64 - M;
  const S = 9.5;

  page.drawText("Item", { x: M, y, size: S, font: bold, color: gray700 });
  right("Full price", colFull, y, S, bold);
  right("Discount", colDisc, y, S, bold);
  right("Net", colNet, y, S, bold);
  right("Paid today", colPaid, y, S, bold);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 0.5, color: gray200 });
  y -= 14;

  for (const row of model.rows) {
    page.drawText(fit(row.label, labelMax, S), { x: M, y, size: S, font: helv, color: gray700 });
    right(money(row.gross), colFull, y, S);
    right(row.discount > 0 ? money(-row.discount) : "-", colDisc, y, S, helv, row.discount > 0 ? discountColor : gray500);
    right(money(row.net), colNet, y, S);
    right(money(row.paid), colPaid, y, S);
    if (row.sub) {
      y -= 11;
      page.drawText(fit(row.sub, labelMax, 8), { x: M, y, size: 8, font: helv, color: gray500 });
      y -= 14;
    } else {
      y -= 16;
    }
  }

  y -= 2;
  page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 1, color: dark });
  y -= 15;
  page.drawText("Total", { x: M, y, size: S + 0.5, font: bold, color: gray700 });
  right(money(model.totals.gross), colFull, y, S + 0.5, bold);
  right(model.totals.discount > 0 ? money(-model.totals.discount) : "-", colDisc, y, S + 0.5, bold, model.totals.discount > 0 ? discountColor : gray500);
  right(money(model.totals.net), colNet, y, S + 0.5, bold);
  right(money(model.totals.paid), colPaid, y, S + 0.5, bold);

  if (model.discountNote) {
    y -= 16;
    page.drawText(fit(model.discountNote, R - M, 9), { x: M, y, size: 9, font: helv, color: discountColor });
  }

  // Totals block
  y -= 24;
  page.drawText(model.subtotalLabel, { x: M, y, size: 11, font: bold, color: gray700 });
  right(money(model.subtotal), R, y, 11, bold);
  y -= 16;
  page.drawText(`Processing Fee (${model.feePct}%)`, { x: M, y, size: 10, font: helv, color: gray500 });
  right(money(model.fee), R, y, 10, helv, gray500);
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: R, y }, thickness: 0.5, color: gray200 });
  y -= 18;
  page.drawText("TOTAL CHARGED TODAY", { x: M, y, size: 12, font: bold, color: success });
  right(money(model.totalCharged), R, y, 12, bold, success);

  y -= 26;
  page.drawText(fit(model.footnote, R - M, 9), { x: M, y, size: 9, font: helv, color: gray500 });
  y -= 12;
  page.drawText(
    model.kind === "deposit"
      ? "This invoice reflects only the 50% deposit portion paid today."
      : "This invoice reflects only the final 50% balance paid today.",
    { x: M, y, size: 9, font: helv, color: gray500 },
  );

  const footerY = 50;
  page.drawLine({ start: { x: M, y: footerY + 30 }, end: { x: R, y: footerY + 30 }, thickness: 0.5, color: gray200 });
  page.drawText("Orlando Event Venue · 3847 E Colonial Dr, Orlando, FL 32803", { x: M, y: footerY + 14, size: 8, font: helv, color: gray500 });
  page.drawText("(407) 974-5979 · orlandoeventvenue@gmail.com · orlandoeventvenue.org", { x: M, y: footerY, size: 8, font: helv, color: gray500 });

  return await pdfDoc.save();
}
