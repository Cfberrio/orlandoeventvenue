import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { authorizeInternalCaller, callerRefusal } from "../_shared/caller-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// OEV Lead Magnet spec (ClickUp 8cqnrff-11737): the sequence pairs one email
// with one SMS at each step. The SMS half lives in GoHighLevel workflows fired
// by the `popup` tag, so these delays MUST stay in sync with the GHL delays or
// the two halves drift apart.
//   E01 + S01 - immediately on submit
//   E02 + S02 - 24 hours after E01
//   E03 + S03 - 48 hours after E01 (= 24 hours after E02)
// Email 3 is measured from when Email 2 actually shipped, not from signup, so a
// delayed Email 2 can never make both emails fire back to back.
const EMAIL_2_DELAY_HOURS = 24;
const EMAIL_3_DELAY_HOURS = 24;
const MAX_LEADS_PER_RUN = 50;

// Second pass X2-19 (ClickUp 86e40ach2): the send is claimed per lead inside
// send-discount-email (UPDATE popup_leads SET email_N_sent_at = now() WHERE
// email_N_sent_at IS NULL RETURNING), so two overlapping runs can never send
// the same email twice. The coupon and recipient come from the lead row there.

/** Escape LIKE wildcards so an address with _ or % matches only itself. */
function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Case-insensitive: has this address booked (any booking not cancelled)? */
async function hasBooked(supabase: any, email: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("bookings")
    .select("id")
    .ilike("email", likeLiteral(email.trim()))
    .neq("status", "cancelled")
    .limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

async function sendDripEmail(
  supabaseUrl: string,
  serviceKey: string,
  leadId: string,
  emailNumber: 2 | 3,
): Promise<{ sent: boolean; skipped: boolean; error?: string }> {
  const response = await fetch(`${supabaseUrl}/functions/v1/send-discount-email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ lead_id: leadId, email_number: emailNumber }),
  });
  const text = await response.text();
  if (!response.ok) return { sent: false, skipped: false, error: text.slice(0, 300) };
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(text);
  } catch (_e) {
    body = {};
  }
  return { sent: body.skipped !== true, skipped: body.skipped === true };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Processing discount drip emails...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Only process-scheduled-jobs (service role), the database or an admin.
    const caller = await authorizeInternalCaller(req, supabase);
    if (!caller.ok) return callerRefusal(caller, corsHeaders);

    const now = new Date();
    const results = { email2_sent: 0, email3_sent: 0, skipped: 0, converted: 0, errors: 0 };

    // =============================
    // EMAIL 2 CANDIDATES (24h after Email 1 went out)
    // =============================
    const email2Cutoff = new Date(now.getTime() - EMAIL_2_DELAY_HOURS * 60 * 60 * 1000).toISOString();

    const { data: email2Leads, error: email2Error } = await supabase
      .from("popup_leads")
      .select("id, full_name, email, coupon_code, email_1_sent_at")
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
          // Check conversion (case-insensitive): has this address booked?
          if (await hasBooked(supabase, String(lead.email ?? ""))) {
            console.log(`Lead ${lead.id} has booked - marking as converted`);
            const { error: convError } = await supabase
              .from("popup_leads")
              .update({ is_converted: true })
              .eq("id", lead.id);
            if (convError) {
              console.error(`Could not mark lead ${lead.id} converted:`, convError);
              results.errors++;
            } else {
              results.converted++;
            }
            continue;
          }

          // Send Email 2 (send-discount-email claims it atomically)
          const outcome = await sendDripEmail(supabaseUrl, supabaseServiceKey, lead.id, 2);
          if (outcome.sent) {
            console.log(`Email 2 sent for lead ${lead.id}`);
            results.email2_sent++;
          } else if (outcome.skipped) {
            results.skipped++;
          } else {
            console.error(`Failed to send Email 2 for lead ${lead.id}:`, outcome.error);
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
    // EMAIL 3 CANDIDATES (24h after Email 2 went out = 48h into the sequence)
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
          // Check conversion (case-insensitive): has this address booked?
          if (await hasBooked(supabase, String(lead.email ?? ""))) {
            console.log(`Lead ${lead.id} has booked - marking as converted`);
            const { error: convError } = await supabase
              .from("popup_leads")
              .update({ is_converted: true })
              .eq("id", lead.id);
            if (convError) {
              console.error(`Could not mark lead ${lead.id} converted:`, convError);
              results.errors++;
            } else {
              results.converted++;
            }
            continue;
          }

          // Send Email 3 (send-discount-email claims it atomically)
          const outcome = await sendDripEmail(supabaseUrl, supabaseServiceKey, lead.id, 3);
          if (outcome.sent) {
            console.log(`Email 3 sent for lead ${lead.id}`);
            results.email3_sent++;
          } else if (outcome.skipped) {
            results.skipped++;
          } else {
            console.error(`Failed to send Email 3 for lead ${lead.id}:`, outcome.error);
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
