import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DiscountEmailData {
  full_name: string;
  email: string;
  coupon_code: string;
  email_number: 1 | 2 | 3;
}

const WEBSITE_URL = "https://orlandoeventvenue.org";

const SUBJECT_LINES: Record<number, string> = {
  1: "Your $100 Event Booking Credit Is Here | Orlando Event Venue",
  2: "Reserve Your Date + Use Your $100 Booking Credit | Orlando Event Venue",
  3: "Final Reminder: Reserve Your Date + Apply Your $100 Credit | Orlando Event Venue",
};

const SENT_AT_COLUMNS: Record<number, string> = {
  1: "email_1_sent_at",
  2: "email_2_sent_at",
  3: "email_3_sent_at",
};

function generateEmail1HTML(firstName: string, _couponCode: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your $100 Event Booking Credit Is Here | Orlando Event Venue</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);">
    <div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">
      <h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">
        Your <span style="color:#14ADE6;">$100</span> Event Booking Credit Is Here
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
        As promised, here is your <strong>$100 Event Booking Credit</strong> for Orlando Event Venue.
      </p>
      <div style="background:#FFFFFF;border:1px dashed rgba(20,173,230,.55);border-radius:12px;padding:18px;text-align:center;margin:18px 0;">
        <p style="margin:0 0 8px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Your Booking Credit Code
        </p>
        <p style="margin:0;font-size:34px;font-weight:800;color:#0B0F19;letter-spacing:3px;">
          SAVE100
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#6B7280;">
          $100 off your base rental
        </p>
      </div>
      <p style="margin:0;font-size:15px;line-height:1.65;color:#374151;">
        You can apply this credit when you reserve your event date.
      </p>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        If you already know your date, the next step is simple:
        <strong>Reserve your venue here:</strong>
      </p>
      <div style="text-align:center;margin:18px 0 8px;">
        <a href="https://orlandoeventvenue.org/book"
           style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">
          Reserve Your Date
        </a>
      </div>
      <p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <span style="word-break:break-all;color:#14ADE6;">https://orlandoeventvenue.org/book</span>
      </p>
      <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E7EB;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
          We can't hold dates without a reservation, so if you have a date in mind, reserve it now and apply your credit at booking.
        </p>
      </div>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">
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
      <p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p>
    </div>
  </div>
</body>
</html>`;
}

function generateEmail2HTML(firstName: string, _couponCode: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Your $100 Event Booking Credit Is Still Available | Orlando Event Venue</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);">
    <div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">
      <h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">
        Your <span style="color:#14ADE6;">$100</span> Credit Is Still Available
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
        We noticed you haven't reserved your date yet.
      </p>
      <p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        Your <strong>$100 Event Booking Credit</strong> is still available, and if you already have a date in mind, the best next step is to book now.
      </p>
      <div style="background:#FFFFFF;border:1px dashed rgba(20,173,230,.55);border-radius:12px;padding:18px;text-align:center;margin:18px 0;">
        <p style="margin:0 0 8px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Your Booking Credit Code
        </p>
        <p style="margin:0;font-size:34px;font-weight:800;color:#0B0F19;letter-spacing:3px;">
          SAVE100
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#6B7280;">
          $100 off your base rental
        </p>
      </div>
      <p style="margin:0;font-size:15px;line-height:1.65;color:#374151;">
        We can't hold dates without a reservation, and our calendar continues to fill.
      </p>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">
        <strong>Reserve your date here:</strong>
      </p>
      <div style="text-align:center;margin:18px 0 8px;">
        <a href="https://orlandoeventvenue.org/book"
           style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">
          Reserve Your Date
        </a>
      </div>
      <p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <span style="word-break:break-all;color:#14ADE6;">https://orlandoeventvenue.org/book</span>
      </p>
      <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E7EB;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
          If you're ready to move forward, reserve now and apply your credit at booking.
        </p>
      </div>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">
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
      <p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p>
    </div>
  </div>
</body>
</html>`;
}

function generateEmail3HTML(firstName: string, _couponCode: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Final Reminder: Use Your $100 Event Booking Credit | Orlando Event Venue</title>
</head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);">
    <div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">
      <h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">
        Final Reminder: <span style="color:#14ADE6;">$100</span> Booking Credit
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
        This is your final reminder to reserve your date and apply your <strong>$100 Event Booking Credit</strong> at booking.
      </p>
      <div style="background:#FFFFFF;border:1px dashed rgba(20,173,230,.55);border-radius:12px;padding:18px;text-align:center;margin:18px 0;">
        <p style="margin:0 0 8px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">
          Your Booking Credit Code
        </p>
        <p style="margin:0;font-size:34px;font-weight:800;color:#0B0F19;letter-spacing:3px;">
          SAVE100
        </p>
        <p style="margin:8px 0 0;font-size:13px;color:#6B7280;">
          $100 off your base rental
        </p>
      </div>
      <p style="margin:0;font-size:15px;line-height:1.65;color:#374151;">
        If you're ready to move forward, reserve your event date now:
      </p>
      <div style="text-align:center;margin:18px 0 8px;">
        <a href="https://orlandoeventvenue.org/book"
           style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">
          Reserve Your Date
        </a>
      </div>
      <p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">
        If the button doesn't work, copy and paste this link into your browser:<br>
        <span style="word-break:break-all;color:#14ADE6;">https://orlandoeventvenue.org/book</span>
      </p>
      <div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E7EB;">
        <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
          If you already have your date in mind, don't wait. We can't hold dates without a reservation.
        </p>
      </div>
      <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">
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
      <p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p>
    </div>
  </div>
</body>
</html>`;
}

const EMAIL_GENERATORS: Record<number, (firstName: string, couponCode: string) => string> = {
  1: generateEmail1HTML,
  2: generateEmail2HTML,
  3: generateEmail3HTML,
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: DiscountEmailData = await req.json();
    const emailNumber = data.email_number || 1;
    console.log(`Sending discount email #${emailNumber} to: ${data.email}`);

    if (!data.email || !data.full_name || !data.coupon_code) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields: full_name, email, coupon_code" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (![1, 2, 3].includes(emailNumber)) {
      return new Response(
        JSON.stringify({ ok: false, error: "email_number must be 1, 2, or 3" }),
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
        auth: { username: gmailUser, password: gmailPassword },
      },
    });

    const firstName = data.full_name.split(" ")[0];
    const emailHTML = EMAIL_GENERATORS[emailNumber](firstName, data.coupon_code);
    const subject = SUBJECT_LINES[emailNumber];

    await client.send({
      from: gmailUser,
      to: data.email,
      subject,
      content: "Your discount code from Orlando Event Venue. View this email in an HTML-compatible client.",
      html: emailHTML,
    });

    await client.close();
    console.log(`Discount email #${emailNumber} sent successfully to: ${data.email}`);

    // Update the corresponding sent_at column in popup_leads
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      const sentAtColumn = SENT_AT_COLUMNS[emailNumber];
      const { error: updateError } = await supabase
        .from("popup_leads")
        .update({ [sentAtColumn]: new Date().toISOString() })
        .eq("email", data.email.toLowerCase())
        .is(sentAtColumn, null);

      if (updateError) {
        console.error(`Error updating ${sentAtColumn} for ${data.email}:`, updateError);
      } else {
        console.log(`Updated ${sentAtColumn} for ${data.email}`);
      }
    } catch (dbError) {
      console.error("Error updating popup_leads timestamp:", dbError);
    }

    return new Response(
      JSON.stringify({ ok: true, message: `Discount email #${emailNumber} sent successfully` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending discount email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
