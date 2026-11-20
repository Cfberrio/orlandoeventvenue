import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { escapeHtml } from "../_shared/email-layout.ts";
import { isServiceRoleRequest } from "../_shared/internal-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LowRatingAlertData {
  reservation_number: string;
  guest_name: string;
  guest_email: string;
  event_date: string;
  event_type: string;
  rating: number;
  comment: string;
}

function formatDate(dateString: string): string {
  // A date-only value is a calendar day, not an instant: read it at noon UTC
  // so it never shifts to the previous day.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(dateString)
    ? new Date(`${dateString}T12:00:00Z`)
    : new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString || "unknown";
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function generateAlertEmailHTML(data: LowRatingAlertData): string {
  const stars = "★".repeat(data.rating) + "☆".repeat(5 - data.rating);
  
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Low Rating Alert</title>
</head>
<body style="margin:0;padding:0;background-color:#fef2f2;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#fef2f2;padding:40px 20px;">
<tr>
<td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;border:2px solid #fecaca;">

<!-- Header -->
<tr>
<td style="background-color:#dc2626;padding:24px;text-align:center;">
<h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:700;">
⚠️ Low Rating Alert
</h1>
</td>
</tr>

<!-- Content -->
<tr>
<td style="padding:32px;">
<p style="color:#991b1b;margin:0 0 16px 0;font-size:16px;font-weight:600;">
A guest has submitted a low rating (${data.rating}/5 stars)
</p>

<div style="background-color:#fef2f2;border-radius:8px;padding:20px;margin-bottom:24px;">
<p style="color:#7f1d1d;margin:0 0 8px 0;font-size:24px;text-align:center;">
${stars}
</p>
<p style="color:#991b1b;margin:0;font-size:14px;text-align:center;font-weight:600;">
${data.rating} out of 5 stars
</p>
</div>

<h3 style="color:#0f172a;margin:0 0 12px 0;font-size:14px;font-weight:700;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">
Booking Details
</h3>
<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Reservation</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(data.reservation_number)}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Guest Name</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(data.guest_name)}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Guest Email</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(data.guest_email)}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Event Date</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(formatDate(data.event_date))}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Event Type</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${escapeHtml(data.event_type)}</td>
</tr>
</table>

${data.comment ? `
<h3 style="color:#0f172a;margin:0 0 12px 0;font-size:14px;font-weight:700;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">
Guest Comment
</h3>
<div style="background-color:#f8fafc;border-left:4px solid #dc2626;padding:16px;margin-bottom:24px;">
<p style="color:#475569;margin:0;font-size:14px;line-height:1.6;font-style:italic;">
"${escapeHtml(data.comment)}"
</p>
</div>
` : ''}

<p style="color:#64748b;margin:0;font-size:13px;">
Please review this feedback and consider reaching out to the guest to address any concerns.
</p>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="background-color:#f8fafc;padding:16px 32px;text-align:center;">
<p style="color:#64748b;margin:0;font-size:11px;font-weight:bold;">Orlando Event Venue Team</p>
<p style="color:#94a3b8;margin:4px 0 0;font-size:11px;">3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="color:#94a3b8;margin:2px 0 0;font-size:11px;">Orlandoeventvenue@gmail.com | (407) 974-5979</p>
<p style="color:#94a3b8;margin:8px 0 0;font-size:11px;">
This is an automated alert from Orlando Event Venue booking system.
</p>
</td>
</tr>

</table>
</td>
</tr>
</table>
</body>
</html>`;
}

// Second pass X2-10 (ClickUp 86e40ach2). This endpoint used to email the
// office whatever the caller sent, unescaped. Now the request only names the
// booking ({ booking_id, reservation_number }, the same pair the guest report
// page holds); every fact in the email is loaded from the database
// (guest_report_submissions, booking_host_reports, bookings) and escaped.
// A public caller must name a report submitted in the last 24 hours with a
// stored 1-2 star rating; the send is claimed once per booking
// (guest_report_submissions.low_rating_alert_sent_at) and released on failure.
const PUBLIC_REPORT_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function respond(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { booking_id?: unknown; reservation_number?: unknown };
    const bookingId = typeof body.booking_id === "string" && UUID_RE.test(body.booking_id) ? body.booking_id : null;
    const reservationNumber =
      typeof body.reservation_number === "string" ? body.reservation_number.trim().toUpperCase() : "";
    if (!bookingId || !reservationNumber) {
      return respond(400, { ok: false, error: "booking_id and reservation_number are required" });
    }

    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, supabaseServiceKey);
    const isService = isServiceRoleRequest(req.headers.get("Authorization"), supabaseServiceKey);

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, reservation_number, event_date, event_type")
      .eq("id", bookingId)
      .eq("reservation_number", reservationNumber)
      .maybeSingle();
    if (bookingError) throw bookingError;
    if (!booking) return respond(404, { ok: false, error: "Report not found" });

    const { data: submission, error: subError } = await supabase
      .from("guest_report_submissions")
      .select("booking_id, host_report_id, review_rating, review_comment, created_at, low_rating_alert_sent_at")
      .eq("booking_id", bookingId)
      .maybeSingle();
    if (subError) throw subError;
    const rating = Number(submission?.review_rating ?? 0);
    if (!submission || rating < 1 || rating > 2) {
      return respond(200, { ok: true, skipped: true, reason: "no_low_rating" });
    }
    if (!isService && Date.now() - new Date(submission.created_at).getTime() > PUBLIC_REPORT_MAX_AGE_MS) {
      return respond(403, { ok: false, error: "Report is too old to alert from the browser" });
    }

    // Claim the alert once per booking.
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabase
      .from("guest_report_submissions")
      .update({ low_rating_alert_sent_at: claimedAt })
      .eq("booking_id", bookingId)
      .is("low_rating_alert_sent_at", null)
      .select("booking_id");
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) {
      return respond(200, { ok: true, skipped: true, reason: "already_sent" });
    }
    const release = async () => {
      const { error } = await supabase
        .from("guest_report_submissions")
        .update({ low_rating_alert_sent_at: null })
        .eq("booking_id", bookingId)
        .eq("low_rating_alert_sent_at", claimedAt);
      if (error) console.error("Could not release low rating alert claim:", error);
    };

    let guestName = "";
    let guestEmail = "";
    if (submission.host_report_id) {
      const { data: report } = await supabase
        .from("booking_host_reports")
        .select("guest_name, guest_email")
        .eq("id", submission.host_report_id)
        .maybeSingle();
      guestName = String(report?.guest_name ?? "");
      guestEmail = String(report?.guest_email ?? "");
    }

    const data: LowRatingAlertData = {
      reservation_number: String(booking.reservation_number ?? reservationNumber),
      guest_name: guestName,
      guest_email: guestEmail,
      event_date: String(booking.event_date ?? ""),
      event_type: String(booking.event_type ?? ""),
      rating,
      comment: String(submission.review_comment ?? ""),
    };
    console.log("Sending low rating alert for:", data.reservation_number, "Rating:", data.rating);

    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailPassword) {
      console.error("Gmail credentials not configured");
      await release();
      return respond(500, { ok: false, error: "Email service not configured" });
    }

    try {
      const client = new SMTPClient({
        connection: {
          hostname: "smtp.gmail.com",
          port: 465,
          tls: true,
          auth: { username: gmailUser, password: gmailPassword },
        },
      });
      await client.send({
        from: gmailUser,
        to: gmailUser, // office inbox
        subject: `⚠️ Low Rating Alert (${data.rating}/5) - ${data.reservation_number}`,
        content: `Low rating alert: ${data.rating}/5 stars for reservation ${data.reservation_number}`,
        html: generateAlertEmailHTML(data),
      });
      await client.close();
    } catch (sendError) {
      console.error("Low rating alert send failed:", sendError);
      await release();
      return respond(500, { ok: false, error: "Alert could not be sent" });
    }

    console.log("Low rating alert sent successfully for:", data.reservation_number);
    return respond(200, { ok: true, message: "Alert sent successfully" });
  } catch (error: unknown) {
    console.error("Error sending low rating alert:", error);
    return respond(500, { ok: false, error: "Internal error" });
  }
});
