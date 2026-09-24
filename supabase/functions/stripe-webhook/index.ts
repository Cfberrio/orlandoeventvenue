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
  sanitizeForSmtp,
  textModule,
} from "../_shared/email-layout.ts";
import { sendPurchase } from "../_shared/meta-capi.ts";

const stripe = new Stripe(Deno.env.get("Stripe_Secret_Key") || "", {
  apiVersion: "2023-10-16",
});

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
// An unfinished stripe_event_log claim older than this is treated as abandoned.
const STALE_CLAIM_MS = 5 * 60 * 1000;

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function deriveProcessingFee(amountPaid: number, baseAmount: unknown): { fee: number; pct: number | null } {
  const base = Number(baseAmount ?? 0);
  const fee = roundMoney(Math.max(0, amountPaid - base));
  const pct = base > 0 ? roundMoney((fee / base) * 100) : null;
  return { fee, pct };
}

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
      console.error("Failed to sync booking to GHL contact:", bookingId, response.status);
    } else {
      console.log("Successfully synced booking to GHL contact:", bookingId);
    }
  } catch {
    console.error("Error syncing booking to GHL contact:", bookingId);
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
      console.error("Failed to sync booking to GHL calendar:", bookingId, response.status);
    } else {
      console.log("Successfully synced booking to GHL calendar:", bookingId);
    }
  } catch {
    console.error("Error syncing booking to GHL calendar:", bookingId);
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
  
  const adminUrl = `${getFrontendUrl()}/admin/bookings/${booking.id}`;

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
<tr>
<td style="padding:5px 0;color:#666;">Processing Fee (3.5%):</td>
<td style="padding:5px 0;"><strong>Applied per transaction</strong></td>
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
<p style="margin:0;font-weight:bold;color:#666;">Orlando Event Venue Team</p>
<p style="margin:5px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">Orlandoeventvenue@gmail.com | (407) 974-5979</p>
<p style="margin:8px 0 0;">This is an internal notification. Do not forward to customers.</p>
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
      subject: `OEV Payment Received (${subjectPrefix}): ${reservationNumber}`,
      content: `Payment received: ${paymentType} - ${formatCurrency(amountPaid)} for booking ${reservationNumber}`,
      html: emailHTML,
    });

    await client.close();
    console.log(`Internal ${paymentType} payment email sent successfully`);
  } catch {
    console.error("Error sending internal payment email for booking:", booking.id);
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

  let releaseBookingEventClaim: (() => Promise<void>) | null = null;
  let markBookingEventClaimCompleted: () => Promise<void> = async () => {};
  // Once a claim is final, drop the release callback so a later throw cannot
  // delete a claim whose payment transition already committed.
  const finishBookingEventClaim = async () => {
    releaseBookingEventClaim = null;
    await markBookingEventClaimCompleted();
  };

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
      const explicitPaymentType = session.metadata?.payment_type || session.metadata?.paymentType;
      const sessionAdConsent = session.metadata?.ad_consent === "false"
        ? false
        : session.metadata?.ad_consent === "true"
          ? true
          : null;
      // Preserve the legacy business fallback, but never infer a Meta Purchase.
      const paymentType = explicitPaymentType || "deposit";

      // Extract payment details for internal email
      const amountPaid = ((session.amount_total as number) ?? 0) / 100;
      const currency = session.currency || "usd";
      const sessionId = session.id;
      const paymentIntentId = session.payment_intent as string | null;

      console.log("CHECKOUT_SESSION:", JSON.stringify({
        eventId: event.id,
        bookingId,
        paymentType,
        sessionId,
      }));

      // Handle standalone invoices early -- they have no booking_id
      if (paymentType === "standalone_invoice") {
        const standaloneInvoiceId = session.metadata?.invoice_id;
        console.log(`Processing standalone invoice payment: ${standaloneInvoiceId}`);

        if (!standaloneInvoiceId) {
          console.error("MISSING_INVOICE_ID in standalone_invoice payment");
          return new Response("No invoice_id", { status: 400 });
        }

        const supabaseForInvoice = createClient(supabaseUrl, supabaseServiceKey);

        // [IDEMPOTENCY CLAIM] stripe_event_log.event_id is UNIQUE, so inserting
        // it up front lets the database settle who processes this event. Two
        // concurrent deliveries of the same event used to both clear the
        // `paid_at` check below and send the customer two receipts; only one can
        // win this insert. The log row is removed again if processing fails, so
        // Stripe's retry can still get through.
        const { error: claimError } = await supabaseForInvoice
          .from("stripe_event_log")
          .insert({
            event_id: event.id,
            event_type: event.type,
            metadata: {
              payment_type: "standalone_invoice",
              invoice_id: standaloneInvoiceId,
              amount_cents: session.amount_total,
            },
          });

        if (claimError) {
          // 23505 = unique_violation: another delivery already claimed it.
          if (claimError.code === "23505") {
            // A claim on its own does not prove the work finished — the isolate
            // may have died between claiming and marking the invoice paid. Answer
            // 200 (stop retrying) only if the invoice really is paid; otherwise
            // 500 so Stripe delivers again and the payment is not stranded.
            const { data: claimedInvoice, error: claimedReadError } = await supabaseForInvoice
              .from("invoices")
              .select("paid_at")
              .eq("id", standaloneInvoiceId)
              .single();

            if (claimedReadError) {
              console.error(
                `Could not confirm invoice ${standaloneInvoiceId} after a duplicate claim:`,
                claimedReadError
              );
              return new Response("Database error", { status: 500 });
            }

            if (!claimedInvoice?.paid_at) {
              console.error(
                `[IDEMPOTENT_RETRY] Event ${event.id} was claimed but invoice ${standaloneInvoiceId} is still unpaid; asking Stripe to retry`
              );
              return new Response("Claimed but unfinished", { status: 500 });
            }

            console.log(`[IDEMPOTENT_SKIP] Event ${event.id} already processed`);
            return new Response(
              JSON.stringify({ received: true, skipped: "already_processed" }),
              { headers: { "Content-Type": "application/json" }, status: 200 }
            );
          }
          console.error("Error claiming stripe event for standalone invoice:", claimError);
          return new Response("Database error", { status: 500 });
        }

        const releaseEventClaim = async () => {
          const { error: releaseError } = await supabaseForInvoice
            .from("stripe_event_log")
            .delete()
            .eq("event_id", event.id);
          if (releaseError) {
            console.error(`Could not release event claim ${event.id}:`, releaseError);
          }
        };

        const { data: existingStandaloneInvoice, error: standaloneReadError } =
          await supabaseForInvoice
            .from("invoices")
            .select("paid_at, customer_email, customer_name, title, description, amount, subtotal, discount_type, discount_value, discount_amount, invoice_number, line_items, processing_fee, processing_fee_pct, total_charged")
            .eq("id", standaloneInvoiceId)
            .single();

        // A failed read used to fall through: the invoice was marked paid and
        // both emails were skipped (they are guarded on this row), leaving a paid
        // invoice with no receipt and, now that the event is claimed, no retry.
        if (standaloneReadError || !existingStandaloneInvoice) {
          console.error(
            `Could not read standalone invoice ${standaloneInvoiceId}:`,
            standaloneReadError
          );
          await releaseEventClaim();
          return new Response("Database error", { status: 500 });
        }

        if (existingStandaloneInvoice.paid_at) {
          console.log("Standalone invoice already paid, skipping duplicate");
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        const { error: standaloneUpdateError } = await supabaseForInvoice
          .from("invoices")
          .update({
            payment_status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: paymentIntentId,
          })
          .eq("id", standaloneInvoiceId);

        if (standaloneUpdateError) {
          console.error("Error updating standalone invoice:", standaloneUpdateError);
          // Hand the event back so Stripe's retry can process it.
          await releaseEventClaim();
          return new Response("Database error", { status: 500 });
        }

        console.log("Standalone invoice marked as paid:", standaloneInvoiceId);

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
            // What the customer actually paid = subtotal + processing fee.
            // Prefer the persisted total_charged; fall back to Stripe's amount_total (source of truth).
            const subtotalAmt = Number(inv.amount);
            const totalPaidAmt = inv.total_charged != null ? Number(inv.total_charged) : amountPaid;
            const feeAmt = inv.processing_fee != null
              ? Number(inv.processing_fee)
              : Math.max(0, Math.round((totalPaidAmt - subtotalAmt) * 100) / 100);
            const feePct = inv.processing_fee_pct != null ? Number(inv.processing_fee_pct) : 3.5;
            const amtFormatted = `$${totalPaidAmt.toFixed(2)}`;

            await smtpClient.send({
              from: gmailUser,
              to: gmailUser,
              subject: `Invoice Paid: ${inv.invoice_number}, ${amtFormatted}`,
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
<p style="margin:0;font-weight:bold;color:#666;">Orlando Event Venue Team</p>
<p style="margin:5px 0 0;">3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">Orlandoeventvenue@gmail.com | (407) 974-5979</p>
<p style="margin:8px 0 0;">This is an internal notification. Do not forward to customers.</p>
</div>
</div></body></html>`,
            });

            const custName = inv.customer_name ? inv.customer_name.split(" ")[0] : "Customer";
            // With a discount the line items sum to the pre-discount subtotal, not
            // to what was paid, so the discount needs its own row or the receipt
            // rows will not add up to Total Paid.
            const discountAmt = Number(inv.discount_amount ?? 0);
            const preDiscountAmt = inv.subtotal != null ? Number(inv.subtotal) : subtotalAmt;
            const baseLineItems = inv.line_items && Array.isArray(inv.line_items) && inv.line_items.length > 0
              ? inv.line_items
              : [{ label: inv.title, amount: preDiscountAmt }];
            const receiptRows: Array<[string, string]> = baseLineItems.map(
              (item: { label: string; amount: number }) =>
                [escapeHtml(item.label), `$${Number(item.amount).toFixed(2)}`] as [string, string],
            );
            if (discountAmt > 0) {
              const discountLabel =
                inv.discount_type === "percent" && inv.discount_value != null
                  ? `Discount (${Number(inv.discount_value)}%)`
                  : "Discount";
              receiptRows.push([escapeHtml(discountLabel), `−$${discountAmt.toFixed(2)}`]);
            }
            // Append the processing fee so the receipt line items sum to the Total Paid.
            if (feeAmt > 0) {
              receiptRows.push([`Processing Fee (${feePct}%)`, `$${feeAmt.toFixed(2)}`]);
            }
            receiptRows.push(["Total Paid", amtFormatted]);
            const descBlock = inv.description
              ? `<p style="margin:0 0 12px;font-size:14px;color:${BRAND.muted};line-height:1.6;">${escapeHtml(inv.description)}</p>`
              : "";

            const customerBody =
              heroModule({
                display: displayTitle("Payment Confirmation", { size: 36 }),
              }) +
              gap() +
              textModule(
                `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${escapeHtml(custName)}</strong>,</p>` +
                para(`Thank you for your payment! Your invoice has been successfully processed. Here's a summary of your transaction:`) +
                `<div style="background:${BRAND.softBlue};border-radius:14px;padding:22px;text-align:center;margin:22px 0 0;">` +
                `<p style="margin:0 0 6px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:${BRAND.accentDeep};text-transform:uppercase;letter-spacing:1.5px;">Payment Complete</p>` +
                `<p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:32px;font-weight:bold;color:${BRAND.success};">${amtFormatted}</p>` +
                `</div>` +
                `<p style="margin:20px 0 4px;font-size:20px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;color:${BRAND.ink};">${escapeHtml(inv.title)}</p>` +
                descBlock +
                detailTable(receiptRows) +
                para(`Please keep this email as your receipt. If you have any questions, simply reply to this email and we'll be happy to help.`) +
                para(`<strong>Orlando Event Venue</strong>`),
              );

            const customerHTML = sanitizeForSmtp(emailShell({
              title: "Payment Confirmation",
              preview: `Thank you for your payment of ${amtFormatted}. Invoice ${inv.invoice_number} is now paid.`,
              body: customerBody,
            }));

            await smtpClient.send({
              from: gmailUser,
              to: inv.customer_email,
              subject: `Payment Confirmation: ${inv.invoice_number} | Orlando Event Venue`,
              content: `Thank you for your payment of ${amtFormatted} for "${inv.title}". Invoice ${inv.invoice_number} is now paid.`,
              html: customerHTML,
            });

            await smtpClient.close();
            console.log("Standalone invoice emails sent for:", standaloneInvoiceId);
          } catch {
            console.error("Error sending standalone invoice emails:", standaloneInvoiceId);
          }
        }

        // The event was already logged as the idempotency claim above.
        console.log(`[STRIPE_EVENT_LOGGED] standalone_invoice ${event.id} for invoice ${standaloneInvoiceId}`);

        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (!bookingId) {
        console.error("MISSING_BOOKING_ID:", JSON.stringify({ eventId: event.id, sessionId }));
        return new Response("No booking_id", { status: 400 });
      }

      console.log(`Processing ${paymentType} payment for booking:`, bookingId);

      const supabase = createClient(supabaseUrl, supabaseServiceKey);

      // Claim before any booking mutation or side effect. The UNIQUE event_id
      // lets exactly one concurrent Stripe delivery proceed. The claim starts as
      // claim_state "processing" and becomes "completed" only on a finished
      // path, so an isolate killed mid-flight cannot turn every Stripe retry
      // into a 200 for a payment that was never recorded. Rows written before
      // claim_state existed were inserted after processing and count as done.
      const claimMetadata = { payment_type: paymentType, amount_cents: session.amount_total };
      const { error: claimError } = await supabase
        .from("stripe_event_log")
        .insert({
          event_id: event.id,
          event_type: event.type,
          booking_id: bookingId,
          metadata: { ...claimMetadata, claim_state: "processing" },
        });
      if (claimError) {
        if (claimError.code !== "23505") {
          console.error("Error claiming Stripe event:", claimError);
          return new Response("Database error", { status: 500 });
        }
        const { data: existingClaim, error: existingClaimError } = await supabase
          .from("stripe_event_log")
          .select("processed_at, metadata")
          .eq("event_id", event.id)
          .maybeSingle();
        if (existingClaimError) {
          console.error("Error reading Stripe event claim:", existingClaimError);
          return new Response("Database error", { status: 500 });
        }
        const claimState = (existingClaim?.metadata as { claim_state?: string } | null)?.claim_state;
        if (!existingClaim || claimState === undefined || claimState === "completed") {
          console.log(`[IDEMPOTENT_SKIP] Event ${event.id} already processed`);
          return new Response(
            JSON.stringify({ received: true, skipped: "already_processed" }),
            { headers: { "Content-Type": "application/json" }, status: 200 },
          );
        }
        // Unfinished claim. A stale one (worker died) is released so the next
        // Stripe retry can claim it; the conditional paid_at updates below keep
        // that retry from repeating a payment transition that did commit.
        const claimedAt = existingClaim.processed_at ? Date.parse(existingClaim.processed_at) : NaN;
        if (Number.isFinite(claimedAt) && Date.now() - claimedAt > STALE_CLAIM_MS) {
          const { error: staleDeleteError } = await supabase
            .from("stripe_event_log")
            .delete()
            .eq("event_id", event.id)
            .eq("processed_at", existingClaim.processed_at);
          if (staleDeleteError) console.error(`Could not release stale claim ${event.id}:`, staleDeleteError);
          else console.warn(`[STALE_CLAIM_RELEASED] ${event.id}`);
        }
        return new Response("Event processing in progress", { status: 500 });
      }
      markBookingEventClaimCompleted = async () => {
        const { error: completeError } = await supabase
          .from("stripe_event_log")
          .update({ metadata: { ...claimMetadata, claim_state: "completed" } })
          .eq("event_id", event.id);
        if (completeError) console.error(`Could not complete event claim ${event.id}:`, completeError);
      };
      releaseBookingEventClaim = async () => {
        const { error: releaseError } = await supabase
          .from("stripe_event_log")
          .delete()
          .eq("event_id", event.id);
        if (releaseError) console.error(`Could not release event claim ${event.id}:`, releaseError);
      };

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
        
        // Manual/admin and external no-payment bookings stop here and never
        // reach the Stripe-deposit-only Meta Purchase below.
        await finishBookingEventClaim();
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
          if (releaseBookingEventClaim) await releaseBookingEventClaim();
          return new Response("No invoice_id", { status: 400 });
        }

        const { data: claimedInvoice, error: invoiceUpdateError } = await supabase
          .from("booking_addon_invoices")
          .update({
            payment_status: "paid",
            paid_at: new Date().toISOString(),
            stripe_payment_intent_id: paymentIntentId,
          })
          .eq("id", invoiceId)
          .is("paid_at", null)
          .select("id")
          .maybeSingle();

        if (invoiceUpdateError) {
          console.error("Error updating addon invoice:", invoiceUpdateError);
          if (releaseBookingEventClaim) await releaseBookingEventClaim();
          return new Response("Database error", { status: 500 });
        }
        if (!claimedInvoice) {
          console.log("Addon invoice already paid, skipping duplicate");
          await finishBookingEventClaim();
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        console.log("Addon invoice marked as paid:", invoiceId);

        // Fetch the paid invoice to handle bar service propagation
        const { data: paidInvoice, error: paidInvoiceError } = await supabase
          .from("booking_addon_invoices")
          .select("*")
          .eq("id", invoiceId)
          .single();
        if (paidInvoiceError) console.error("Error reading paid addon invoice:", paidInvoiceError);

        // If this add-on includes Bar Service, propagate to booking + insert revenue item
        const aiBarPackage = (paidInvoice as { bar_package?: string } | null)?.bar_package;
        const aiBarSubtotal = Number((paidInvoice as { bar_subtotal?: number } | null)?.bar_subtotal ?? 0);
        if (aiBarPackage && aiBarPackage !== "none" && aiBarSubtotal > 0 && bookingId) {
          const aiBarGuestCount = (paidInvoice as { bar_guest_count?: number } | null)?.bar_guest_count ?? null;
          const aiBarRate = Number((paidInvoice as { bar_rate_per_guest?: number } | null)?.bar_rate_per_guest ?? 0);
          const aiBarLabel = (paidInvoice as { bar_package_label?: string } | null)?.bar_package_label ?? null;

          const { error: barUpdateError } = await supabase
            .from("bookings")
            .update({
              bar_package: aiBarPackage,
              bar_package_label: aiBarLabel,
              bar_guest_count: aiBarGuestCount,
              bar_rate_per_guest: aiBarRate,
              bar_subtotal: aiBarSubtotal,
              beer_wine_service: aiBarPackage === "house_beer_wine" ? true : undefined,
            })
            .eq("id", bookingId);

          if (barUpdateError) {
            console.error("Error propagating bar service to booking:", barUpdateError);
          } else {
            console.log("Bar service propagated to booking:", bookingId, aiBarPackage);
          }

          // Insert a single bar_service revenue line for the add-on payment
          // (80/20 Stripe Connect split was already applied at checkout)
          const paymentDate = new Date().toISOString().split("T")[0];
          const { error: revErr } = await supabase.from("booking_revenue_items").insert({
            booking_id: bookingId,
            item_category: "bar_service",
            item_type: aiBarPackage,
            amount: aiBarSubtotal,
            quantity: aiBarGuestCount,
            unit_price: aiBarRate,
            payment_date: paymentDate,
            payment_split: "addon",
            description: `Bar Service: ${aiBarLabel || aiBarPackage} (Add-on, paid in full)`,
            metadata: {
              source: "addon_invoice",
              addon_invoice_id: invoiceId,
              bar_package: aiBarPackage,
              bar_package_label: aiBarLabel,
              guest_count: aiBarGuestCount,
              rate_per_guest: aiBarRate,
              split: "80_20",
            },
          });
          if (revErr) {
            console.error("Error inserting bar_service revenue item:", revErr);
          }
        }

        // Insert revenue line items for the rest of the add-on components
        // (production, setup_breakdown, tablecloths, misc/optional_services).
        // Each line is marked payment_split='addon' + metadata source='addon_invoice'
        // so reports can distinguish revenue paid AFTER the original reservation.
        // We do NOT mutate the booking's original fields — the add-on stays as its
        // own visible record (booking_addon_invoices + these revenue lines).
        if (paidInvoice && bookingId) {
          const inv = paidInvoice as Record<string, unknown>;
          const paymentDate = new Date().toISOString().split("T")[0];
          const baseMeta = {
            source: "addon_invoice",
            addon_invoice_id: invoiceId,
            split: "80_20",
          };

          const aiPackage = (inv.package as string) || "none";
          const aiPackageCost = Number(inv.package_cost ?? 0);
          if (aiPackage !== "none" && aiPackageCost > 0) {
            const label =
              aiPackage === "basic" ? "Basic Production Package"
              : aiPackage === "led" ? "LED Production Package"
              : aiPackage === "workshop" ? "Workshop Production Package"
              : "Production Package";
            const { error } = await supabase.from("booking_revenue_items").insert({
              booking_id: bookingId,
              item_category: "production",
              item_type: aiPackage,
              amount: aiPackageCost,
              payment_date: paymentDate,
              payment_split: "addon",
              description: `${label} (Add-on, paid in full)`,
              metadata: { ...baseMeta, package: aiPackage },
            });
            if (error) console.error("Error inserting production add-on revenue:", error);
          }

          if (inv.setup_breakdown === true) {
            const { error } = await supabase.from("booking_revenue_items").insert({
              booking_id: bookingId,
              item_category: "addon",
              item_type: "setup_breakdown",
              amount: 75.00,
              payment_date: paymentDate,
              payment_split: "addon",
              description: "Setup & Breakdown Service (Add-on, paid in full)",
              metadata: baseMeta,
            });
            if (error) console.error("Error inserting setup_breakdown add-on revenue:", error);
          }

          const tcQty = Number(inv.tablecloth_quantity ?? 0);
          if (inv.tablecloths === true && tcQty > 0) {
            const tcAmount = Math.round(tcQty * 5.00 * 100) / 100;
            const { error } = await supabase.from("booking_revenue_items").insert({
              booking_id: bookingId,
              item_category: "addon",
              item_type: "tablecloth",
              amount: tcAmount,
              quantity: tcQty,
              unit_price: 5.00,
              payment_date: paymentDate,
              payment_split: "addon",
              description: `Tablecloth Rental x${tcQty} (Add-on, paid in full)`,
              metadata: baseMeta,
            });
            if (error) console.error("Error inserting tablecloth add-on revenue:", error);
          }

          // optional_services_cost is the manual misc amount (excluding tablecloths line)
          const miscAmount = Number(inv.optional_services_cost ?? 0);
          if (miscAmount > 0) {
            const { error } = await supabase.from("booking_revenue_items").insert({
              booking_id: bookingId,
              item_category: "addon",
              item_type: "misc",
              amount: miscAmount,
              payment_date: paymentDate,
              payment_split: "addon",
              description: "Additional Services (Add-on, paid in full)",
              metadata: baseMeta,
            });
            if (error) console.error("Error inserting misc add-on revenue:", error);
          }
        }

        // Log the event
        const { error: addonEventError } = await supabase.from("booking_events").insert({
          booking_id: bookingId,
          event_type: "addon_invoice_paid",
          channel: "stripe",
          metadata: {
            invoice_id: invoiceId,
            session_id: sessionId,
            payment_intent: paymentIntentId,
            amount: amountPaid,
            bar_package: aiBarPackage && aiBarPackage !== "none" ? aiBarPackage : undefined,
          },
        });
        if (addonEventError) console.error("Error logging addon payment event:", addonEventError);

        // Send internal notification email
        const { data: relatedBooking, error: relatedBookingError } = await supabase
          .from("bookings")
          .select("*")
          .eq("id", bookingId)
          .single();
        if (relatedBookingError) console.error("Error reading booking for addon receipt:", relatedBookingError);

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

        await finishBookingEventClaim();

        console.log(`[STRIPE_EVENT_LOGGED] addon_invoice ${event.id} for invoice ${invoiceId}`);

        return new Response(JSON.stringify({ received: true }), {
          headers: { "Content-Type": "application/json" },
          status: 200,
        });
      }

      if (paymentType === "balance") {
        const { data: currentBooking, error: currentBookingError } = await supabase
          .from("bookings")
          .select("balance_amount")
          .eq("id", bookingId)
          .single();

        if (currentBookingError) {
          console.error("Error fetching booking before balance update:", currentBookingError);
          if (releaseBookingEventClaim) await releaseBookingEventClaim();
          return new Response("Database error", { status: 500 });
        }

        const balanceFeeInfo = deriveProcessingFee(amountPaid, currentBooking?.balance_amount);

        const { data, error } = await supabase
          .from("bookings")
          .update({
            payment_status: "fully_paid",
            balance_paid_at: new Date().toISOString(),
            balance_fee: balanceFeeInfo.fee,
            balance_total_charged: amountPaid,
            ...(balanceFeeInfo.pct != null ? { processing_fee_pct: balanceFeeInfo.pct } : {}),
          })
          .eq("id", bookingId)
          .is("balance_paid_at", null)
          .select()
          .maybeSingle();

        if (error) {
          console.error("Error updating booking for balance payment:", error);
          if (releaseBookingEventClaim) await releaseBookingEventClaim();
          return new Response("Database error", { status: 500 });
        }
        if (!data) {
          console.log("Balance payment already processed, skipping duplicate");
          await finishBookingEventClaim();
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        console.log("Booking fully paid:", bookingId);

        // Reconciliation guard: Stripe's charged total must equal the persisted balance_total_charged.
        if (data.balance_total_charged != null && Math.abs(amountPaid - Number(data.balance_total_charged)) > 0.01) {
          console.warn(
            `RECONCILE_MISMATCH balance: Stripe charged $${amountPaid} but balance_total_charged=$${data.balance_total_charged} (booking ${bookingId})`
          );
        }

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
        const { error: balanceEventError } = await supabase.from("booking_events").insert({
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
        if (balanceEventError) console.error("Error logging balance payment event:", balanceEventError);

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
              // Persisted fee fields so the balance PDF shows exactly what Stripe charged
              processing_fee_pct: data.processing_fee_pct,
              balance_fee: data.balance_fee,
              balance_total_charged: data.balance_total_charged,
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
              bar_package: data.bar_package,
              bar_package_label: data.bar_package_label,
              bar_guest_count: data.bar_guest_count,
              bar_subtotal: data.bar_subtotal,
              bar_rate_per_guest: data.bar_rate_per_guest,
            }),
          });

          if (!emailResponse.ok) {
            console.error("Failed to send balance confirmation email:", bookingId, emailResponse.status);
          } else {
            console.log("Customer balance confirmation email sent successfully");
          }
        } catch {
          console.error("Error sending balance confirmation email:", bookingId);
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

        console.log(`[STRIPE_EVENT_LOGGED] ${event.id} for booking ${bookingId}`);

      } else {
        // Handle deposit payment
        const { data: currentBooking, error: currentBookingError } = await supabase
          .from("bookings")
          .select("deposit_amount")
          .eq("id", bookingId)
          .single();

        if (currentBookingError) {
          console.error("Error fetching booking before deposit update:", currentBookingError);
          if (releaseBookingEventClaim) await releaseBookingEventClaim();
          return new Response("Database error", { status: 500 });
        }

        const depositFeeInfo = deriveProcessingFee(amountPaid, currentBooking?.deposit_amount);

        const { data, error } = await supabase
          .from("bookings")
          .update({
            payment_status: "deposit_paid",
            deposit_paid_at: new Date().toISOString(),
            stripe_session_id: sessionId,
            stripe_payment_intent_id: paymentIntentId,
            deposit_fee: depositFeeInfo.fee,
            deposit_total_charged: amountPaid,
            ...(depositFeeInfo.pct != null ? { processing_fee_pct: depositFeeInfo.pct } : {}),
          })
          .eq("id", bookingId)
          .is("deposit_paid_at", null)
          .select()
          .maybeSingle();

        if (error) {
          console.error("Error updating booking:", error);
          if (releaseBookingEventClaim) await releaseBookingEventClaim();
          return new Response("Database error", { status: 500 });
        }
        if (!data) {
          console.log("Deposit payment already processed, skipping duplicate");
          await finishBookingEventClaim();
          return new Response(JSON.stringify({ received: true, skipped: "duplicate" }), {
            headers: { "Content-Type": "application/json" },
            status: 200,
          });
        }

        console.log("Booking updated successfully:", bookingId);

        // Meta Purchase, server half — the authoritative one. This branch is
        // reached only by the call that actually flipped the booking to
        // deposit_paid (the deposit_paid_at guard above returns early on a
        // retry), and meta_event_delivery.meta_event_id is UNIQUE besides, so
        // a webhook redelivery can never produce a second Purchase.
        //
        // The balance payment and add-on invoices deliberately do NOT send
        // one: one booking is one conversion, or every channel would look
        // twice as efficient as it is.
        if (sessionAdConsent === false) {
          // This value was snapshotted into Stripe before redirect, so it is
          // authoritative even when the parallel booking update did not land.
          console.warn(
            `[stripe-webhook] Meta Purchase skipped for booking ${bookingId}: ad consent rejected`,
          );
        } else if (explicitPaymentType === "deposit" && bookingWithPolicy?.booking_origin === "website") {
          try {
            await sendPurchase(bookingId);
          } catch {
            // Ad delivery must never propagate into the payment path.
            console.error("[stripe-webhook] Meta Purchase failed:", bookingId);
          }
        } else {
          // Manual/admin-paid rows never enter this webhook. External bookings
          // and missing/unknown payment_type are intentionally not conversions.
          console.warn(`[stripe-webhook] Meta Purchase skipped for booking ${bookingId}: payment type/origin not eligible`);
        }

        // Reconciliation guard: Stripe's charged total must equal the persisted deposit_total_charged.
        if (data.deposit_total_charged != null && Math.abs(amountPaid - Number(data.deposit_total_charged)) > 0.01) {
          console.warn(
            `RECONCILE_MISMATCH deposit: Stripe charged $${amountPaid} but deposit_total_charged=$${data.deposit_total_charged} (booking ${bookingId})`
          );
        }

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
              // Persisted fee fields so the deposit PDF shows exactly what Stripe charged
              processing_fee_pct: data.processing_fee_pct,
              deposit_fee: data.deposit_fee,
              deposit_total_charged: data.deposit_total_charged,
              bar_package: data.bar_package,
              bar_package_label: data.bar_package_label,
              bar_guest_count: data.bar_guest_count,
              bar_subtotal: data.bar_subtotal,
              bar_rate_per_guest: data.bar_rate_per_guest,
            }),
          });

            if (!emailResponse.ok) {
              console.error("Failed to send confirmation email:", bookingId, emailResponse.status);
            } else {
              console.log("Customer confirmation email sent successfully");
            }
          } catch {
            console.error("Error sending confirmation email:", bookingId);
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
            console.log("Balance scheduling succeeded for booking:", bookingId);
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

        console.log(`[STRIPE_EVENT_LOGGED] ${event.id} for booking ${bookingId}`);
      }
      await finishBookingEventClaim();
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
    if (releaseBookingEventClaim) {
      // The paid-at conditional transition prevents a retry from replaying
      // side effects if payment state was already committed before failure.
      await releaseBookingEventClaim();
    }
    console.error("Webhook processing failed");
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(`Webhook Error: ${errorMessage}`, { status: releaseBookingEventClaim ? 500 : 400 });
  }
});
