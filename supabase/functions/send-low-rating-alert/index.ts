import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
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
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${data.reservation_number}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Guest Name</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${data.guest_name}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Guest Email</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${data.guest_email}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Event Date</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${formatDate(data.event_date)}</td>
</tr>
<tr>
<td style="padding:8px 0;color:#64748b;font-size:14px;">Event Type</td>
<td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;text-align:right;">${data.event_type}</td>
</tr>
</table>

${data.comment ? `
<h3 style="color:#0f172a;margin:0 0 12px 0;font-size:14px;font-weight:700;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">
Guest Comment
</h3>
<div style="background-color:#f8fafc;border-left:4px solid #dc2626;padding:16px;margin-bottom:24px;">
<p style="color:#475569;margin:0;font-size:14px;line-height:1.6;font-style:italic;">
"${data.comment}"
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
<p style="color:#94a3b8;margin:0;font-size:11px;">
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: LowRatingAlertData = await req.json();
    console.log("Sending low rating alert for:", data.reservation_number, "Rating:", data.rating);

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

    const emailHTML = generateAlertEmailHTML(data);

    // Send to admin email (same as sender for now)
    await client.send({
      from: gmailUser,
      to: gmailUser, // Send to admin
      subject: `⚠️ Low Rating Alert (${data.rating}/5) - ${data.reservation_number}`,
      content: `Low rating alert: ${data.rating}/5 stars for reservation ${data.reservation_number}`,
      html: emailHTML,
    });

    await client.close();

    console.log("Low rating alert sent successfully for:", data.reservation_number);

    return new Response(
      JSON.stringify({ ok: true, message: "Alert sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending low rating alert:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});