import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { claimRateSlot, clientIp } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PopupLeadData {
  fullName: string;
  email: string;
  phone: string;
  /** ISO date (YYYY-MM-DD) the contact is planning for */
  eventDate?: string | null;
}

/** GHL custom field key holding the lead's planned event date */
const EVENT_DATE_FIELD_KEY = "oev_event_date";

// Second pass X2-09 (ClickUp 86e40ach2). Upserting a contact with the `popup`
// tag starts the S01-S03 SMS sequence, so this endpoint used to let anyone make
// OEV text any phone. Now it is rate limited per IP and only syncs a
// popup_leads row created in the last 30 minutes whose phone matches; the name,
// phone and date sent to GHL come from that row, not from the request.
// A returning visitor (row older than 30 minutes) is not re-synced: GHL already
// has the contact and the tag.
const LEAD_MAX_AGE_MS = 30 * 60 * 1000;
const RATE_LIMIT = { bucket: "send-popup-lead", max: 5, windowSeconds: 3600 };

const digitsOf = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (!(await claimRateSlot(supabase, clientIp(req), RATE_LIMIT))) {
      return new Response(
        JSON.stringify({ ok: false, error: "Too many requests. Please try again later." }),
        { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: lead, error: leadError } = await supabase
      .from("popup_leads")
      .select("id, full_name, email, phone, preferred_event_date")
      .eq("email", data.email.trim().toLowerCase())
      .gte("created_at", new Date(Date.now() - LEAD_MAX_AGE_MS).toISOString())
      .limit(1)
      .maybeSingle();

    if (leadError) {
      console.error("popup lead lookup failed:", leadError);
      return new Response(
        JSON.stringify({ ok: false, error: "Lead lookup failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!lead || !digitsOf(lead.phone) || digitsOf(lead.phone) !== digitsOf(data.phone)) {
      console.log("send-popup-lead: no fresh matching popup_leads row; not syncing");
      return new Response(
        JSON.stringify({ ok: false, error: "lead_not_found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // From here on, the stored row is the source of every field sent to GHL.
    data.fullName = String(lead.full_name ?? data.fullName);
    data.phone = String(lead.phone ?? data.phone);
    data.eventDate = (lead.preferred_event_date as string | null) ?? null;

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

    const tags = ["popup"];

    const eventDate = data.eventDate?.trim() || "";
    const customFields = eventDate
      ? [{ key: EVENT_DATE_FIELD_KEY, field_value: eventDate }]
      : undefined;

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
        tags,
        ...(customFields ? { customFields } : {}),
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
