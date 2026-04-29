import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface StaffAssignmentEmailData {
  staffEmail: string;
  staffName: string;
  reservationNumber: string;
  eventDateLong: string;
  eventTimeRange: string;
  staffRole: string;
  adminNotes: string;
  logoUrl: string;
  // Optional Bar Vendor specific fields
  bookingId?: string;
  eventType?: string;
  barPackageLabel?: string;
  barGuestCount?: number | null;
  clientFullName?: string;
  clientEmail?: string;
  clientPhone?: string;
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

function formatTimeRange(startTime: string | undefined | null, endTime: string | undefined | null): string {
  if (!startTime || !endTime) return "TBD";
  return `${formatTime(startTime)} - ${formatTime(endTime)}`;
}

function generateBarVendorEmailHTML(data: StaffAssignmentEmailData): string {
  const firstName = data.staffName.split(" ")[0];
  const dashboardLink = data.bookingId
    ? `https://orlandoeventvenue.org/staff/bookings/${data.bookingId}`
    : "https://orlandoeventvenue.org/staff";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>New Bar Service Assignment — ${data.eventDateLong}</title></head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">You have been assigned to a bar service booking.</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
<tr><td style="padding:22px 24px;background:#0b1220;"><table role="presentation" width="100%"><tr><td><img src="${data.logoUrl}" alt="Orlando Event Venue" height="28" style="display:block;border:0;"/></td><td align="right" style="color:#cbd5e1;font-size:12px;">Bar Service Assignment</td></tr></table></td></tr>
<tr><td style="padding:18px 24px 8px 24px;"><span style="display:inline-block;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;">NEW BAR SERVICE ASSIGNMENT</span></td></tr>
<tr><td style="padding:10px 24px 8px 24px;">
<div style="font-size:20px;line-height:28px;font-weight:800;color:#0f172a;">Hi ${firstName}, you have a new Bar Service assignment</div>
<div style="margin-top:8px;font-size:14px;line-height:22px;color:#475569;">You have been assigned to a Bar Service booking at Orlando Event Venue. Please review the details below and contact the client directly.</div>
</td></tr>
<tr><td style="padding:14px 24px 8px 24px;"><table role="presentation" width="100%" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<tr><td style="padding:12px 14px;background:#f8fafc;font-weight:800;font-size:13px;color:#0f172a;">Event Details</td></tr>
<tr><td style="padding:12px 14px;font-size:14px;line-height:22px;color:#334155;">
<div><b>Reservation #:</b> ${data.reservationNumber}</div>
<div><b>Date:</b> ${data.eventDateLong}</div>
<div><b>Time:</b> ${data.eventTimeRange}</div>
<div><b>Event Type:</b> ${data.eventType || "—"}</div>
<div><b>Venue:</b> 3847 E Colonial Dr, Orlando, FL 32803</div>
</td></tr></table></td></tr>
<tr><td style="padding:8px 24px;"><table role="presentation" width="100%" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<tr><td style="padding:12px 14px;background:#fef3c7;font-weight:800;font-size:13px;color:#92400e;">Bar Service</td></tr>
<tr><td style="padding:12px 14px;font-size:14px;line-height:22px;color:#334155;">
<div><b>Package:</b> ${data.barPackageLabel || "—"}</div>
<div><b>Guests:</b> ${data.barGuestCount ?? "—"}</div>
</td></tr></table></td></tr>
<tr><td style="padding:8px 24px;"><table role="presentation" width="100%" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<tr><td style="padding:12px 14px;background:#ecfeff;font-weight:800;font-size:13px;color:#155e75;">Client Contact</td></tr>
<tr><td style="padding:12px 14px;font-size:14px;line-height:22px;color:#334155;">
<div><b>Name:</b> ${data.clientFullName || "—"}</div>
<div><b>Email:</b> ${data.clientEmail ? `<a href="mailto:${data.clientEmail}" style="color:#0f172a;">${data.clientEmail}</a>` : "—"}</div>
<div><b>Phone:</b> ${data.clientPhone ? `<a href="tel:${data.clientPhone}" style="color:#0f172a;">${data.clientPhone}</a>` : "—"}</div>
</td></tr></table></td></tr>
<tr><td style="padding:12px 24px;font-size:14px;line-height:22px;color:#334155;">Please log in to your Staff Dashboard, review the booking details, contact the client directly to confirm bar service details, and mark "Customer Contacted" once complete.</td></tr>
<tr><td style="padding:6px 24px 6px 24px;text-align:center;"><a href="${dashboardLink}" style="display:inline-block;background:#92400e;color:#ffffff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:800;font-size:14px;">Open Staff Dashboard</a><div style="margin-top:10px;font-size:12px;color:#64748b;">If the button doesn't work, copy/paste:<br/><span style="color:#0f172a;">${dashboardLink}</span></div></td></tr>
<tr><td style="padding:16px 24px;background:#0b1220;color:#cbd5e1;font-size:11px;line-height:16px;"><div><strong>Orlando Event Venue</strong></div><div>3847 E Colonial Dr, Orlando, FL 32803</div><div>Orlandoeventvenue@gmail.com | (407) 974-5979</div><div style="margin-top:6px;">orlandoeventvenue.org</div></td></tr>
</table></td></tr></table></body></html>`;
}

function generateEmailHTML(data: StaffAssignmentEmailData): string {
  const firstName = data.staffName.split(" ")[0];
  
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>New Staff Assignment — OEV #${data.reservationNumber}</title>
  <style>
    @media (max-width: 620px) {
      .container { width: 100% !important; }
      .px { padding-left: 16px !important; padding-right: 16px !important; }
      .btn { display:block !important; width:100% !important; }
      .twoCol { width:100% !important; display:block !important; padding-left:0 !important; padding-right:0 !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <!-- Preheader (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    You've been assigned to a booking. Review details in the Staff Portal.
  </div>

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f7f9;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" class="container" width="600" cellspacing="0" cellpadding="0" style="width:600px;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb;">
          <!-- Header -->
          <tr>
            <td class="px" style="padding:22px 24px;background:#0b1220;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <img src="${data.logoUrl}" alt="Orlando Event Venue" height="28" style="display:block;border:0;outline:none;" />
                  </td>
                  <td align="right" style="color:#cbd5e1;font-size:12px;">
                    Staff Assignment Notice
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Badge -->
          <tr>
            <td class="px" style="padding:18px 24px 8px 24px;">
              <span style="display:inline-block;background:#ecfeff;color:#155e75;border:1px solid #a5f3fc;border-radius:999px;padding:6px 10px;font-size:12px;font-weight:800;letter-spacing:.3px;">
                NEW ASSIGNMENT
              </span>
            </td>
          </tr>

          <!-- Title + intro -->
          <tr>
            <td class="px" style="padding:10px 24px 8px 24px;">
              <div style="font-size:20px;line-height:28px;font-weight:800;color:#0f172a;">
                You've been assigned to a booking
              </div>
              <div style="margin-top:8px;font-size:14px;line-height:22px;color:#475569;">
                Hi ${firstName}, an admin has assigned you to the booking below. Please review the details in the Staff Portal.
              </div>
            </td>
          </tr>

          <!-- Details card -->
          <tr>
            <td class="px" style="padding:14px 24px 8px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:12px 14px;background:#f8fafc;font-weight:800;font-size:13px;color:#0f172a;">
                    Assignment details
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 14px;font-size:14px;line-height:22px;color:#334155;">
                    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                      <tr>
                        <td class="twoCol" style="width:50%;padding-right:10px;vertical-align:top;">
                          <div><b>Reservation #:</b> ${data.reservationNumber}</div>
                          <div><b>Event date:</b> ${data.eventDateLong}</div>
                          <div><b>Event time:</b> ${data.eventTimeRange}</div>
                        </td>
                        <td class="twoCol" style="width:50%;padding-left:10px;vertical-align:top;">
                          <div><b>Role:</b> ${data.staffRole}</div>
                          <div><b>Notes:</b> ${data.adminNotes}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Next steps -->
          <tr>
            <td class="px" style="padding:10px 24px 8px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <tr>
                  <td style="padding:12px 14px;background:#f8fafc;font-weight:800;font-size:13px;color:#0f172a;">
                    What to do next
                  </td>
                </tr>
                <tr>
                  <td style="padding:12px 14px;font-size:14px;line-height:22px;color:#334155;">
                    <div style="margin-bottom:6px;">1) Open the Staff Portal to review instructions and any special notes.</div>
                    <div style="margin-bottom:6px;">2) Confirm you can make it.</div>
                    <div>3) On the day of service, use the Staff Portal to view booking details.</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td class="px" style="padding:14px 24px 6px 24px;text-align:center;">
              <a class="btn" href="https://orlandoeventvenue.org/staff"
                 style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:14px 18px;border-radius:12px;font-weight:800;font-size:14px;">
                Open Staff Portal
              </a>
              <div style="margin-top:10px;font-size:12px;line-height:18px;color:#64748b;">
                If the button doesn't work, copy/paste this link:<br/>
                <span style="color:#0f172a;">https://orlandoeventvenue.org/staff</span>
              </div>
            </td>
          </tr>

          <!-- Help box -->
          <tr>
            <td class="px" style="padding:8px 24px 20px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px dashed #cbd5e1;border-radius:12px;">
                <tr>
                  <td style="padding:12px 14px;font-size:13px;line-height:20px;color:#334155;">
                    If you can't make this assignment or you don't have your Staff PIN, reply to this email.
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="px" style="padding:16px 24px;background:#0b1220;color:#cbd5e1;font-size:11px;line-height:16px;">
              <div><strong>Orlando Event Venue Team</strong></div>
              <div style="margin-top:4px;">3847 E Colonial Dr, Orlando, FL 32803</div>
              <div>Orlandoeventvenue@gmail.com | (407) 974-5979</div>
              <div style="margin-top:8px;color:#94a3b8;">This message is for staff only. Please do not forward to clients.</div>
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
    const data: StaffAssignmentEmailData = await req.json();
    console.log("Sending staff assignment email for reservation:", data.reservationNumber);

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

    const isBarVendor = data.staffRole === "Bar Vendor";
    const emailHTML = isBarVendor ? generateBarVendorEmailHTML(data) : generateEmailHTML(data);
    const subject = isBarVendor
      ? `New Bar Service Assignment — ${data.eventDateLong} | Orlando Event Venue`
      : `New Staff Assignment — OEV #${data.reservationNumber}`;
    const fallbackText = isBarVendor
      ? "You have been assigned to a bar service booking. Please view this email in an HTML-compatible client."
      : "You've been assigned to a booking. Please view this email in an HTML-compatible email client.";

    await client.send({
      from: gmailUser,
      to: data.staffEmail,
      subject,
      content: fallbackText,
      html: emailHTML,
    });

    await client.close();

    console.log("Staff assignment email sent successfully to:", data.staffEmail);

    return new Response(
      JSON.stringify({ ok: true, message: "Email sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending staff assignment email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
