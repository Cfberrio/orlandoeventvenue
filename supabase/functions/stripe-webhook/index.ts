import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripe = new Stripe(Deno.env.get("Stripe_Secret_Key") || "", {
  apiVersion: "2023-10-16",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
