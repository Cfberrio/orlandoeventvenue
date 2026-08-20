import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import {
  type ContactFormData,
  generateContactFormHTML,
  generateContactFormText,
} from "../_shared/contact-form.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
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

    const emailHTML = generateContactFormHTML(data);
    const emailText = generateContactFormText(data);

    await client.send({
      from: gmailUser,
      replyTo: data.email,
      to: gmailUser,
      subject: `Contact Form - ${data.subject}`,
      content: emailText,
      html: emailHTML,
    });

    await client.close();

    console.log("Contact form email sent successfully to:", gmailUser);

    // Upsert GHL contact — fire-and-forget after email success
    // Uses /contacts/upsert to create or update by email; avoids 400 when contact exists
    const ghlApiKey = Deno.env.get("GHL_PRIVATE_API_KEY");
    const ghlLocationId = Deno.env.get("GHL_LOCATION_ID");

    if (ghlApiKey && ghlLocationId) {
      try {
        const nameParts = data.name.trim().split(" ");
        const firstName = nameParts[0];
        const lastName = nameParts.slice(1).join(" ") || "";

        const rawDigits = data.phone?.replace(/\D/g, "") || "";
        const formattedPhone = rawDigits.length === 10
          ? `+1${rawDigits}`
          : rawDigits.length === 11 && rawDigits.startsWith("1")
            ? `+${rawDigits}`
            : rawDigits;

        const ghlRes = await fetch("https://services.leadconnectorhq.com/contacts/upsert", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${ghlApiKey}`,
            "Version": "2021-07-28",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            locationId: ghlLocationId,
            firstName,
            lastName,
            email: data.email,
            phone: formattedPhone,
            tags: ["contactForm"],
          }),
        });

        if (ghlRes.ok) {
          console.log("GHL contact upserted successfully");
        } else {
          console.warn("GHL contact upsert status:", ghlRes.status, await ghlRes.text());
        }
      } catch (ghlError) {
        console.error("GHL contact upsert failed (non-blocking):", ghlError);
      }
    }

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
