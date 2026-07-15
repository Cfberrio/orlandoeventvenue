import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StaffResponseNotificationData {
  response: "accepted" | "rejected" | "auto_rejected";
  staffName: string;
  staffRole: string;
  reservationNumber: string;
  eventDate: string; // yyyy-mm-dd or preformatted
  bookingId?: string;
}

function formatDate(dateString: string): string {
  if (!dateString || dateString === "N/A") return "N/A";
  const date = new Date(dateString.includes("T") ? dateString : dateString + "T00:00:00");
  if (isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

const RESPONSE_COPY: Record<StaffResponseNotificationData["response"], { label: string; color: string; detail: string }> = {
  accepted: {
    label: "✅ Assignment Accepted",
    color: "#16a34a",
    detail: "The staff member confirmed they will work this event.",
  },
  rejected: {
    label: "❌ Assignment Rejected",
    color: "#dc2626",
    detail: "The staff member declined this assignment. Please reassign someone else.",
  },
  auto_rejected: {
    label: "⏰ Assignment Auto-Rejected (no response)",
    color: "#d97706",
    detail: "The staff member did not respond before the 24-hour deadline, so the assignment was automatically rejected. Please reassign someone else.",
  },
};

function generateEmailHTML(data: StaffResponseNotificationData): string {
  const copy = RESPONSE_COPY[data.response];
  const bookingLink = data.bookingId
    ? `https://orlandoeventvenue.org/admin/bookings/${data.bookingId}`
    : null;

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background:${copy.color};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold;">
              ${copy.label}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px;color:#0f172a;font-size:14px;line-height:1.6;">
              <p style="margin:0 0 16px;">${copy.detail}</p>
              <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;color:#0f172a;">
                <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Staff member</td><td style="font-weight:bold;">${data.staffName}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Role</td><td>${data.staffRole}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Reservation</td><td>${data.reservationNumber}</td></tr>
                <tr><td style="padding:4px 12px 4px 0;color:#64748b;">Event date</td><td>${formatDate(data.eventDate)}</td></tr>
              </table>
              ${bookingLink ? `<p style="margin:20px 0 0;"><a href="${bookingLink}" style="background:#0f172a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:6px;display:inline-block;">Open booking in dashboard</a></p>` : ""}
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;background:#f8fafc;color:#94a3b8;font-size:12px;">
              Orlando Event Venue — internal staff notification
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
    const data: StaffResponseNotificationData = await req.json();
    console.log(`Staff response notification: ${data.response} by ${data.staffName} for ${data.reservationNumber}`);

    if (!RESPONSE_COPY[data.response]) {
      return new Response(
        JSON.stringify({ ok: false, error: `Invalid response type: ${data.response}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

    const copy = RESPONSE_COPY[data.response];
    const subject = `${copy.label} — ${data.staffName} · ${data.reservationNumber}`;

    await client.send({
      from: gmailUser,
      to: gmailUser, // internal notification to the venue inbox
      subject,
      content: `${copy.label}: ${data.staffName} (${data.staffRole}) — reservation ${data.reservationNumber}, event ${data.eventDate}. ${copy.detail}`,
      html: generateEmailHTML(data),
    });

    await client.close();

    console.log("Staff response notification sent");

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending staff response notification:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
