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
// Must match COUPON_CODE in src/components/DiscountPopup.tsx and DEFAULT_POPUP_COUPON_CODE in process-discount-drip
const DEFAULT_COUPON_CODE = "HOST100";

const SUBJECT_LINES: Record<number, string> = {
  1: "Your $100 OEV Credit Is Here | Apply It at Booking",
  2: "Quick note from Luis (your $100 still works)",
  3: "Last call on your $100 + a real heads-up on the calendar",
};

const SENT_AT_COLUMNS: Record<number, string> = {
  1: "email_1_sent_at",
  2: "email_2_sent_at",
  3: "email_3_sent_at",
};

/** Escape user-supplied text for safe insertion into HTML */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function generateEmail1HTML(firstName: string, couponCode: string): string {
  const safe = escapeHtml(couponCode);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Your $100 OEV Credit Is Here | Apply It at Booking</title></head><body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;"><span style="display:none;font-size:1px;color:#F3F4F6;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Code ${safe}. Good 7 days. Here's what it unlocks.</span><div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);"><div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;"><h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">Your <span style="color:#14ADE6;">$100</span> OEV Credit Is Here</h1><p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">Orlando Event Venue</p></div><div style="padding:28px;"><p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p><p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">Welcome! Happy you're here.</p><p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">We're a local non-profit venue on Colonial Drive, built for corporate events, workshops, and gatherings up to 90 guests.</p><p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">The <strong>$100</strong> you just unlocked applies at booking, on top of what's already included.</p><div style="background:#FFFFFF;border:1px dashed rgba(20,173,230,.55);border-radius:12px;padding:18px;text-align:center;margin:18px 0;"><p style="margin:0 0 8px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">Your Booking Credit Code</p><p style="margin:0;font-size:34px;font-weight:800;color:#0B0F19;letter-spacing:3px;">${safe}</p><p style="margin:8px 0 0;font-size:13px;color:#6B7280;">$100 off your base rental</p><p style="margin:4px 0 0;font-size:12px;color:#6B7280;">Good for 7 days. Apply at checkout</p></div><p style="margin:0;font-size:15px;line-height:1.65;color:#374151;"><strong>Reserve your date here:</strong></p><div style="text-align:center;margin:18px 0 8px;"><a href="https://orlandoeventvenue.org/book" style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">Reserve Your Date</a></div><p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">If the button doesn't work, copy and paste this link into your browser:<br><span style="word-break:break-all;color:#14ADE6;">https://orlandoeventvenue.org/book</span></p><div style="margin-top:18px;padding-top:18px;border-top:1px solid #E5E7EB;"><p style="margin:0;font-size:15px;line-height:1.65;color:#111827;font-weight:bold;">What's included with every rental</p><ul style="margin:10px 0 0;padding-left:20px;font-size:14px;line-height:1.65;color:#374151;"><li>Up to 90 guests + 10 tables + 90 chairs</li><li>Prep kitchen for caterers (zero restrictions: bring any caterer you want)</li><li>Free parking: 200+ spots in the Colonial Town Center plaza</li><li>Wall-sized LED stage screen + AV (available via package)</li><li>Bar service available through us if your event needs it</li></ul></div><div style="margin-top:18px;padding:14px 16px;background:#F9FAFB;border:1px solid #E5E7EB;border-radius:10px;"><p style="margin:0;font-size:14px;line-height:1.6;color:#374151;"><strong>Heads-up:</strong> open dates aren't actually held until 50% lock-in goes through. If you have a date in mind, locking it in this week is the safest move.</p></div><p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">Questions? Reply to this email, or call/text <strong>407-974-5979</strong>.</p><p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#374151;">Luis with the Orlando Event Venue Team<br><strong>407-974-5979</strong><br><span style="color:#14ADE6;">orlandoeventvenue.org</span><br>orlandoeventvenue@gmail.com<br>3847 E Colonial Dr, Orlando, FL 32803</p></div><div style="padding:18px 26px;background:#F9FAFB;font-size:11px;color:#6B7280;border-top:1px solid #E5E7EB;"><p style="margin:0;font-weight:bold;color:#111827;">Orlando Event Venue Team</p><p style="margin:6px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p><p style="margin:6px 0 0;">orlandoeventvenue@gmail.com</p><p style="margin:6px 0 0;">(407) 974-5979</p><p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p></div></div></body></html>`;
}

function generateEmail2HTML(firstName: string, couponCode: string): string {
  const safe = escapeHtml(couponCode);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Quick note from Luis: your $100 still works</title></head><body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;"><span style="display:none;font-size:1px;color:#F3F4F6;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">What past hosts liked. Plus: want to see the venue first?</span><div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);"><div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;"><h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">Your <span style="color:#14ADE6;">$100</span> Still Works</h1><p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">Quick note from Luis · Orlando Event Venue</p></div><div style="padding:28px;"><p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p><p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">Quick note from Luis at Orlando Event Venue.</p><p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">Most planners take a few days at this stage, which is totally normal. While you're deciding, a few things worth knowing:</p><div style="margin-top:18px;"><p style="margin:0;font-size:15px;line-height:1.65;color:#111827;font-weight:bold;">What past hosts have told us they liked</p><ul style="margin:10px 0 0;padding-left:20px;font-size:14px;line-height:1.65;color:#374151;"><li><strong>Catering is wide open.</strong> No preferred-vendor list, no restrictions. Bring whoever you want.</li><li><strong>Free parking</strong>, 200+ spots, no garage fees.</li><li>We're a <strong>non-profit</strong>, so weekday non-profit bookings get 50% off the base rental (text us if interested).</li></ul></div><div style="background:#FFFFFF;border:1px dashed rgba(20,173,230,.55);border-radius:12px;padding:18px;text-align:center;margin:18px 0;"><p style="margin:0 0 8px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">Your Booking Credit Code</p><p style="margin:0;font-size:34px;font-weight:800;color:#0B0F19;letter-spacing:3px;">${safe}</p><p style="margin:8px 0 0;font-size:13px;color:#6B7280;">$100 off your base rental, good for 7 days</p></div><div style="margin-top:6px;"><p style="margin:0;font-size:15px;line-height:1.65;color:#111827;font-weight:bold;">Two simple next steps</p><p style="margin:10px 0 0;font-size:15px;line-height:1.65;color:#374151;"><strong>1. Want to see the space first?</strong> Find a day/time that works and book a quick tour online.</p><div style="text-align:center;margin:12px 0 4px;"><a href="https://orlandoeventvenue.org/schedule-tour" style="display:inline-block;background:#FFFFFF;color:#0B0F19;text-decoration:none;padding:13px 30px;border:2px solid #14ADE6;border-radius:10px;font-size:15px;font-weight:bold;letter-spacing:.2px;">Book a Quick Tour</a></div><p style="margin:18px 0 0;font-size:15px;line-height:1.65;color:#374151;"><strong>2. Already know your date?</strong> Lock it in here: 50% holds the date.</p><div style="text-align:center;margin:12px 0 8px;"><a href="https://orlandoeventvenue.org/book" style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">Reserve Your Date</a></div><p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">If the buttons don't work, copy and paste these links into your browser:<br><span style="word-break:break-all;color:#14ADE6;">https://orlandoeventvenue.org/schedule-tour</span><br><span style="word-break:break-all;color:#14ADE6;">https://orlandoeventvenue.org/book</span></p></div><p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#374151;">Luis &amp; the OEV Team<br><strong>407-974-5979</strong><br><span style="color:#14ADE6;">orlandoeventvenue.org</span></p></div><div style="padding:18px 26px;background:#F9FAFB;font-size:11px;color:#6B7280;border-top:1px solid #E5E7EB;"><p style="margin:0;font-weight:bold;color:#111827;">Orlando Event Venue Team</p><p style="margin:6px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p><p style="margin:6px 0 0;">orlandoeventvenue@gmail.com</p><p style="margin:6px 0 0;">(407) 974-5979</p><p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p></div></div></body></html>`;
}

function generateEmail3HTML(firstName: string, couponCode: string): string {
  const safe = escapeHtml(couponCode);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Last call on your $100 + a real heads-up on the calendar</title></head><body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;"><span style="display:none;font-size:1px;color:#F3F4F6;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">Where we are on bookings + the simplest path to lock your date.</span><div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);"><div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;"><h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">Last Call on Your <span style="color:#14ADE6;">$100</span></h1><p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">A real heads-up on the calendar · Orlando Event Venue</p></div><div style="padding:28px;"><p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>!</p><p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:#374151;">Last reminder I'll send on your <strong>$100 credit</strong>.</p><p style="margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;">A real calendar note: we're <strong>booked through the next month</strong>. Open dates in the following month are filling up. If you have a date in mind, this is the right window to lock it in.</p><div style="background:#FFFFFF;border:1px dashed rgba(20,173,230,.55);border-radius:12px;padding:18px;text-align:center;margin:18px 0;"><p style="margin:0 0 8px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">Your Booking Credit Code</p><p style="margin:0;font-size:34px;font-weight:800;color:#0B0F19;letter-spacing:3px;">${safe}</p><p style="margin:8px 0 0;font-size:13px;color:#6B7280;">$100 off your base rental, good for 7 days</p></div><div style="margin-top:6px;"><p style="margin:0;font-size:15px;line-height:1.65;color:#111827;font-weight:bold;">Two ways forward</p><p style="margin:10px 0 0;font-size:15px;line-height:1.65;color:#374151;"><strong>1. Reserve your date directly.</strong> 50% holds the date.</p><div style="text-align:center;margin:12px 0 4px;"><a href="https://orlandoeventvenue.org/book" style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">Reserve Your Date</a></div><p style="margin:18px 0 0;font-size:15px;line-height:1.65;color:#374151;"><strong>2. Call or text me at 407-974-5979</strong> and I'll walk you through it.</p><div style="text-align:center;margin:12px 0 8px;"><a href="tel:+14079745979" style="display:inline-block;background:#FFFFFF;color:#0B0F19;text-decoration:none;padding:13px 30px;border:2px solid #14ADE6;border-radius:10px;font-size:15px;font-weight:bold;letter-spacing:.2px;">Call or Text 407-974-5979</a></div><p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">If the button doesn't work, copy and paste this link into your browser:<br><span style="word-break:break-all;color:#14ADE6;">https://orlandoeventvenue.org/book</span></p></div><p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#374151;">Luis &amp; the OEV Team<br><strong>407-974-5979</strong><br><span style="color:#14ADE6;">orlandoeventvenue.org</span></p></div><div style="padding:18px 26px;background:#F9FAFB;font-size:11px;color:#6B7280;border-top:1px solid #E5E7EB;"><p style="margin:0;font-weight:bold;color:#111827;">Orlando Event Venue Team</p><p style="margin:6px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p><p style="margin:6px 0 0;">orlandoeventvenue@gmail.com</p><p style="margin:6px 0 0;">(407) 974-5979</p><p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p></div></div></body></html>`;
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
    const couponCode = data.coupon_code || DEFAULT_COUPON_CODE;
    console.log(`Sending discount email #${emailNumber} to: ${data.email} (coupon: ${couponCode})`);

    if (!data.email || !data.full_name) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields: full_name, email" }),
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
    const emailHTML = EMAIL_GENERATORS[emailNumber](firstName, couponCode);
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