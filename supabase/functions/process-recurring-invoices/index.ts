import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// A child claimed for sending by a run that died is retried after this long.
const SEND_LEASE_MS = 10 * 60 * 1000;

// M-31 (ClickUp 86e40ach2). Order per due parent:
//   1. find or create THE child for this period (unique per parent+period);
//   2. claim it for sending (no double send by overlapping runs);
//   3. send it through create-invoice;
//   4. only then advance the schedule (claim_recurring_invoice, CAS).
// A failure at 1-3 leaves the period due: the next run retries the same child
// and the failure is shown on the parent (recurring_last_error). It used to
// advance first and skip the month for good.

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordFailure(supabase: any, parentId: string, message: string) {
  const { error } = await supabase
    .from("invoices")
    .update({ recurring_last_error: message.slice(0, 500), recurring_last_error_at: new Date().toISOString() })
    .eq("id", parentId);
  if (error) console.error(`[recurring-invoices] Could not record failure on ${parentId}:`, error);
}

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
      // A row with no usable interval can never be rescheduled.
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
        const period: string = parent.recurring_next_send_at;
        console.log(`[recurring-invoices] Processing parent ${parent.id} (${parent.invoice_number}) period ${period}`);

        // 1. The child for this period (a previous run may have created it).
        const { data: existing, error: existingError } = await supabase
          .from("invoices")
          .select("*")
          .eq("recurring_parent_id", parent.id)
          .eq("recurring_period", period)
          .neq("payment_status", "cancelled")
          .maybeSingle();
        if (existingError) {
          console.error(`[recurring-invoices] Could not look up child for ${parent.id}:`, existingError);
          await recordFailure(supabase, parent.id, `lookup failed: ${existingError.message}`);
          failed++;
          continue;
        }

        let child = existing;
        if (!child) {
          const { data: inserted, error: insertError } = await supabase
            .from("invoices")
            .insert({
              title: parent.title,
              description: parent.description,
              amount: parent.amount,
              subtotal: parent.subtotal ?? parent.amount,
              discount_type: parent.discount_type,
              discount_value: parent.discount_value,
              discount_amount: parent.discount_amount ?? 0,
              line_items: parent.line_items,
              customer_email: parent.customer_email,
              customer_name: parent.customer_name,
              recurring_parent_id: parent.id,
              recurring_period: period,
              created_by: parent.created_by,
            })
            .select()
            .single();
          if (insertError?.code === "23505") {
            console.log(`[recurring-invoices] Another run created the child for ${parent.id} ${period}; skipping`);
            skipped++;
            continue;
          }
          if (insertError || !inserted) {
            console.error(`[recurring-invoices] Failed to insert child for ${parent.id}:`, insertError);
            await recordFailure(supabase, parent.id, `could not create the invoice: ${insertError?.message ?? "unknown"}`);
            failed++;
            continue;
          }
          child = inserted;
          console.log(`[recurring-invoices] Child invoice created: ${child.id} (${child.invoice_number})`);
        }

        // 2-3. Send it, unless a previous run already did (only the schedule
        // advance was lost then).
        if (!child.payment_url) {
          const leaseExpired = new Date(Date.now() - SEND_LEASE_MS).toISOString();
          const { data: claimedChild, error: childClaimError } = await supabase
            .from("invoices")
            .update({ recurring_send_claimed_at: new Date().toISOString() })
            .eq("id", child.id)
            .is("payment_url", null)
            .or(`recurring_send_claimed_at.is.null,recurring_send_claimed_at.lt.${leaseExpired}`)
            .select("id");
          if (childClaimError || !claimedChild || claimedChild.length === 0) {
            if (childClaimError) console.error(`[recurring-invoices] Could not claim child ${child.id}:`, childClaimError);
            skipped++;
            continue;
          }

          let sendError: string | null = null;
          try {
            const fnResponse = await fetch(`${supabaseUrl}/functions/v1/create-invoice`, {
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
            if (!fnResponse.ok) sendError = await fnResponse.text();
          } catch (fetchErr) {
            sendError = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          }

          if (sendError !== null) {
            // Did it reach the customer anyway (only the response was lost)?
            const { data: after } = await supabase
              .from("invoices")
              .select("payment_url")
              .eq("id", child.id)
              .maybeSingle();
            if (!after?.payment_url) {
              console.error(`[recurring-invoices] create-invoice failed for child ${child.id}:`, sendError);
              // Release the claim so the next run retries this same child.
              await supabase.from("invoices").update({ recurring_send_claimed_at: null }).eq("id", child.id);
              await recordFailure(supabase, parent.id, `could not send ${child.invoice_number}: ${sendError}`);
              failed++;
              continue;
            }
            console.warn(`[recurring-invoices] create-invoice errored but ${child.id} has a payment link; treating as sent`);
          }
          console.log(`[recurring-invoices] create-invoice succeeded for child ${child.id}`);
        }

        // 4. Only now move the schedule forward.
        const { data: advanced, error: claimError } = await supabase.rpc("claim_recurring_invoice", {
          p_invoice_id: parent.id,
          p_expected_next_send: period,
        });
        if (claimError) {
          console.error(`[recurring-invoices] Could not advance schedule for ${parent.id}:`, claimError);
          await recordFailure(supabase, parent.id, `invoice sent but schedule not advanced: ${claimError.message}`);
          failed++;
          continue;
        }
        if (!advanced) {
          console.log(`[recurring-invoices] Schedule for ${parent.id} already advanced by another run`);
        }
        await supabase
          .from("invoices")
          .update({ recurring_last_error: null, recurring_last_error_at: null })
          .eq("id", parent.id);

        processed++;
      } catch (err) {
        console.error(`[recurring-invoices] Unexpected error for parent ${parent.id}:`, err);
        await recordFailure(supabase, parent.id, err instanceof Error ? err.message : String(err));
        failed++;
      }
    }

    console.log(
      `[recurring-invoices] Done. Processed: ${processed}, Failed: ${failed}, Skipped: ${skipped}`
    );
    return new Response(
      JSON.stringify({ processed, failed, skipped }),
      { status: failed > 0 ? 500 : 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
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
