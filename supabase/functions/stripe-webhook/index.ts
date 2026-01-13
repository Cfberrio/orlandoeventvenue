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
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>OEV Payment Received</title>
<style>
body{font-family:Arial,sans-serif;line-height:1.6;color:#333;margin:0;padding:0;background:#f3f4f6}
.container{max-width:640px;margin:20px auto;padding:0 12px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08)}
.header{background:linear-gradient(135deg,#059669,#10b981);padding:24px 32px;color:#fff}
.header h1{margin:0 0 4px 0;font-size:22px}
.header p{margin:0;opacity:0.9;font-size:14px}
.badge{display:inline-block;margin-top:12px;padding:4px 10px;border-radius:999px;background:rgba(255,255,255,0.2);font-size:11px;letter-spacing:0.06em;text-transform:uppercase;font-weight:600}
.content{padding:24px 32px}
.amount-box{background:#ecfdf5;border:2px solid #10b981;border-radius:10px;padding:20px;text-align:center;margin:0 0 20px 0}
.amount-box .label{font-size:13px;color:#065f46;text-transform:uppercase;letter-spacing:0.08em;margin:0 0 6px 0}
.amount-box .amount{font-size:32px;font-weight:700;color:#059669;margin:0}
.section{margin:0 0 20px 0}
.section-title{font-size:13px;text-transform:uppercase;letter-spacing:0.08em;color:#6b7280;font-weight:600;margin:0 0 10px 0;border-bottom:1px solid #e5e7eb;padding-bottom:6px}
.field{display:flex;padding:6px 0;font-size:14px}
.field .label{width:45%;color:#6b7280}
.field .value{width:55%;color:#111827;font-weight:500}
.cta-btn{display:inline-block;background:#059669;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px}
.footer{padding:16px 32px;background:#f9fafb;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb}
.ids{font-size:11px;color:#9ca3af;margin-top:16px;padding:12px;background:#f9fafb;border-radius:6px;word-break:break-all}
</style>
</head>
<body>
<div class="container">
<div class="card">
<div class="header">
<h1>💰 Payment Received (${paymentLabel})</h1>
<p>A ${paymentType} payment has been successfully processed.</p>
<div class="badge">Reservation #${reservationNumber}</div>
</div>
<div class="content">
<div class="amount-box">
<div class="label">Amount Paid Now</div>
<div class="amount">${formatCurrency(amountPaid)} ${currency.toUpperCase()}</div>
</div>

<div class="section">
<div class="section-title">Booking Details</div>
<div class="field"><span class="label">Reservation #:</span><span class="value">${reservationNumber}</span></div>
<div class="field"><span class="label">Client Name:</span><span class="value">${booking.full_name || "N/A"}</span></div>
<div class="field"><span class="label">Client Email:</span><span class="value">${booking.email || "N/A"}</span></div>
<div class="field"><span class="label">Client Phone:</span><span class="value">${booking.phone || "N/A"}</span></div>
<div class="field"><span class="label">Event Type:</span><span class="value">${booking.event_type || "N/A"}</span></div>
<div class="field"><span class="label">Event Date:</span><span class="value">${formatDate(booking.event_date as string)}</span></div>
<div class="field"><span class="label">Event Time:</span><span class="value">${formatTime(booking.start_time as string)} - ${formatTime(booking.end_time as string)}</span></div>
<div class="field"><span class="label">Booking Type:</span><span class="value">${booking.booking_type === "daily" ? "Full Day (24h)" : "Hourly"}</span></div>
<div class="field"><span class="label"># of Guests:</span><span class="value">${booking.number_of_guests || "N/A"}</span></div>
</div>

<div class="section">
<div class="section-title">Payment Summary</div>
<div class="field"><span class="label">Payment Type:</span><span class="value" style="text-transform:capitalize">${paymentType}</span></div>
<div class="field"><span class="label">Current Status:</span><span class="value">${booking.payment_status || "N/A"}</span></div>
<div class="field"><span class="label">Total Amount:</span><span class="value">${formatCurrency(Number(booking.total_amount) || 0)}</span></div>
<div class="field"><span class="label">Deposit Amount:</span><span class="value">${formatCurrency(Number(booking.deposit_amount) || 0)}</span></div>
<div class="field"><span class="label">Balance Amount:</span><span class="value">${formatCurrency(Number(booking.balance_amount) || 0)}</span></div>
</div>

<div style="text-align:center;margin:24px 0 16px 0">
<a href="${adminUrl}" class="cta-btn">View Booking in Admin →</a>
</div>

<div class="ids">
<strong>Technical IDs:</strong><br>
Booking ID: ${booking.id}<br>
Stripe Session ID: ${sessionId}<br>
Payment Intent ID: ${paymentIntentId || "N/A"}
</div>
</div>
<div class="footer">
This is an internal notification. Do not forward to customers.<br>
Orlando Event Venue · 3847 E Colonial Dr, Orlando, FL 32803
</div>
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

        await syncToGHL(bookingId);
        // Calendar sync handled automatically by DB trigger (bookings_sync_ghl_update)

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

        // Send customer confirmation email
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