import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CheckoutRequest {
  bookingId: string;
  depositAmount: number;
  customerEmail: string;
  customerName: string;
  eventDate: string;
  eventType: string;
  successUrl: string;
  cancelUrl: string;
}

serve(async (req: Request) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const stripeSecretKey = Deno.env.get("Stripe_Secret_Key");
    if (!stripeSecretKey) {
      console.error("Stripe_Secret_Key not found in environment");
      throw new Error("Stripe configuration error");
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    const {
      bookingId,
      depositAmount,
      customerEmail,
      customerName,
      eventDate,
      eventType,
      successUrl,
      cancelUrl,
    }: CheckoutRequest = await req.json();

    console.log("Creating checkout session for booking:", bookingId);
    console.log("Deposit amount (cents):", Math.round(depositAmount * 100));
    console.log("Customer:", customerEmail);

    // Check if customer already exists
    const existingCustomers = await stripe.customers.list({
      email: customerEmail,
      limit: 1,
    });

    let customerId: string;
    if (existingCustomers.data.length > 0) {
      customerId = existingCustomers.data[0].id;
      console.log("Found existing customer:", customerId);
    } else {
      const newCustomer = await stripe.customers.create({
        email: customerEmail,
        name: customerName,
        metadata: {
          booking_id: bookingId,
        },
      });
      customerId = newCustomer.id;
      console.log("Created new customer:", customerId);
    }

    const connectedAccountId = Deno.env.get("STRIPE_CONNECTED_ACCOUNT_ID");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: feeRow, error: feeError } = await supabase
      .from("venue_pricing")
      .select("price")
      .eq("item_key", "processing_fee")
      .eq("is_active", true)
      .single();

    if (feeError) console.error("Failed to fetch processing fee from venue_pricing:", feeError);
    const FEE_PCT = Number(feeRow?.price ?? 3.5);
    const PROCESSING_FEE_RATE = FEE_PCT / 100;
    const FEE_LABEL = `Processing Fee (${FEE_PCT}%)`;

    const depositAmountCents = Math.round(depositAmount * 100);
    const feeCents = Math.round(depositAmountCents * PROCESSING_FEE_RATE);
    const totalChargeCents = depositAmountCents + feeCents;

    console.log(`Deposit: base=${depositAmountCents}c, fee=${feeCents}c (${FEE_PCT}%), total=${totalChargeCents}c`);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      client_reference_id: bookingId,
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Event Venue Deposit - ${eventType}`,
              description: `50% deposit for event on ${eventDate}. Booking ID: ${bookingId.slice(0, 8).toUpperCase()}`,
            },
            unit_amount: depositAmountCents,
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: FEE_LABEL,
            },
            unit_amount: feeCents,
          },
          quantity: 1,
        },
      ],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
      cancel_url: `${cancelUrl}?cancelled=true&booking_id=${bookingId}`,
      metadata: {
        booking_id: bookingId,
        bookingId: bookingId,
        payment_type: "deposit",
      },
      payment_intent_data: {
        metadata: {
          booking_id: bookingId,
          payment_type: "deposit",
        },
        setup_future_usage: "off_session",
        ...(connectedAccountId ? {
          transfer_data: {
            destination: connectedAccountId,
            amount: Math.round(depositAmountCents * 0.20),
          },
        } : {}),
      },
    });

    console.log("Checkout session created:", session.id);

    return new Response(
      JSON.stringify({ 
        sessionId: session.id, 
        url: session.url 
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  } catch (error: any) {
    console.error("Error creating checkout session:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
