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
const KIT_URL = `${WEBSITE_URL}/planning-kit`;
const BOOKING_URL = `${WEBSITE_URL}/book`;
const TOUR_URL = `${WEBSITE_URL}/schedule-tour`;
// Must match COUPON_CODE in src/components/DiscountPopup.tsx and DEFAULT_POPUP_COUPON_CODE in process-discount-drip
const DEFAULT_COUPON_CODE = "PLAN50";

// OEV Lead Magnet spec (ClickUp 8cqnrff-11737): OEV-LM-E01 / E02 / E03.
// No expiration language anywhere until per-contact expiration is enforceable.
const SUBJECT_LINES: Record<number, string> = {
  1: "Your Event Planning Kit + $50 OFF",
  2: "A Quick Note From Luis, and Your Kit",
  3: "Ready to finalize your event?",
};

const PREVIEW_TEXT: Record<number, string> = {
  1: "Your planning checklist and PLAN50 are ready.",
  2: "A few helpful venue details and a simple way to see the space.",
  3: "Use the kit to plan clearly, then hold your date when you are ready.",
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

/* ---------- Shared template pieces ---------- */

function emailShell(title: string, preview: string, headerHtml: string, bodyHtml: string): string {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,Helvetica,sans-serif;color:#111827;"><span style="display:none;font-size:1px;color:#F3F4F6;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">${preview}</span><div style="max-width:600px;margin:20px auto;background:#FFFFFF;padding:0;border:1px solid #E5E7EB;border-radius:14px;overflow:hidden;box-shadow:0 10px 24px rgba(17,24,39,.10);"><div style="background:#0B0F19;padding:34px 28px;text-align:center;color:#FFFFFF;">${headerHtml}</div><div style="padding:28px;">${bodyHtml}</div><div style="padding:18px 26px;background:#F9FAFB;font-size:11px;color:#6B7280;border-top:1px solid #E5E7EB;"><p style="margin:0;font-weight:bold;color:#111827;">Orlando Event Venue Team</p><p style="margin:6px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p><p style="margin:6px 0 0;">orlandoeventvenue@gmail.com</p><p style="margin:6px 0 0;">407 974 5979</p><p style="margin:10px 0 0;">This is an automated email. Please keep it for your records.</p></div></div></body></html>`;
}

function primaryButton(text: string, url: string): string {
  return `<div style="text-align:center;margin:18px 0 8px;"><a href="${url}" style="display:inline-block;background:#14ADE6;color:#0B0F19;text-decoration:none;padding:14px 34px;border-radius:10px;font-size:16px;font-weight:bold;letter-spacing:.2px;">${text}</a></div>`;
}

function secondaryButton(text: string, url: string): string {
  return `<div style="text-align:center;margin:12px 0 4px;"><a href="${url}" style="display:inline-block;background:#FFFFFF;color:#0B0F19;text-decoration:none;padding:13px 30px;border:2px solid #14ADE6;border-radius:10px;font-size:15px;font-weight:bold;letter-spacing:.2px;">${text}</a></div>`;
}

function plan50Box(couponCode: string): string {
  const safe = escapeHtml(couponCode);
  return `<div style="background:#FFFFFF;border:1px dashed rgba(20,173,230,.55);border-radius:12px;padding:18px;text-align:center;margin:18px 0;"><p style="margin:0 0 8px;font-size:12px;color:#6B7280;text-transform:uppercase;letter-spacing:1px;font-weight:bold;">Your Code</p><p style="margin:0;font-size:34px;font-weight:800;color:#0B0F19;letter-spacing:3px;">${safe}</p><p style="margin:8px 0 0;font-size:13px;color:#6B7280;">$50 OFF your venue rental</p><p style="margin:4px 0 0;font-size:12px;color:#6B7280;">Enter the code during checkout</p></div>`;
}

function fallbackLinks(urls: string[]): string {
  const lines = urls.map((u) => `<span style="word-break:break-all;color:#14ADE6;">${u}</span>`).join("<br>");
  return `<p style="margin:10px 0 0;font-size:12px;line-height:1.45;color:#6B7280;text-align:center;">If the buttons don't work, copy and paste these links into your browser:<br>${lines}</p>`;
}

const P = `margin:12px 0 0;font-size:15px;line-height:1.65;color:#374151;`;

function signature(full: boolean): string {
  const extra = full
    ? `<br>orlandoeventvenue@gmail.com<br>3847 E Colonial Dr, Orlando, FL 32803`
    : "";
  return `<p style="margin:24px 0 0;font-size:14px;line-height:1.6;color:#374151;">Luis and the Orlando Event Venue Team<br><strong>407 974 5979</strong><br><span style="color:#14ADE6;">orlandoeventvenue.org</span>${extra}</p>`;
}

/* ---------- OEV-LM-E01 — immediate ---------- */

function generateEmail1HTML(firstName: string, couponCode: string): string {
  const header = `<h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">Your Event Planning Kit + <span style="color:#14ADE6;">$50 OFF</span></h1><p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">Orlando Event Venue</p>`;
  const body = `<p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p>` +
    `<p style="${P}">Welcome, and thank you. Your Event Planning Kit is ready.</p>` +
    `<p style="${P}">We are a local nonprofit venue built for events of up to 90 guests. The kit covers your planning timeline, budget, room layout, and the small things hosts often forget, including serving spoons, ice, and extra trash bags.</p>` +
    `<p style="${P}"><strong>Open your kit here:</strong></p>` +
    primaryButton("Open Your Event Planning Kit", KIT_URL) +
    `<p style="${P}">You will also receive <strong>PLAN50</strong>:</p>` +
    plan50Box(couponCode) +
    `<p style="${P}">When you are ready to hold your date, begin here: <a href="${BOOKING_URL}" style="color:#14ADE6;font-weight:bold;text-decoration:none;">Begin Your Booking</a></p>` +
    `<p style="${P}">Your date is held after the first 50 percent is received. Our team will then review the timing, guest count, and setup before sending a separate confirmation.</p>` +
    fallbackLinks([KIT_URL, BOOKING_URL]) +
    `<p style="${P}">Questions? Reply to this email or call or text <strong>407 974 5979</strong>.</p>` +
    signature(true);
  return emailShell(SUBJECT_LINES[1], PREVIEW_TEXT[1], header, body);
}

/* ---------- OEV-LM-E02 — 8AM next day (18h drip) ---------- */

function generateEmail2HTML(firstName: string, couponCode: string): string {
  const header = `<h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">A Quick Note From Luis, and Your Kit</h1><p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">Orlando Event Venue</p>`;
  const body = `<p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p>` +
    `<p style="${P}">Luis here. I hope the Event Planning Kit is helping you get organized.</p>` +
    `<p style="${P}">If you have not opened it yet, you can find it here: <a href="${KIT_URL}" style="color:#14ADE6;font-weight:bold;text-decoration:none;">Review Your Event Planning Kit</a></p>` +
    `<p style="${P}"><strong>Here are a few venue details to keep in mind:</strong></p>` +
    `<ul style="margin:10px 0 0;padding-left:20px;font-size:14px;line-height:1.65;color:#374151;"><li>You may choose your own caterer. Professional caterers must provide proof of insurance. The prep kitchen is for staging and reheating, not cooking.</li><li>Free parking is available in the Colonial Town Center plaza.</li><li>The room holds up to 90 guests and includes 10 tables and 90 chairs.</li></ul>` +
    `<p style="${P}"><strong>Would you like to see the space before deciding?</strong></p>` +
    primaryButton("Book a Tour", TOUR_URL) +
    `<p style="${P}"><strong>Already know your date?</strong> Begin your booking here:</p>` +
    secondaryButton("Begin Your Booking", BOOKING_URL) +
    `<p style="${P}">Your date is held after the first 50 percent is received. Our team will then review the timing, guest count, and setup before sending a separate confirmation.</p>` +
    plan50Box(couponCode) +
    fallbackLinks([TOUR_URL, BOOKING_URL, KIT_URL]) +
    `<p style="${P}">Reply any time with questions. We are happy to help.</p>` +
    signature(false);
  return emailShell(SUBJECT_LINES[2], PREVIEW_TEXT[2], header, body);
}

/* ---------- OEV-LM-E03 — 36h after submission ---------- */

function generateEmail3HTML(firstName: string, couponCode: string): string {
  const header = `<h1 style="margin:0;font-size:24px;letter-spacing:.3px;line-height:1.25;">Ready to finalize your event?</h1><p style="margin:10px 0 0;font-size:14px;line-height:1.5;color:rgba(255,255,255,.78);">Orlando Event Venue</p>`;
  const body = `<p style="margin:0;font-size:16px;">Hi <strong>${firstName}</strong>,</p>` +
    `<p style="${P}">Just checking in.</p>` +
    `<p style="${P}">The Event Planning Kit covers the details hosts need to understand before the event, including the venue rules, planning timeline, room layout, and what to bring.</p>` +
    `<p style="${P}">When you are ready, the first 50 percent of payment holds your date. Our team will then review and send a separate confirmation.</p>` +
    `<p style="${P}">The remaining balance is due 15 days before the event.</p>` +
    primaryButton("Begin Your Booking", BOOKING_URL) +
    `<p style="${P}"><strong>Would you prefer to see the space first?</strong></p>` +
    secondaryButton("Book a Tour", TOUR_URL) +
    `<p style="${P}">You can also review your Event Planning Kit here: <a href="${KIT_URL}" style="color:#14ADE6;font-weight:bold;text-decoration:none;">Review Your Event Planning Kit</a></p>` +
    plan50Box(couponCode) +
    fallbackLinks([BOOKING_URL, TOUR_URL, KIT_URL]) +
    `<p style="${P}">Prefer to talk it through? Reply to this email or call or text me at <strong>407 974 5979</strong>.</p>` +
    signature(false);
  return emailShell(SUBJECT_LINES[3], PREVIEW_TEXT[3], header, body);
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
    console.log(`Sending kit email #${emailNumber} to: ${data.email} (coupon: ${couponCode})`);

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

    const firstName = escapeHtml(data.full_name.split(" ")[0]);
    const emailHTML = EMAIL_GENERATORS[emailNumber](firstName, couponCode);
    const subject = SUBJECT_LINES[emailNumber];

    await client.send({
      from: gmailUser,
      to: data.email,
      subject,
      content: "Your Event Planning Kit from Orlando Event Venue. View this email in an HTML-compatible client.",
      html: emailHTML,
    });

    await client.close();
    console.log(`Kit email #${emailNumber} sent successfully to: ${data.email}`);

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
      JSON.stringify({ ok: true, message: `Kit email #${emailNumber} sent successfully` }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending kit email:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
