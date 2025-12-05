import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("Stripe_Secret_Key") || "", {
  apiVersion: "2023-10-16",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Helper to sync booking to GHL after payment events.
 */
async function syncToGHL(bookingId: string): Promise<void> {
  const ghlWebhookUrl = Deno.env.get("GHL_BOOKING_WEBHOOK_URL");
  if (!ghlWebhookUrl) {
    console.log("GHL_BOOKING_WEBHOOK_URL not configured, skipping sync");
    return;
  }

  try {
    // Call the sync-to-ghl edge function internally
    const response = await fetch(`${supabaseUrl}/functions/v1/sync-to-ghl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    });

    if (!response.ok) {
      console.error("Failed to sync to GHL:", await response.text());
    } else {
      console.log("Successfully synced booking to GHL:", bookingId);
    }
  } catch (error) {
    console.error("Error syncing to GHL:", error);
    // Don't throw - we don't want to fail the webhook because of GHL sync issues
  }
}

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

  if (!signature) {
    console.error("No Stripe signature found");
    return new Response("No signature", { status: 400 });
  }

  if (!webhookSecret) {
    console.error("No webhook secret configured");
    return new Response("Webhook secret not configured", { status: 500 });
  }

  try {
    const body = await req.text();
    
    // Verify webhook signature
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );

    console.log("Received Stripe event:", event.type);

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id;

      if (!bookingId) {
        console.error("No booking_id in session metadata");
        return new Response("No booking_id", { status: 400 });
      }

      console.log("Processing payment for booking:", bookingId);

      // Create Supabase client with service role key
      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Update booking payment status
      const { data, error } = await supabase
        .from("bookings")
        .update({
          payment_status: "deposit_paid",
          deposit_paid_at: new Date().toISOString(),
          stripe_session_id: session.id,
          stripe_payment_intent_id: session.payment_intent,
        })
        .eq("id", bookingId)
        .select("id, reservation_number")
        .single();

      if (error) {
        console.error("Error updating booking:", error);
        return new Response("Database error", { status: 500 });
      }

      console.log("Booking updated successfully:", data);

      // Sync to GHL after successful payment update
      await syncToGHL(bookingId);
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: unknown) {
    console.error("Webhook error:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(`Webhook Error: ${errorMessage}`, { status: 400 });
  }
});
