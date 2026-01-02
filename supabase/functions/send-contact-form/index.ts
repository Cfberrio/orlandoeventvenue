import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ContactFormData {
  name: string;
  email: string;
  phone?: string;
  subject: string;
  message: string;
  website?: string; // Honeypot
  transactionalConsent: boolean;
  marketingConsent: boolean;
  timestamp: string;
}

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

function generateEmailHTML(data: ContactFormData): string {
  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZoneName: "short",
    });
  };

  const phoneSection = data.phone ? `<div class="field"><span class="label">Phone:</span><div class="value"><a href="tel:${data.phone}">${data.phone}</a></div></div>` : "";
  
  const consentSection = data.transactionalConsent || data.marketingConsent 
    ? (data.transactionalConsent ? '<div class="consent">✅ <strong>Transactional messages:</strong> Agreed</div>' : '') +
      (data.marketingConsent ? '<div class="consent">✅ <strong>Marketing messages:</strong> Agreed</div>' : '')
    : '<div class="value">No consent provided</div>';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Contact Form Submission</title>
<style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333}
.container{max-width:600px;margin:0 auto;padding:20px}
.header{background:#0b1220;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0}
.content{background:#f9fafb;padding:30px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px}
.field{margin-bottom:20px}
.label{font-weight:bold;color:#0b1220;display:block;margin-bottom:5px}
.value{background:white;padding:12px;border-radius:6px;border:1px solid #e5e7eb}
.consent{background:#ecfeff;border-left:4px solid #0891b2;padding:12px;margin:10px 0;border-radius:4px}
.footer{text-align:center;margin-top:20px;font-size:12px;color:#6b7280}
</style>
</head>
<body>
<div class="container">
<div class="header">
<h1 style="margin:0;font-size:24px">📬 New Contact Form Submission</h1>
<p style="margin:8px 0 0 0;opacity:0.9">Orlando Event Venue</p>
</div>
<div class="content">
<div class="field"><span class="label">From:</span><div class="value">${data.name}</div></div>
<div class="field"><span class="label">Email:</span><div class="value"><a href="mailto:${data.email}">${data.email}</a></div></div>
${phoneSection}
<div class="field"><span class="label">Subject:</span><div class="value">${data.subject}</div></div>
<div class="field"><span class="label">Message:</span><div class="value" style="white-space:pre-wrap">${data.message}</div></div>
<div class="field"><span class="label">Consent Preferences:</span>${consentSection}</div>
<div class="footer">
<p>Submitted on ${formatDate(data.timestamp)}</p>
<p>This message was sent from the contact form at orlandoeventvenue.org</p>
</div>
</div>
</div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: ContactFormData = await req.json();

    // Honeypot check - if website field is filled, it's likely spam
    if (data.website && data.website.trim() !== "") {
      console.log("Honeypot triggered, discarding spam submission");
      // Return success to not alert spammers
      return new Response(
        JSON.stringify({ ok: true, message: "Message received" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate required fields
    if (!data.name || !data.email || !data.subject || !data.message) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate email format
    if (!validateEmail(data.email)) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate message length (prevent spam)
    if (data.message.length > 5000) {
      return new Response(
        JSON.stringify({ ok: false, error: "Message too long (max 5000 characters)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing contact form submission from:", data.email);

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

    const emailHTML = generateEmailHTML(data);

    await client.send({
      from: gmailUser,
      to: gmailUser, // Send to same email (orlandoglobalministries@gmail.com)
      subject: `Contact Form - ${data.subject}`,
      content: `New contact form submission from ${data.name} (${data.email})`,
      html: emailHTML,
    });

    await client.close();

    console.log("Contact form email sent successfully to:", gmailUser);

    return new Response(
      JSON.stringify({ ok: true, message: "Message sent successfully" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error processing contact form:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
