import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  BRAND,
  P,
  displayTitle,
  emailShell,
  escapeHtml,
  fallbackLinks,
  gap,
  heroModule,
  primaryButton,
  sanitizeForSmtp,
  secondaryButton,
  signature,
  textModule,
  ticket,
} from "../_shared/email-layout.ts";

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

/* ---------- Shared template pieces ---------- */

/** PLAN50 dashed ticket — the code the guest types at checkout */
function plan50Ticket(couponCode: string): string {
  return ticket(
    "Your Code",
    escapeHtml(couponCode),
    "$50 OFF your venue rental<br>Enter the code during checkout",
  );
}

/* ---------- OEV-LM-E01 — immediate ---------- */

function generateEmail1HTML(firstName: string, couponCode: string): string {
  const body =
    heroModule({
      display: displayTitle("Your Event Planning Kit + $50 OFF", { size: 30 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
        `<p style="${P}">Welcome, and thank you. Your Event Planning Kit is ready.</p>` +
        `<p style="${P}">We are a local nonprofit venue built for events of up to 90 guests. The kit covers your planning timeline, budget, room layout, and the small things hosts often forget, including serving spoons, ice, and extra trash bags.</p>` +
        `<p style="${P}">Open your kit here:</p>` +
        primaryButton("Open Your Event Planning Kit", KIT_URL) +
        `<p style="${P}">You will also receive <strong>PLAN50</strong>:</p>` +
        plan50Ticket(couponCode) +
        `<p style="${P}">When you are ready to hold your date, begin here: <a href="${BOOKING_URL}" style="color:${BRAND.accent};font-weight:bold;text-decoration:none;">Begin Your Booking</a></p>` +
        `<p style="${P}">Your date is held after the first 50 percent is received. Our team will then review the timing, guest count, and setup before sending a separate confirmation.</p>` +
        fallbackLinks([KIT_URL, BOOKING_URL]) +
        `<p style="${P}">Questions? Reply to this email or call or text <strong>407 974 5979</strong>.</p>` +
        signature({ phone: true, site: true, email: true, address: true }),
    );
  return emailShell({
    title: SUBJECT_LINES[1],
    preview: PREVIEW_TEXT[1],
    body,
  });
}

/* ---------- OEV-LM-E02 — 8AM next day (18h drip) ---------- */

function generateEmail2HTML(firstName: string, couponCode: string): string {
  const body =
    heroModule({
      display: displayTitle("A Quick Note From Luis, and Your Kit", { size: 26 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
        `<p style="${P}">Luis here. I hope the Event Planning Kit is helping you get organized.</p>` +
        `<p style="${P}">If you have not opened it yet, you can find it here: <a href="${KIT_URL}" style="color:${BRAND.accent};font-weight:bold;text-decoration:none;">Review Your Event Planning Kit</a></p>` +
        `<p style="${P}"><strong>Here are a few venue details to keep in mind:</strong></p>` +
        `<ul style="margin:10px 0 0;padding-left:20px;font-size:14px;line-height:1.65;color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;"><li>You may choose your own caterer. Professional caterers must provide proof of insurance. The prep kitchen is for staging and reheating, not cooking.</li><li>Free parking is available in the Colonial Town Center plaza.</li><li>The room holds up to 90 guests and includes 10 tables and 90 chairs.</li></ul>` +
        `<p style="${P}"><strong>Would you like to see the space before deciding?</strong></p>` +
        primaryButton("Book a Tour", TOUR_URL) +
        `<p style="${P}"><strong>Already know your date?</strong> Begin your booking here:</p>` +
        secondaryButton("Begin Your Booking", BOOKING_URL) +
        `<p style="${P}">Your date is held after the first 50 percent is received. Our team will then review the timing, guest count, and setup before sending a separate confirmation.</p>` +
        plan50Ticket(couponCode) +
        fallbackLinks([TOUR_URL, BOOKING_URL, KIT_URL]) +
        `<p style="${P}">Reply any time with questions. We are happy to help.</p>` +
        signature({ phone: true, site: true }),
    );
  return emailShell({
    title: SUBJECT_LINES[2],
    preview: PREVIEW_TEXT[2],
    body,
  });
}

/* ---------- OEV-LM-E03 — 36h after submission ---------- */

function generateEmail3HTML(firstName: string, couponCode: string): string {
  const body =
    heroModule({
      display: displayTitle("Ready to finalize your event?", { size: 30 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
        `<p style="${P}">Just checking in.</p>` +
        `<p style="${P}">The Event Planning Kit covers the details hosts need to understand before the event, including the venue rules, planning timeline, room layout, and what to bring.</p>` +
        `<p style="${P}">When you are ready, the first 50 percent of payment holds your date. Our team will then review and send a separate confirmation.</p>` +
        `<p style="${P}">The remaining balance is due 15 days before the event.</p>` +
        primaryButton("Begin Your Booking", BOOKING_URL) +
        `<p style="${P}"><strong>Would you prefer to see the space first?</strong></p>` +
        secondaryButton("Book a Tour", TOUR_URL) +
        `<p style="${P}">You can also review your Event Planning Kit here: <a href="${KIT_URL}" style="color:${BRAND.accent};font-weight:bold;text-decoration:none;">Review Your Event Planning Kit</a></p>` +
        plan50Ticket(couponCode) +
        fallbackLinks([BOOKING_URL, TOUR_URL, KIT_URL]) +
        `<p style="${P}">Prefer to talk it through? Reply to this email or call or text me at <strong>407 974 5979</strong>.</p>` +
        signature({ phone: true, site: true }),
    );
  return emailShell({
    title: SUBJECT_LINES[3],
    preview: PREVIEW_TEXT[3],
    body,
  });
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
    const emailHTML = sanitizeForSmtp(EMAIL_GENERATORS[emailNumber](firstName, couponCode));
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
