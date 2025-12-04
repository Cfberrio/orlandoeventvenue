import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";

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

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
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
            unit_amount: Math.round(depositAmount * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}&booking_id=${bookingId}`,
      cancel_url: cancelUrl,
      metadata: {
        booking_id: bookingId,
        payment_type: "deposit",
      },
      payment_intent_data: {
        metadata: {
          booking_id: bookingId,
          payment_type: "deposit",
        },
        setup_future_usage: "off_session", // Save card for balance payment
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
