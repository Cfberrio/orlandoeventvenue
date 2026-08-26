import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { getFrontendUrl } from "../_shared/config.ts";
import {
  BRAND,
  detailTable,
  displayTitle,
  emailShell,
  escapeHtml,
  gap,
  heroModule,
  para,
  primaryButton,
  sanitizeForSmtp,
  textModule,
} from "../_shared/email-layout.ts";

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
    // Auth: accept GHL token OR Supabase Authorization header (for admin frontend)
    const ghlToken = req.headers.get("x-ghl-backend-token");
    const authHeader = req.headers.get("authorization");
    const expectedToken = Deno.env.get("GHL_BACKEND_TOKEN");

    const ghlAuthed = ghlToken && ghlToken === expectedToken;
    const supabaseAuthed = !!authHeader;

    if (!ghlAuthed && !supabaseAuthed) {
      console.error("Invalid or missing auth credentials");
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    console.log("Received request body:", JSON.stringify(body));

    const booking_id = body.booking_id || body.customData?.booking_id || body.customData?.bookingId;
    const sendEmail = body.send_email === true;

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

    // Log Stripe mode for production validation (without exposing the full key)
    const stripeMode = stripeSecretKey.startsWith("sk_live") ? "LIVE" : "TEST";
    console.log(`Stripe mode: ${stripeMode}`);

    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    // Fetch dynamic processing fee from venue_pricing
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

    const balanceAmountCents = Math.round(Number(booking.balance_amount) * 100);
    const feeCents = Math.round(balanceAmountCents * PROCESSING_FEE_RATE);
    const totalChargeCents = balanceAmountCents + feeCents;

    console.log(`Balance: base=${balanceAmountCents}c, fee=${feeCents}c, total=${totalChargeCents}c`);

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

    const connectedAccountId = Deno.env.get("STRIPE_CONNECTED_ACCOUNT_ID");

    // Get the origin for redirect URLs
    const origin = getFrontendUrl();

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
      mode: "payment",
      success_url: `${origin}/booking-confirmation?session_id={CHECKOUT_SESSION_ID}&booking_id=${booking.id}&type=balance`,
      cancel_url: `${origin}/booking-confirmation?cancelled=true&booking_id=${booking.id}&type=balance`,
      metadata: {
        booking_id: booking.id,
        reservation_number: booking.reservation_number || "",
        payment_type: "balance",
      },
      ...(connectedAccountId ? {
        payment_intent_data: {
          transfer_data: {
            destination: connectedAccountId,
            amount: Math.round(balanceAmountCents * 0.20),
          },
        },
      } : {}),
    });

    console.log("Created Stripe Checkout Session:", session.id);
    console.log("Payment URL:", session.url);

    const expiresAt = new Date(session.expires_at! * 1000).toISOString();

    // Update booking with balance payment link data + persist exact fee amounts
    const { error: updateError } = await supabase
      .from("bookings")
      .update({
        balance_payment_url: session.url,
        balance_link_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
        balance_fee: feeCents / 100,
        balance_total_charged: totalChargeCents / 100,
      })
      .eq("id", booking.id);

    if (updateError) {
      console.error("Error updating booking with balance link:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to save payment link to database" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the event
    await supabase.from("booking_events").insert({
      booking_id: booking.id,
      event_type: "balance_payment_link_created",
      channel: sendEmail ? "admin" : "ghl",
      metadata: {
        session_id: session.id,
        payment_url: session.url,
        amount: booking.balance_amount,
        expires_at: expiresAt,
      },
    });

    // Send balance payment email if requested
    if (sendEmail && session.url) {
      const gmailUser = Deno.env.get("GMAIL_USER");
      const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

      if (gmailUser && gmailPassword) {
        try {
          const firstName = (booking.full_name || "Customer").split(" ")[0];
          const eventDate = new Date(booking.event_date).toLocaleDateString("en-US", {
            weekday: "long", year: "numeric", month: "long", day: "numeric",
          });
          const formatTime = (t: string | null) => {
            if (!t) return "N/A";
            const [h, m] = t.split(":");
            const hr = parseInt(h, 10);
            return `${hr % 12 || 12}:${m} ${hr >= 12 ? "PM" : "AM"}`;
          };
          const timeRange = booking.start_time && booking.end_time
            ? `${formatTime(booking.start_time)} - ${formatTime(booking.end_time)}`
            : "All Day";
          const fmtCurrency = (n: number) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
          const balanceBaseFormatted = fmtCurrency(booking.balance_amount);
          const balanceTotalFormatted = fmtCurrency((balanceAmountCents + feeCents) / 100);
          const totalFormatted = fmtCurrency(booking.total_amount);
          const depositFormatted = fmtCurrency(booking.deposit_amount);
          const processingFeeFormatted = fmtCurrency(feeCents / 100);
          const paymentUrl = session.url;

          const emailBody =
            heroModule({
              display: displayTitle("Balance Payment", { size: 40 }),
            }) +
            gap() +
            textModule(
              `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${escapeHtml(firstName)}</strong>,</p>` +
              para(`Your remaining balance for your upcoming event is ready for payment. Please complete your payment at your earliest convenience to confirm your reservation.`) +
              `<div style="background:#FFFBEB;border:2px solid ${BRAND.amber};border-radius:14px;padding:22px;text-align:center;margin:22px 0 0;">` +
              `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#92400E;text-transform:uppercase;letter-spacing:1.5px;">Remaining Balance Due</p>` +
              `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;color:${BRAND.amber};">${balanceTotalFormatted}</p>` +
              `</div>` +
              `<p style="margin:20px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${BRAND.ink};">Event Details</p>` +
              detailTable([
                ["Event Date", eventDate],
                ["Event Time", timeRange],
                ["Event Type", escapeHtml(booking.event_type || "N/A")],
                ["Guests", escapeHtml(String(booking.number_of_guests || "N/A"))],
              ]) +
              `<p style="margin:20px 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:bold;color:${BRAND.ink};">Payment Summary</p>` +
              detailTable([
                ["Total Amount", totalFormatted],
                ["Deposit Paid", depositFormatted],
                ["Remaining Balance", balanceBaseFormatted],
                [FEE_LABEL, processingFeeFormatted],
                ["Total Due", balanceTotalFormatted],
              ]) +
              primaryButton("Pay Balance Now", paymentUrl) +
              `<p style="margin:14px 0 0;font-size:12px;color:${BRAND.muted};text-align:center;line-height:1.5;">If the button doesn't work, copy and paste this link:<br><a href="${paymentUrl}" style="color:${BRAND.amber};word-break:break-all;">${paymentUrl}</a></p>` +
              para(`This payment link expires in <strong>24 hours</strong>. If you have any questions, simply reply to this email and we'll be happy to help.`) +
              para(`<strong>Orlando Event Venue</strong>`),
            );

          const emailHTML = sanitizeForSmtp(emailShell({
            title: "Balance Payment",
            preview: `Your remaining balance of ${balanceTotalFormatted} is ready for payment.`,
            body: emailBody,
            footerNote: "This payment link expires 24 hours after it was created.",
          }));

          const smtpClient = new SMTPClient({
            connection: {
              hostname: "smtp.gmail.com",
              port: 465,
              tls: true,
              auth: { username: gmailUser, password: gmailPassword },
            },
          });

          await smtpClient.send({
            from: gmailUser,
            to: booking.email,
            subject: `Balance Payment Due: ${booking.reservation_number || "Event Booking"} | Orlando Event Venue`,
            content: `Your remaining balance of ${balanceTotalFormatted} is due. Pay here: ${paymentUrl}`,
            html: emailHTML,
          });

          await smtpClient.close();
          console.log("Balance payment email sent to:", booking.email);
        } catch (emailError) {
          console.error("Error sending balance payment email:", emailError);
        }
      } else {
        console.warn("Gmail credentials not configured, skipping balance payment email");
      }
    }

    // Call syncToGHL to send updated snapshot with balance_payment_url
    try {
      const syncResponse = await fetch(
        `${supabaseUrl}/functions/v1/sync-to-ghl`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ booking_id: booking.id }),
        }
      );
      
      if (!syncResponse.ok) {
        console.error("syncToGHL returned non-2xx:", syncResponse.status);
      } else {
        console.log("Successfully synced booking to GHL after balance link creation");
      }
    } catch (syncError) {
      console.error("Error calling syncToGHL:", syncError);
      // Don't fail the response, just log
    }

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
        expires_at: expiresAt,
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
