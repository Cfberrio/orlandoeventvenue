import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const stripe = new Stripe(Deno.env.get("Stripe_Secret_Key") || "", {
  apiVersion: "2023-10-16",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/**
 * Helper to sync booking to GHL contact/opportunity.
 */
async function syncToGHL(bookingId: string): Promise<void> {
  const ghlWebhookUrl = Deno.env.get("GHL_BOOKING_WEBHOOK_URL");
  if (!ghlWebhookUrl) {
    console.log("GHL_BOOKING_WEBHOOK_URL not configured, skipping contact sync");
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/sync-to-ghl`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId }),
    });

    if (!response.ok) {
      console.error("Failed to sync to GHL contact:", await response.text());
    } else {
      console.log("Successfully synced booking to GHL contact:", bookingId);
    }
  } catch (error) {
    console.error("Error syncing to GHL contact:", error);
  }
}

/**
 * Helper to sync booking to GHL Calendar.
 */
async function syncToGHLCalendar(bookingId: string): Promise<void> {
  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/sync-ghl-calendar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({ booking_id: bookingId, skip_if_unchanged: false }),
    });

    if (!response.ok) {
      console.error("Failed to sync to GHL calendar:", await response.text());
    } else {
      const result = await response.json();
      console.log("Successfully synced booking to GHL calendar:", bookingId, result);
    }
  } catch (error) {
    console.error("Error syncing to GHL calendar:", error);
  }
}

/**
 * Send internal payment notification email to admin
 */
async function sendInternalPaymentEmail(
  booking: Record<string, unknown>,
  paymentType: "deposit" | "balance",
  amountPaid: number,
  currency: string,
  sessionId: string,
  paymentIntentId: string | null
): Promise<void> {
  const gmailUser = Deno.env.get("GMAIL_USER");
  const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

  if (!gmailUser || !gmailPassword) {
    console.error("Gmail credentials not configured, skipping internal email");
    return;
  }

  const reservationNumber = booking.reservation_number || booking.id;
  const paymentLabel = paymentType === "deposit" ? "Deposit (50%)" : "Balance (Remaining 50%)";
  const subjectPrefix = paymentType === "deposit" ? "Deposit" : "Balance";
  
  const adminUrl = `https://vsvsgesgqjtwutadcshi.lovable.app/admin/bookings/${booking.id}`;

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTime = (timeString: string | null) => {
    if (!timeString) return "N/A";
    const [hours, minutes] = timeString.split(":");
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? "PM" : "AM";
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  const emailHTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#059669;padding:30px;color:white;">
<h1 style="margin:0;font-size:24px;">Payment Received (${paymentLabel})</h1>
<p style="margin:10px 0 0;">A ${paymentType} payment has been processed.</p>
<p style="margin:10px 0 0;font-size:12px;">Reservation ${reservationNumber}</p>
</div>

<div style="padding:30px;">

<div style="background:#ecfdf5;border:2px solid #10b981;padding:20px;text-align:center;margin:0 0 20px;">
<p style="margin:0;font-size:12px;color:#065f46;">AMOUNT PAID</p>
<p style="margin:5px 0;font-size:32px;font-weight:bold;color:#059669;">
${formatCurrency(amountPaid)} ${currency.toUpperCase()}
</p>
</div>

<p style="margin:0 0 10px;font-weight:bold;">Booking Details:</p>
<table width="100%" style="margin:0 0 20px;">
<tr>
<td style="padding:5px 0;color:#666;">Reservation:</td>
<td style="padding:5px 0;"><strong>${reservationNumber}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Client Name:</td>
<td style="padding:5px 0;"><strong>${booking.full_name || "N/A"}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Client Email:</td>
<td style="padding:5px 0;"><strong>${booking.email || "N/A"}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Client Phone:</td>
<td style="padding:5px 0;"><strong>${booking.phone || "N/A"}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Type:</td>
<td style="padding:5px 0;"><strong>${booking.event_type || "N/A"}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Date:</td>
<td style="padding:5px 0;"><strong>${formatDate(booking.event_date as string)}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Event Time:</td>
<td style="padding:5px 0;"><strong>${formatTime(booking.start_time as string)} - ${formatTime(booking.end_time as string)}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Booking Type:</td>
<td style="padding:5px 0;"><strong>${booking.booking_type === "daily" ? "Full Day" : "Hourly"}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Guests:</td>
<td style="padding:5px 0;"><strong>${booking.number_of_guests || "N/A"}</strong></td>
</tr>
</table>

<p style="margin:0 0 10px;font-weight:bold;">Payment Summary:</p>
<table width="100%" style="margin:0 0 20px;">
<tr>
<td style="padding:5px 0;color:#666;">Payment Type:</td>
<td style="padding:5px 0;"><strong>${paymentType}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Current Status:</td>
<td style="padding:5px 0;"><strong>${booking.payment_status || "N/A"}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Total Amount:</td>
<td style="padding:5px 0;"><strong>${formatCurrency(Number(booking.total_amount) || 0)}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Deposit Amount:</td>
<td style="padding:5px 0;"><strong>${formatCurrency(Number(booking.deposit_amount) || 0)}</strong></td>
</tr>
<tr>
<td style="padding:5px 0;color:#666;">Balance Amount:</td>
<td style="padding:5px 0;"><strong>${formatCurrency(Number(booking.balance_amount) || 0)}</strong></td>
</tr>
</table>

<div style="text-align:center;margin:20px 0;">
<a href="${adminUrl}" style="display:inline-block;background:#059669;color:white;padding:12px 24px;text-decoration:none;font-weight:bold;border-radius:8px;">
View Booking in Admin
</a>
</div>

<div style="background:#f9fafb;padding:15px;margin:20px 0;font-size:11px;color:#666;">
<p style="margin:0;"><strong>Technical IDs:</strong></p>
<p style="margin:5px 0 0;">Booking ID: ${booking.id}</p>
<p style="margin:5px 0 0;">Stripe Session ID: ${sessionId}</p>
<p style="margin:5px 0 0;">Payment Intent ID: ${paymentIntentId || "N/A"}</p>
</div>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">This is an internal notification. Do not forward to customers.</p>
<p style="margin:5px 0 0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
</div>

</div>
</body>
</html>`;

  try {
    const client = new SMTPClient({
      connection: {
        hostname: "smtp.gmail.com",
        port: 465,
        tls: true,
        auth: {
          username: gmailUser,
          password: gmailPassword,
        },
      },
    });

    await client.send({
      from: gmailUser,
      to: "orlandoglobalministries@gmail.com",
      subject: `OEV Payment Received (${subjectPrefix}) — ${reservationNumber}`,
      content: `Payment received: ${paymentType} - ${formatCurrency(amountPaid)} for booking ${reservationNumber}`,
      html: emailHTML,
    });

    await client.close();
    console.log(`Internal ${paymentType} payment email sent successfully`);
  } catch (emailError) {
    console.error("Error sending internal payment email:", emailError);
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
    
    const event = await stripe.webhooks.constructEventAsync(
      body,
      signature,
      webhookSecret
    );

    console.log("STRIPE_EVENT:", JSON.stringify({
      type: event.type,
      livemode: event.livemode,
      id: event.id,
    }));

    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const bookingId = session.metadata?.booking_id || session.metadata?.bookingId || session.client_reference_id;
      const paymentType = session.metadata?.payment_type || session.metadata?.paymentType || "deposit";

      // Extract payment details for internal email
      const amountPaid = ((session.amount_total as number) ?? 0) / 100;
      const currency = session.currency || "usd";
      const sessionId = session.id;
      const paymentIntentId = session.payment_intent as string | null;

      console.log("CHECKOUT_SESSION:", JSON.stringify({
        bookingId,
        paymentType,
        sessionId,
        amountPaid,
        currency,
        customer: session.customer,
        paymentIntent: paymentIntentId,
        metadataRaw: session.metadata,
      }));

      if (!bookingId) {
        console.error("MISSING_BOOKING_ID:", JSON.stringify({ metadata: session.metadata, client_reference_id: session.client_reference_id }));
        return new Response("No booking_id", { status: 400 });
      }

      console.log(`Processing ${paymentType} payment for booking:`, bookingId);

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // [IDEMPOTENCY CHECK] Verify this event hasn't been processed before
      const { data: existingEvent } = await supabase
        .from("stripe_event_log")
        .select("id")
        .eq("event_id", event.id)
        .maybeSingle();

      if (existingEvent) {
        console.log(`[IDEMPOTENT_SKIP] Event ${event.id} already processed`);
        return new Response(
          JSON.stringify({ received: true, skipped: "already_processed" }), 
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      // [POLICY GUARD] Check if payment processing is required for this booking
      const { data: bookingWithPolicy, error: policyError } = await supabase
        .from("bookings")
        .select("booking_origin, booking_policies(*)")
        .eq("id", bookingId)
        .single();

      // Extract policy (may be array or object depending on Supabase version)
      const policy = bookingWithPolicy?.booking_policies 
        ? (Array.isArray(bookingWithPolicy.booking_policies) 
            ? bookingWithPolicy.booking_policies[0] 
            : bookingWithPolicy.booking_policies)
        : null;

      if (policyError) {
        console.error("Error fetching booking policy:", policyError);
      } else if (policy?.requires_payment === false) {
        console.log(
          `[POLICY_SKIP] Payment processing skipped ` +
          `(booking: ${bookingId}, origin: ${bookingWithPolicy.booking_origin}, ` +
          `policy: ${policy.policy_name})`
        );
        
        // Log event as policy-skipped
        await supabase.from("stripe_event_log").insert({
          event_id: event.id,
          event_type: event.type,
          booking_id: bookingId,
          metadata: { skipped_reason: "policy_requires_payment_false" }
        });

        return new Response(
          JSON.stringify({ received: true, skipped: "policy" }), 
          {
            headers: { "Content-Type": "application/json" },
            status: 200,
          }
        );
      }

      if (paymentType === "addon_invoice") {
        const invoiceId = session.metadata?.invoice_id;
        console.log(`Processing addon invoice payment: ${invoiceId}`);

        if (!invoiceId) {
          console.error("MISSING_INVOICE_ID in addon_invoice payment");
          return new Response("No invoice_id", { status: 400 });
        }

        const { data: existingInvoice } = await supabase
          .from("booking_addon_invoices")
          .select("paid_at")
          .eq("id", invoiceId)
          .single();

        if (existingInvoice?.paid_at) {
          console.log("Addon invoice already paid, skipping duplicate");
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        const { error: invoiceUpdateError } = await supabase
          .from("booking_addon_invoices")
          .update({
            payment_status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: paymentIntentId,
          })
          .eq("id", invoiceId);

        if (invoiceUpdateError) {
          console.error("Error updating addon invoice:", invoiceUpdateError);
          return new Response("Database error", { status: 500 });
        }

        console.log("Addon invoice marked as paid:", invoiceId);

        // Log the event
        await supabase.from("booking_events").insert({
          booking_id: bookingId,
          event_type: "addon_invoice_paid",
          channel: "stripe",
          metadata: {
            invoice_id: invoiceId,
            session_id: sessionId,
            payment_intent: paymentIntentId,
            amount: amountPaid,
          },
        });

        // Send internal notification email
        const { data: invoiceDetails } = await supabase
          .from("booking_addon_invoices")
          .select("*")
          .eq("id", invoiceId)
          .single();

        const { data: relatedBooking } = await supabase
          .from("bookings")
          .select("*")
          .eq("id", bookingId)
          .single();

        if (relatedBooking) {
          await sendInternalPaymentEmail(
            { ...relatedBooking, addon_invoice_id: invoiceId },
            "deposit",
            amountPaid,
            currency,
            sessionId,
            paymentIntentId
          );
        }

        // Log Stripe event
        await supabase.from("stripe_event_log").insert({
          event_id: event.id,
          event_type: event.type,
          booking_id: bookingId,
          metadata: { payment_type: "addon_invoice", invoice_id: invoiceId, amount_cents: session.amount_total },
        });

        console.log(`[STRIPE_EVENT_LOGGED] addon_invoice ${event.id} for invoice ${invoiceId}`);

        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (paymentType === "standalone_invoice") {
        const standaloneInvoiceId = session.metadata?.invoice_id;
        console.log(`Processing standalone invoice payment: ${standaloneInvoiceId}`);

        if (!standaloneInvoiceId) {
          console.error("MISSING_INVOICE_ID in standalone_invoice payment");
          return new Response("No invoice_id", { status: 400 });
        }

        const { data: existingStandaloneInvoice } = await supabase
          .from("invoices")
          .select("paid_at, customer_email, customer_name, title, amount, invoice_number")
          .eq("id", standaloneInvoiceId)
          .single();

        if (existingStandaloneInvoice?.paid_at) {
          console.log("Standalone invoice already paid, skipping duplicate");
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        const { error: standaloneUpdateError } = await supabase
          .from("invoices")
          .update({
            payment_status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: paymentIntentId,
          })
          .eq("id", standaloneInvoiceId);

        if (standaloneUpdateError) {
          console.error("Error updating standalone invoice:", standaloneUpdateError);
          return new Response("Database error", { status: 500 });
        }

        console.log("Standalone invoice marked as paid:", standaloneInvoiceId);

        // Send admin notification + customer receipt emails
        const gmailUser = Deno.env.get("GMAIL_USER");
        const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

        if (gmailUser && gmailPassword && existingStandaloneInvoice) {
          try {
            const smtpClient = new SMTPClient({
              connection: {
                hostname: "smtp.gmail.com",
                port: 465,
                tls: true,
                auth: { username: gmailUser, password: gmailPassword },
              },
            });

            const inv = existingStandaloneInvoice;
            const amtFormatted = `$${Number(inv.amount).toFixed(2)}`;

            // Admin notification
            await smtpClient.send({
              from: gmailUser,
              to: gmailUser,
              subject: `Invoice Paid: ${inv.invoice_number} – ${amtFormatted}`,
              content: `Invoice ${inv.invoice_number} (${inv.title}) has been paid by ${inv.customer_email}. Amount: ${amtFormatted}.`,
              html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<div style="background:#059669;padding:40px 30px;text-align:center;color:white;">
<h1 style="margin:0;font-size:28px;letter-spacing:1px;">INVOICE PAID</h1>
<p style="margin:12px 0 0;font-size:16px;color:#d1fae5;">A standalone invoice payment has been received.</p>
</div>
<div style="padding:30px;">
<div style="background:#ecfdf5;border:2px solid #10b981;padding:20px;text-align:center;margin:0 0 25px;border-radius:8px;">
<p style="margin:0;font-size:12px;color:#065f46;text-transform:uppercase;letter-spacing:1px;">Amount Received</p>
<p style="margin:5px 0;font-size:32px;font-weight:bold;color:#059669;">${amtFormatted}</p>
</div>
<p style="margin:0 0 15px;font-weight:bold;font-size:15px;color:#111827;">Invoice Details:</p>
<table width="100%" style="border-collapse:collapse;font-size:14px;">
<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#666;width:40%;">Invoice</td><td style="padding:10px 0;font-weight:bold;color:#111827;">${inv.invoice_number}</td></tr>
<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#666;">Title</td><td style="padding:10px 0;color:#111827;">${inv.title}</td></tr>
<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#666;">Customer Email</td><td style="padding:10px 0;color:#111827;">${inv.customer_email}</td></tr>
<tr><td style="padding:10px 0;color:#666;">Amount</td><td style="padding:10px 0;font-weight:bold;color:#059669;">${amtFormatted}</td></tr>
</table>
</div>
<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">This is an internal notification. Do not forward to customers.</p>
<p style="margin:5px 0 0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
</div>
</div></body></html>`,
            });

            // Customer receipt
            const custName = inv.customer_name ? inv.customer_name.split(" ")[0] : "Customer";
            await smtpClient.send({
              from: gmailUser,
              to: inv.customer_email,
              subject: `Payment Confirmation – ${inv.invoice_number} | Orlando Event Venue`,
              content: `Thank you for your payment of ${amtFormatted} for "${inv.title}". Invoice ${inv.invoice_number} is now paid.`,
              html: `<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
<div style="background:#111827;padding:40px 30px;text-align:center;color:white;">
<h1 style="margin:0;font-size:28px;letter-spacing:1px;">PAYMENT CONFIRMATION</h1>
<p style="margin:12px 0 0;font-size:16px;color:#d4d4d8;">Orlando Event Venue</p>
<p style="margin:8px 0 0;font-size:13px;color:#9ca3af;">${inv.invoice_number}</p>
</div>
<div style="padding:30px;">
<p style="margin:0;font-size:16px;">Hi <strong>${custName}</strong>,</p>
<p style="margin:15px 0;font-size:15px;line-height:1.6;color:#374151;">Thank you for your payment! Here's a summary of the transaction:</p>
<div style="background:#ecfdf5;border:2px solid #10b981;border-radius:8px;padding:24px;text-align:center;margin:25px 0;">
<p style="margin:0 0 6px;font-size:12px;color:#065f46;text-transform:uppercase;letter-spacing:1px;">Payment Complete</p>
<p style="margin:0;font-size:32px;font-weight:bold;color:#059669;">${amtFormatted}</p>
</div>
<table width="100%" style="border-collapse:collapse;font-size:14px;margin:20px 0;">
<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#666;width:40%;">Invoice</td><td style="padding:10px 0;font-weight:bold;color:#111827;">${inv.invoice_number}</td></tr>
<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px 0;color:#666;">Description</td><td style="padding:10px 0;color:#111827;">${inv.title}</td></tr>
<tr><td style="padding:10px 0;color:#666;">Status</td><td style="padding:10px 0;font-weight:bold;color:#059669;">Paid</td></tr>
</table>
<p style="margin:25px 0 10px;border-top:1px solid #ddd;padding-top:20px;font-size:14px;line-height:1.6;color:#374151;">Please keep this email as your receipt. If you have any questions, simply reply to this email and we'll be happy to help.</p>
<p style="margin:10px 0 0;"><strong>Orlando Event Venue</strong></p>
</div>
<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated email. Please keep it for your records.</p>
</div>
</div></body></html>`,
            });

            await smtpClient.close();
            console.log("Standalone invoice emails sent for:", standaloneInvoiceId);
          } catch (emailErr) {
            console.error("Error sending standalone invoice emails:", emailErr);
          }
        }

        // Log Stripe event
        await supabase.from("stripe_event_log").insert({
          event_id: event.id,
          event_type: event.type,
          metadata: {
            payment_type: "standalone_invoice",
            invoice_id: standaloneInvoiceId,
            amount_cents: session.amount_total,
          },
        });

        console.log(`[STRIPE_EVENT_LOGGED] standalone_invoice ${event.id} for invoice ${standaloneInvoiceId}`);

        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (paymentType === "balance") {
        // Check if already processed (idempotency)
        const { data: existingBooking } = await supabase
          .from("bookings")
          .select("balance_paid_at, payment_status")
          .eq("id", bookingId)
          .single();

        if (existingBooking?.balance_paid_at) {
          console.log("Balance payment already processed, skipping duplicate");
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        const { data, error } = await supabase
          .from("bookings")
          .update({
            payment_status: "fully_paid",
            balance_paid_at: new Date().toISOString(),
          })
          .eq("id", bookingId)
          .select()
          .single();

        if (error) {
          console.error("Error updating booking for balance payment:", error);
          return new Response("Database error", { status: 500 });
        }

        console.log("Booking fully paid:", data);

        // Cancel any pending balance retry jobs
        const { data: cancelledJobs, error: cancelError } = await supabase
          .from("scheduled_jobs")
          .update({
            status: "cancelled",
            last_error: "payment_completed_before_job_run",
            updated_at: new Date().toISOString(),
          })
          .eq("booking_id", bookingId)
          .in("job_type", ["balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"])
          .eq("status", "pending")
          .select("id, job_type");

        if (cancelError) {
          console.error("Error cancelling pending balance jobs:", cancelError);
        } else if (cancelledJobs && cancelledJobs.length > 0) {
          console.log(`Cancelled ${cancelledJobs.length} pending balance retry jobs:`, cancelledJobs.map(j => j.job_type));
        }

        // Log the balance payment event
        await supabase.from("booking_events").insert({
          booking_id: bookingId,
          event_type: "balance_paid",
          channel: "stripe",
          metadata: {
            session_id: sessionId,
            payment_intent: paymentIntentId,
            amount: data.balance_amount,
            cancelled_jobs: cancelledJobs?.map(j => j.job_type) || [],
          },
        });

        // Send internal email notification
        await sendInternalPaymentEmail(data, "balance", amountPaid, currency, sessionId, paymentIntentId);

        // Send customer balance confirmation email
        try {
          console.log("Sending customer balance confirmation email for booking:", bookingId);
          const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-balance-confirmation`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({
              email: data.email,
              full_name: data.full_name,
              reservation_number: data.reservation_number,
              event_date: data.event_date,
              event_type: data.event_type,
              number_of_guests: data.number_of_guests,
              booking_type: data.booking_type,
              start_time: data.start_time,
              end_time: data.end_time,
              total_amount: data.total_amount,
              deposit_amount: data.deposit_amount,
              balance_amount: data.balance_amount,
              amount_paid: amountPaid,
            }),
          });

          if (!emailResponse.ok) {
            console.error("Failed to send balance confirmation email:", await emailResponse.text());
          } else {
            console.log("Customer balance confirmation email sent successfully");
          }
        } catch (emailError) {
          console.error("Error sending balance confirmation email:", emailError);
        }

        await syncToGHL(bookingId);
        // Calendar sync handled automatically by DB trigger (bookings_sync_ghl_update)

        // Populate revenue items for this booking
        try {
          console.log("[REVENUE] Populating revenue items for booking:", bookingId);
          const { error: revenueError } = await supabase.rpc('populate_booking_revenue_items', {
            p_booking_id: bookingId,
            p_is_historical: false
          });
          
          if (revenueError) {
            console.error('[REVENUE] Failed to populate revenue items:', revenueError);
          } else {
            console.log('[REVENUE] Revenue items populated successfully');
          }
        } catch (revErr) {
          console.error('[REVENUE] Exception populating revenue items:', revErr);
        }

        // Log Stripe event as successfully processed
        await supabase.from("stripe_event_log").insert({
          event_id: event.id,
          event_type: event.type,
          booking_id: bookingId,
          metadata: { payment_type: "balance", amount_cents: session.amount_total }
        });
        console.log(`[STRIPE_EVENT_LOGGED] ${event.id} for booking ${bookingId}`);

      } else {
        // Handle deposit payment
        // Check if already processed (idempotency)
        const { data: existingBooking } = await supabase
          .from("bookings")
          .select("deposit_paid_at, payment_status")
          .eq("id", bookingId)
          .single();

        if (existingBooking?.deposit_paid_at) {
          console.log("Deposit payment already processed, skipping duplicate");
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        const { data, error } = await supabase
          .from("bookings")
          .update({
            payment_status: "deposit_paid",
            deposit_paid_at: new Date().toISOString(),
            stripe_session_id: sessionId,
            stripe_payment_intent_id: paymentIntentId,
          })
          .eq("id", bookingId)
          .select()
          .single();

        if (error) {
          console.error("Error updating booking:", error);
          return new Response("Database error", { status: 500 });
        }

        console.log("Booking updated successfully:", data);

        // Send internal email notification
        await sendInternalPaymentEmail(data, "deposit", amountPaid, currency, sessionId, paymentIntentId);

        // Send customer confirmation email (check policy first)
        const shouldSendConfirmation = policy?.send_customer_confirmation !== false;
        
        if (shouldSendConfirmation) {
          try {
            const emailResponse = await fetch(`${supabaseUrl}/functions/v1/send-booking-confirmation`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
              },
              body: JSON.stringify({
              email: data.email,
              full_name: data.full_name,
              reservation_number: data.reservation_number,
              event_date: data.event_date,
              event_type: data.event_type,
              number_of_guests: data.number_of_guests,
              booking_type: data.booking_type,
              start_time: data.start_time,
              end_time: data.end_time,
              base_rental: data.base_rental,
              cleaning_fee: data.cleaning_fee,
              package: data.package,
              package_cost: data.package_cost,
              package_start_time: data.package_start_time,
              package_end_time: data.package_end_time,
              setup_breakdown: data.setup_breakdown,
              tablecloths: data.tablecloths,
              tablecloth_quantity: data.tablecloth_quantity,
              optional_services: data.optional_services,
              taxes_fees: data.taxes_fees,
              total_amount: data.total_amount,
              deposit_amount: data.deposit_amount,
              balance_amount: data.balance_amount,
            }),
          });

            if (!emailResponse.ok) {
              console.error("Failed to send confirmation email:", await emailResponse.text());
            } else {
              console.log("Customer confirmation email sent successfully");
            }
          } catch (emailError) {
            console.error("Error sending confirmation email:", emailError);
          }
        } else {
          console.log(
            `[POLICY_SKIP] Customer confirmation email skipped ` +
            `(booking: ${bookingId}, policy: ${policy?.policy_name})`
          );
        }

        await syncToGHL(bookingId);
        // Calendar sync handled automatically by DB trigger (bookings_sync_ghl_insert/update)

        // Schedule balance payment jobs
        try {
          console.log("Triggering balance payment scheduling for booking:", bookingId);
          const scheduleResponse = await fetch(
            `${supabaseUrl}/functions/v1/schedule-balance-payment`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseServiceKey}`,
              },
              body: JSON.stringify({ booking_id: bookingId }),
            }
          );
          if (!scheduleResponse.ok) {
            console.error("Balance scheduling failed:", await scheduleResponse.text());
          } else {
            const scheduleResult = await scheduleResponse.json();
            console.log("Balance scheduling result:", JSON.stringify(scheduleResult));
          }
        } catch (scheduleError) {
          console.error("Error scheduling balance payment:", scheduleError);
        }

        // Populate revenue items for this booking
        try {
          console.log("[REVENUE] Populating revenue items for booking:", bookingId);
          const { error: revenueError } = await supabase.rpc('populate_booking_revenue_items', {
            p_booking_id: bookingId,
            p_is_historical: false
          });
          
          if (revenueError) {
            console.error('[REVENUE] Failed to populate revenue items:', revenueError);
          } else {
            console.log('[REVENUE] Revenue items populated successfully');
          }
        } catch (revErr) {
          console.error('[REVENUE] Exception populating revenue items:', revErr);
        }

        // Log Stripe event as successfully processed
        await supabase.from("stripe_event_log").insert({
          event_id: event.id,
          event_type: event.type,
          booking_id: bookingId,
          metadata: { payment_type: "deposit", amount_cents: session.amount_total }
        });
        console.log(`[STRIPE_EVENT_LOGGED] ${event.id} for booking ${bookingId}`);
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const paymentType = session.metadata?.payment_type;

      if (paymentType === "standalone_invoice") {
        const invoiceId = session.metadata?.invoice_id;
        if (invoiceId) {
          const supabase = createClient(supabaseUrl, supabaseServiceKey);
          const { error: expireError } = await supabase
            .from("invoices")
            .update({ payment_status: "expired" })
            .eq("id", invoiceId)
            .eq("payment_status", "pending");

          if (expireError) {
            console.error("Error expiring standalone invoice:", expireError);
          } else {
            console.log("Standalone invoice expired:", invoiceId);
          }
        }
      }
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