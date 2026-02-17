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

const WEBSITE_URL = "https://orlandoeventvenue.com";

const SUBJECT_LINES: Record<number, string> = {
  1: "Here's Your $50 Discount Code! | Orlando Event Venue",
  2: "Dates Are Booking Quickly! | Orlando Event Venue",
  3: "Last Chance to Use Your $50 Discount! | Orlando Event Venue",
};

const SENT_AT_COLUMNS: Record<number, string> = {
  1: "email_1_sent_at",
  2: "email_2_sent_at",
  3: "email_3_sent_at",
};

function generateEmail1HTML(firstName: string, couponCode: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#111827;padding:40px 30px;text-align:center;color:white;">
  <h1 style="margin:0;font-size:28px;letter-spacing:1px;">YOUR $50 DISCOUNT</h1>
  <p style="margin:12px 0 0;font-size:16px;color:#d4d4d8;">Orlando Event Venue</p>
</div>

<div style="padding:30px;">

<p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;font-size:15px;line-height:1.6;">
As promised, here's your <strong>$50 discount code</strong>:
</p>

<div style="background:#f9fafb;border:2px dashed #d97706;border-radius:8px;padding:24px;text-align:center;margin:25px 0;">
  <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:1px;">Your Discount Code</p>
  <p style="margin:0;font-size:32px;font-weight:bold;color:#111827;letter-spacing:3px;">${couponCode}</p>
  <p style="margin:8px 0 0;font-size:13px;color:#666;">$50 off your base rental</p>
</div>

<p style="margin:20px 0;font-size:15px;line-height:1.6;">
Use this code at checkout to save $50 on your reservation. Don't wait too long — our calendar is filling up fast! We cannot reserve dates for you.
</p>

<div style="text-align:center;margin:30px 0;">
  <a href="${WEBSITE_URL}/book" style="display:inline-block;background:#d97706;color:white;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Book Now</a>
</div>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;line-height:1.6;">
Best regards,
</p>

<p style="margin:10px 0 0;"><strong>Orlando Event Venue</strong></p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email. Please keep it for your records.</p>
</div>

</div>
</body>
</html>`;
}

function generateEmail2HTML(firstName: string, couponCode: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#111827;padding:40px 30px;text-align:center;color:white;">
  <h1 style="margin:0;font-size:28px;letter-spacing:1px;">DON'T MISS OUT</h1>
  <p style="margin:12px 0 0;font-size:16px;color:#d4d4d8;">Orlando Event Venue</p>
</div>

<div style="padding:30px;">

<p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;font-size:15px;line-height:1.6;">
We noticed you haven't used your <strong>$50 discount code</strong> yet. Just a friendly reminder that our event dates are filling up fast!
</p>

<p style="margin:15px 0;font-size:15px;line-height:1.6;">
Use your code soon to lock in your preferred date:
</p>

<div style="background:#f9fafb;border:2px dashed #d97706;border-radius:8px;padding:24px;text-align:center;margin:25px 0;">
  <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:1px;">Your Discount Code</p>
  <p style="margin:0;font-size:32px;font-weight:bold;color:#111827;letter-spacing:3px;">${couponCode}</p>
  <p style="margin:8px 0 0;font-size:13px;color:#666;">$50 off your base rental</p>
</div>

<p style="margin:20px 0;font-size:15px;line-height:1.6;">
We'd love to help make your event unforgettable.
</p>

<div style="text-align:center;margin:30px 0;">
  <a href="${WEBSITE_URL}/book" style="display:inline-block;background:#d97706;color:white;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Secure Your Date</a>
</div>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;line-height:1.6;">
Best,
</p>

<p style="margin:10px 0 0;"><strong>Orlando Event Venue</strong></p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email. Please keep it for your records.</p>
</div>

</div>
</body>
</html>`;
}

function generateEmail3HTML(firstName: string, couponCode: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#111827;padding:40px 30px;text-align:center;color:white;">
  <h1 style="margin:0;font-size:28px;letter-spacing:1px;">LAST CHANCE</h1>
  <p style="margin:12px 0 0;font-size:16px;color:#d4d4d8;">Orlando Event Venue</p>
</div>

<div style="padding:30px;">

<p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;font-size:15px;line-height:1.6;">
This is your final reminder to use your <strong>$50 discount code</strong> before it expires.
</p>

<div style="background:#f9fafb;border:2px dashed #d97706;border-radius:8px;padding:24px;text-align:center;margin:25px 0;">
  <p style="margin:0 0 8px;font-size:13px;color:#666;text-transform:uppercase;letter-spacing:1px;">Your Discount Code</p>
  <p style="margin:0;font-size:32px;font-weight:bold;color:#111827;letter-spacing:3px;">${couponCode}</p>
  <p style="margin:8px 0 0;font-size:13px;color:#666;">$50 off your base rental</p>
</div>

<p style="margin:20px 0;font-size:15px;line-height:1.6;">
Don't miss out on securing your event date and saving $50 in your pocket.
</p>

<div style="text-align:center;margin:30px 0;">
  <a href="${WEBSITE_URL}/book" style="display:inline-block;background:#d97706;color:white;text-decoration:none;padding:14px 40px;border-radius:6px;font-size:16px;font-weight:bold;letter-spacing:0.5px;">Book Now & Save $50</a>
</div>

<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;line-height:1.6;">
Looking forward to hosting you,
</p>

<p style="margin:10px 0 0;"><strong>Orlando Event Venue</strong></p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email. Please keep it for your records.</p>
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
