import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const stripeSecretKey = Deno.env.get("Stripe_Secret_Key")!;

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.json();
    const {
      bookingId,
      package: pkg,
      packageStartTime,
      packageEndTime,
      packageCost,
      setupBreakdown,
      tablecloths,
      tableclothQuantity,
      optionalServicesCost,
      totalAmount,
      customerEmail,
      customerName,
      eventDate,
      successUrl,
      cancelUrl,
    } = body;

    if (!bookingId || !totalAmount || totalAmount <= 0) {
      return new Response(
        JSON.stringify({ error: "bookingId and totalAmount are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch booking for context
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, reservation_number, full_name, email, event_date, event_type")
      .eq("id", bookingId)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(
        JSON.stringify({ error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create the addon invoice record first (pending)
    const { data: invoice, error: invoiceError } = await supabase
      .from("booking_addon_invoices")
      .insert({
        booking_id: bookingId,
        package: pkg || "none",
        package_start_time: packageStartTime || null,
        package_end_time: packageEndTime || null,
        package_cost: packageCost || 0,
        setup_breakdown: setupBreakdown || false,
        tablecloths: tablecloths || false,
        tablecloth_quantity: tableclothQuantity || 0,
        optional_services_cost: optionalServicesCost || 0,
        total_amount: totalAmount,
        payment_status: "pending",
      })
      .select()
      .single();

    if (invoiceError || !invoice) {
      console.error("Failed to create addon invoice:", invoiceError);
      return new Response(
        JSON.stringify({ error: "Failed to create addon invoice" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Addon invoice created:", invoice.id);

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: customerEmail || booking.email,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Add-on Invoice — ${booking.reservation_number || bookingId.slice(0, 8).toUpperCase()}`,
              description: `Additional services for your event on ${eventDate || booking.event_date}`,
            },
            unit_amount: Math.round(totalAmount * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        booking_id: bookingId,
        invoice_id: invoice.id,
        payment_type: "addon_invoice",
        reservation_number: booking.reservation_number || "",
      },
      client_reference_id: bookingId,
      success_url: successUrl || `${Deno.env.get("SUPABASE_URL")?.replace("supabase.co", "lovable.app")}/booking-confirmation`,
      cancel_url: cancelUrl || `${Deno.env.get("SUPABASE_URL")?.replace("supabase.co", "lovable.app")}/admin/bookings/${bookingId}`,
    });

    // Update invoice with Stripe session ID and payment URL
    await supabase
      .from("booking_addon_invoices")
      .update({
        stripe_session_id: session.id,
        payment_url: session.url,
      })
      .eq("id", invoice.id);

    console.log("Stripe session created:", session.id, "for invoice:", invoice.id);

    return new Response(
      JSON.stringify({
        invoiceId: invoice.id,
        sessionId: session.id,
        url: session.url,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error creating addon invoice:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
