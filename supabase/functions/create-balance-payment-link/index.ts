import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ghl-backend-token",
};

interface BalancePaymentRequest {
  booking_id: string;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Verify GHL token
    const ghlToken = req.headers.get("x-ghl-backend-token");
    const expectedToken = Deno.env.get("GHL_BACKEND_TOKEN");
    
    if (!ghlToken || ghlToken !== expectedToken) {
      console.error("Invalid or missing GHL token");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("Received request body:", JSON.stringify(body));

    // Extract booking_id with fallback for GHL customData wrapper
    const booking_id = body.customData?.booking_id || body.customData?.bookingId || body.booking_id;

    if (!booking_id) {
      console.error("Missing booking_id in request");
      return new Response(JSON.stringify({ error: "booking_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Processing balance payment link for booking:", booking_id);

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch booking details
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(JSON.stringify({ error: "Booking not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Validate payment status
    if (booking.payment_status === "fully_paid") {
      console.log("Booking already fully paid");
      return new Response(JSON.stringify({ 
        error: "Booking already fully paid",
        payment_status: booking.payment_status 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (booking.payment_status !== "deposit_paid") {
      console.log("Deposit not yet paid, cannot collect balance");
      return new Response(JSON.stringify({ 
        error: "Deposit must be paid before collecting balance",
        payment_status: booking.payment_status 
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Initialize Stripe
    const stripeSecretKey = Deno.env.get("Stripe_Secret_Key");
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    // Calculate balance amount in cents
    const balanceAmountCents = Math.round(Number(booking.balance_amount) * 100);

    if (balanceAmountCents <= 0) {
      return new Response(JSON.stringify({ error: "Invalid balance amount" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Find or create Stripe customer
    const customers = await stripe.customers.list({
      email: booking.email,
      limit: 1,
    });

    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
      console.log("Found existing Stripe customer:", customerId);
    } else {
      const customer = await stripe.customers.create({
        email: booking.email,
        name: booking.full_name,
        phone: booking.phone,
        metadata: {
          booking_id: booking.id,
          reservation_number: booking.reservation_number || "",
        },
      });
      customerId = customer.id;
      console.log("Created new Stripe customer:", customerId);
    }

    // Get the origin for redirect URLs
    const origin = Deno.env.get("FRONTEND_URL") || "https://vsvsgesgqjtwutadcshi.lovable.app";

    // Create Checkout Session for balance payment
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Balance Payment - ${booking.reservation_number || "Event Booking"}`,
              description: `Remaining balance for ${booking.event_type} on ${booking.event_date}`,
            },
            unit_amount: balanceAmountCents,
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${origin}/booking-confirmation?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}&type=balance`,
      cancel_url: `${origin}/booking-confirmation?cancelled=true&booking_id=${booking.id}&type=balance`,
      metadata: {
        booking_id: booking.id,
        reservation_number: booking.reservation_number || "",
        payment_type: "balance",
      },
      expires_at: Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 7), // 7 days expiration
    });

    console.log("Created Stripe Checkout Session:", session.id);
    console.log("Payment URL:", session.url);

    // Log the event
    await supabase.from("booking_events").insert({
      booking_id: booking.id,
      event_type: "balance_payment_link_created",
      channel: "ghl",
      metadata: {
        session_id: session.id,
        payment_url: session.url,
        amount: booking.balance_amount,
        expires_at: new Date(session.expires_at! * 1000).toISOString(),
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        payment_url: session.url,
        session_id: session.id,
        amount: booking.balance_amount,
        reservation_number: booking.reservation_number,
        customer_email: booking.email,
        customer_name: booking.full_name,
        event_date: booking.event_date,
        expires_at: new Date(session.expires_at! * 1000).toISOString(),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: unknown) {
    console.error("Error creating balance payment link:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
