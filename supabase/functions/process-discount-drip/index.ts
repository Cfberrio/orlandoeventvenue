import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_2_DELAY_HOURS = 18;
const EMAIL_3_DELAY_HOURS = 30;
const MAX_LEADS_PER_RUN = 50;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Processing discount drip emails...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const results = { email2_sent: 0, email3_sent: 0, converted: 0, errors: 0 };

    // =============================
    // EMAIL 2 CANDIDATES (18h after Email 1)
    // =============================
    const email2Cutoff = new Date(now.getTime() - EMAIL_2_DELAY_HOURS * 60 * 60 * 1000).toISOString();

    const { data: email2Leads, error: email2Error } = await supabase
      .from("popup_leads")
      .select("id, full_name, email, coupon_code")
      .eq("is_converted", false)
      .not("email_1_sent_at", "is", null)
      .is("email_2_sent_at", null)
      .lte("email_1_sent_at", email2Cutoff)
      .limit(MAX_LEADS_PER_RUN);

    if (email2Error) {
      console.error("Error fetching email 2 candidates:", email2Error);
    }

    if (email2Leads && email2Leads.length > 0) {
      console.log(`Found ${email2Leads.length} leads needing Email 2`);

      for (const lead of email2Leads) {
        try {
          // Check conversion: does this email exist in bookings?
          const { data: existingBooking } = await supabase
            .from("bookings")
            .select("id")
            .eq("email", lead.email)
            .neq("status", "cancelled")
            .limit(1);

          if (existingBooking && existingBooking.length > 0) {
            console.log(`Lead ${lead.email} has booked - marking as converted`);
            await supabase
              .from("popup_leads")
              .update({ is_converted: true })
              .eq("id", lead.id);
            results.converted++;
            continue;
          }

          // Send Email 2
          const response = await fetch(
            `${supabaseUrl}/functions/v1/send-discount-email`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                full_name: lead.full_name,
                email: lead.email,
                coupon_code: lead.coupon_code || "SAVE50",
                email_number: 2,
              }),
            }
          );

          if (response.ok) {
            console.log(`Email 2 sent to ${lead.email}`);
            results.email2_sent++;
          } else {
            const errorBody = await response.text();
            console.error(`Failed to send Email 2 to ${lead.email}:`, errorBody);
            results.errors++;
          }
        } catch (leadError) {
          console.error(`Error processing Email 2 for ${lead.email}:`, leadError);
          results.errors++;
        }
      }
    } else {
      console.log("No leads needing Email 2");
    }

    // =============================
    // EMAIL 3 CANDIDATES (30h after Email 2)
    // =============================
    const email3Cutoff = new Date(now.getTime() - EMAIL_3_DELAY_HOURS * 60 * 60 * 1000).toISOString();

    const { data: email3Leads, error: email3Error } = await supabase
      .from("popup_leads")
      .select("id, full_name, email, coupon_code")
      .eq("is_converted", false)
      .not("email_2_sent_at", "is", null)
      .is("email_3_sent_at", null)
      .lte("email_2_sent_at", email3Cutoff)
      .limit(MAX_LEADS_PER_RUN);

    if (email3Error) {
      console.error("Error fetching email 3 candidates:", email3Error);
    }

    if (email3Leads && email3Leads.length > 0) {
      console.log(`Found ${email3Leads.length} leads needing Email 3`);

      for (const lead of email3Leads) {
        try {
          // Check conversion: does this email exist in bookings?
          const { data: existingBooking } = await supabase
            .from("bookings")
            .select("id")
            .eq("email", lead.email)
            .neq("status", "cancelled")
            .limit(1);

          if (existingBooking && existingBooking.length > 0) {
            console.log(`Lead ${lead.email} has booked - marking as converted`);
            await supabase
              .from("popup_leads")
              .update({ is_converted: true })
              .eq("id", lead.id);
            results.converted++;
            continue;
          }

          // Send Email 3
          const response = await fetch(
            `${supabaseUrl}/functions/v1/send-discount-email`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({
                full_name: lead.full_name,
                email: lead.email,
                coupon_code: lead.coupon_code || "SAVE50",
                email_number: 3,
              }),
            }
          );

          if (response.ok) {
            console.log(`Email 3 sent to ${lead.email}`);
            results.email3_sent++;
          } else {
            const errorBody = await response.text();
            console.error(`Failed to send Email 3 to ${lead.email}:`, errorBody);
            results.errors++;
          }
        } catch (leadError) {
          console.error(`Error processing Email 3 for ${lead.email}:`, leadError);
          results.errors++;
        }
      }
    } else {
      console.log("No leads needing Email 3");
    }

    console.log(`Discount drip complete. Email2: ${results.email2_sent}, Email3: ${results.email3_sent}, Converted: ${results.converted}, Errors: ${results.errors}`);

    return new Response(
      JSON.stringify({ success: true, ...results }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in process-discount-drip:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
