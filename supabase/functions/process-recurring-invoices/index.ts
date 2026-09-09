import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  console.log("[recurring-invoices] Starting processing run…");

  try {
    const { data: dueInvoices, error: queryError } = await supabase
      .from("invoices")
      .select("*")
      .eq("recurring_active", true)
      // A row with no usable interval can never be rescheduled, so it would come
      // back due on every run. claim_recurring_invoice refuses it too; filtering
      // here keeps it out of the "due" count instead of logging a failure hourly.
      .gte("recurring_interval_days", 1)
      .lte("recurring_next_send_at", new Date().toISOString());

    if (queryError) {
      console.error("[recurring-invoices] Query error:", queryError);
      return new Response(
        JSON.stringify({ error: queryError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!dueInvoices || dueInvoices.length === 0) {
      console.log("[recurring-invoices] No due recurring invoices found.");
      return new Response(
        JSON.stringify({ processed: 0 }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[recurring-invoices] Found ${dueInvoices.length} due invoice(s).`);

    let processed = 0;
    let failed = 0;
    let skipped = 0;

    for (const parent of dueInvoices) {
      try {
        console.log(`[recurring-invoices] Processing parent ${parent.id} (${parent.invoice_number})`);

        // [ATOMIC CLAIM] Move the schedule forward before creating anything.
        // Only one caller can win this update, so a concurrent run — or the
        // 20:00 UTC run after a failed 19:00 one — cannot produce a second
        // invoice for the same period.
        const { data: claimed, error: claimError } = await supabase.rpc(
          "claim_recurring_invoice",
          {
            p_invoice_id: parent.id,
            p_expected_next_send: parent.recurring_next_send_at,
          }
        );

        if (claimError) {
          console.error(`[recurring-invoices] Claim failed for ${parent.id}:`, claimError);
          failed++;
          continue;
        }

        if (!claimed) {
          console.log(
            `[recurring-invoices] Parent ${parent.id} already claimed by another run, skipping`
          );
          skipped++;
          continue;
        }

        const { data: child, error: insertError } = await supabase
          .from("invoices")
          .insert({
            title: parent.title,
            description: parent.description,
            amount: parent.amount,
            // Carry the discount over, otherwise the child keeps the right net
            // amount but loses the subtotal/discount breakdown in the email and
            // the dashboard.
            subtotal: parent.subtotal ?? parent.amount,
            discount_type: parent.discount_type,
            discount_value: parent.discount_value,
            discount_amount: parent.discount_amount ?? 0,
            line_items: parent.line_items,
            customer_email: parent.customer_email,
            customer_name: parent.customer_name,
            recurring_parent_id: parent.id,
            created_by: parent.created_by,
          })
          .select()
          .single();

        if (insertError || !child) {
          console.error(`[recurring-invoices] Failed to insert child for ${parent.id}:`, insertError);
          console.error(
            `[recurring-invoices] ACTION REQUIRED: period skipped for parent ${parent.id} (${parent.invoice_number}); the schedule already advanced`
          );
          failed++;
          continue;
        }

        console.log(`[recurring-invoices] Child invoice created: ${child.id} (${child.invoice_number})`);

        const createInvoiceUrl = `${supabaseUrl}/functions/v1/create-invoice`;

        // A thrown fetch (network drop, gateway timeout) must land on the same
        // cleanup path as a non-ok response. Letting it reach the outer catch
        // left the child sitting in the dashboard as pending with no payment_url
        // and no email — an invoice the admin reads as sent that nobody sent.
        let fnResponse: Response | null = null;
        let sendError: string | null = null;
        try {
          fnResponse = await fetch(createInvoiceUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseServiceKey}`,
            },
            body: JSON.stringify({
              invoice_id: child.id,
              customer_email: parent.customer_email,
              customer_name: parent.customer_name || undefined,
            }),
          });
          if (!fnResponse.ok) {
            sendError = await fnResponse.text();
          }
        } catch (fetchErr) {
          sendError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        }

        if (sendError !== null) {
          console.error(`[recurring-invoices] create-invoice failed for child ${child.id}:`, sendError);
          // Cancel the child so it does not look like a live pending invoice.
          // Guarded on payment_status/payment_url because create-invoice may have
          // completed and only the response was lost: cancelling a child whose
          // payment link is already in the customer's inbox would hide a real
          // payment from the revenue report and invite a duplicate send by hand.
          const { data: cancelled, error: cancelError } = await supabase
            .from("invoices")
            .update({ payment_status: "cancelled" })
            .eq("id", child.id)
            .eq("payment_status", "pending")
            .is("payment_url", null)
            .select("id");

          if (cancelError) {
            console.error(
              `[recurring-invoices] Could not cancel orphan child ${child.id}:`,
              cancelError
            );
          } else if (!cancelled || cancelled.length === 0) {
            console.error(
              `[recurring-invoices] ACTION REQUIRED: child ${child.invoice_number} kept — it already has a payment link, so create-invoice may have reached the customer. Verify before resending.`
            );
            failed++;
            continue;
          }

          console.error(
            `[recurring-invoices] ACTION REQUIRED: period skipped for parent ${parent.id} (${parent.invoice_number}); send ${child.invoice_number} manually if it is still owed`
          );
          failed++;
          continue;
        }

        console.log(`[recurring-invoices] create-invoice succeeded for child ${child.id}`);

        processed++;
      } catch (err) {
        console.error(`[recurring-invoices] Unexpected error for parent ${parent.id}:`, err);
        failed++;
      }
    }

    console.log(
      `[recurring-invoices] Done. Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}`
    );
    return new Response(
      JSON.stringify({ processed, failed, skipped }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("[recurring-invoices] Fatal error:", error);
    const msg = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
