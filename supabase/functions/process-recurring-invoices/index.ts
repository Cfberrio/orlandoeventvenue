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

    for (const parent of dueInvoices) {
      try {
        console.log(`[recurring-invoices] Processing parent ${parent.id} (${parent.invoice_number})`);

        const { data: child, error: insertError } = await supabase
          .from("invoices")
          .insert({
            title: parent.title,
            description: parent.description,
            amount: parent.amount,
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
          failed++;
          continue;
        }

        console.log(`[recurring-invoices] Child invoice created: ${child.id} (${child.invoice_number})`);

        const createInvoiceUrl = `${supabaseUrl}/functions/v1/create-invoice`;
        const fnResponse = await fetch(createInvoiceUrl, {
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
          const errText = await fnResponse.text();
          console.error(`[recurring-invoices] create-invoice failed for child ${child.id}:`, errText);
          failed++;
          continue;
        }

        console.log(`[recurring-invoices] create-invoice succeeded for child ${child.id}`);

        const { error: bumpError } = await supabase.rpc("bump_recurring_next_send", {
          p_invoice_id: parent.id,
        });

        if (bumpError) {
          console.error(`[recurring-invoices] Failed to bump next_send for ${parent.id}:`, bumpError);
          const fallbackNext = new Date(
            new Date(parent.recurring_next_send_at).getTime() +
              parent.recurring_interval_days * 86400000
          ).toISOString();
          await supabase
            .from("invoices")
            .update({ recurring_next_send_at: fallbackNext })
            .eq("id", parent.id);
        }

        processed++;
      } catch (err) {
        console.error(`[recurring-invoices] Unexpected error for parent ${parent.id}:`, err);
        failed++;
      }
    }

    console.log(`[recurring-invoices] Done. Processed: ${processed}, Failed: ${failed}`);
    return new Response(
      JSON.stringify({ processed, failed }),
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
