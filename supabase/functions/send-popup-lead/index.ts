import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PopupLeadData {
  fullName: string;
  email: string;
  phone: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: PopupLeadData = await req.json();

    if (!data.fullName?.trim() || !data.email?.trim() || !data.phone?.trim()) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing required fields: fullName, email, phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!EMAIL_REGEX.test(data.email.trim())) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid email format" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const ghlApiKey = Deno.env.get("GHL_PRIVATE_API_KEY");
    const ghlLocationId = Deno.env.get("GHL_LOCATION_ID");

    if (!ghlApiKey || !ghlLocationId) {
      console.error("GHL credentials not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "GHL service not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nameParts = data.fullName.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";

    const rawDigits = data.phone.replace(/\D/g, "");
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
        email: data.email.trim().toLowerCase(),
        phone: formattedPhone,
        tags: ["popup"],
      }),
    });

    if (ghlRes.ok) {
      console.log("GHL popup lead upserted successfully:", data.email);
      return new Response(
        JSON.stringify({ ok: true, message: "Lead sent to GHL" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const errorText = await ghlRes.text();
    console.warn("GHL popup lead upsert status:", ghlRes.status, errorText);
    return new Response(
      JSON.stringify({ ok: false, error: `GHL returned ${ghlRes.status}` }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error sending popup lead to GHL:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
