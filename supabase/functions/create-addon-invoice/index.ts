import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { getFrontendUrl } from "../_shared/config.ts";
import { authorizeAdminOrService, supabaseAdminAuthDeps } from "../_shared/admin-auth.ts";
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
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PACKAGE_LABELS: Record<string, string> = {
  none: "Services Only",
  basic: "Basic Package",
  led: "LED Package",
  workshop: "Workshop Package",
};

// Fields that make two add-on invoices "the same items".
const TWIN_FIELDS = [
  "package",
  "package_start_time",
  "package_end_time",
  "setup_breakdown",
  "tablecloths",
  "tablecloth_quantity",
  "bar_package",
  "bar_guest_count",
] as const;

type AddonInvoiceRow = Record<string, unknown> & { id: string; booking_id: string };

function isAddonTwin(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return TWIN_FIELDS.every((f) => (a[f] ?? null) === (b[f] ?? null));
}

// Expire older unpaid invoices for the same booking and the same items,
// BEFORE the new link exists (Codex review). Blocking: the caller creates and
// emails the new link only when every twin is conclusively dead.
//  - twin already paid in Stripe → stop: the guest paid this item already.
//  - Stripe or DB failure → stop: never leave two live links.
type SupersedeOutcome = { ok: true } | { ok: false; status: number; error: string };

async function supersedeAddonTwins(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  stripe: Stripe,
  invoice: AddonInvoiceRow,
): Promise<SupersedeOutcome> {
  const fail = (status: number, error: string): SupersedeOutcome => ({ ok: false, status, error });
  try {
    const { data: siblings, error } = await supabase
      .from("booking_addon_invoices")
      .select("*")
      .eq("booking_id", invoice.booking_id)
      .eq("payment_status", "pending")
      .is("paid_at", null)
      .neq("id", invoice.id);
    if (error) {
      console.error("[ADDON_SUPERSEDE] could not list sibling invoices:", error);
      return fail(500, "Could not check for an older link for the same items. No link was sent; try again.");
    }
    for (const twin of (siblings ?? []) as AddonInvoiceRow[]) {
      if (!isAddonTwin(twin, invoice)) continue;
      const sessionId = typeof twin.stripe_session_id === "string" ? twin.stripe_session_id : null;
      if (sessionId) {
        try {
          const live = await stripe.checkout.sessions.retrieve(sessionId);
          if (live.status === "complete") {
            console.warn(`[ADDON_SUPERSEDE] twin ${twin.id} already paid in Stripe; not sending a second link`);
            return fail(409, "The guest already paid an identical add-on invoice for this booking. No new link was sent.");
          }
          if (live.status === "open") {
            const expired = await stripe.checkout.sessions.expire(sessionId);
            if (expired.status !== "expired") {
              return fail(409, "An older link for the same items could not be closed. No new link was sent.");
            }
          }
        } catch (stripeErr) {
          console.error(`[ADDON_SUPERSEDE] could not expire session for twin ${twin.id}:`, stripeErr);
          return fail(502, "Could not close the older link for the same items in Stripe. No new link was sent; try again.");
        }
      }
      const { error: markError } = await supabase
        .from("booking_addon_invoices")
        .update({ payment_status: "expired" })
        .eq("id", twin.id)
        .eq("payment_status", "pending")
        .is("paid_at", null);
      if (markError) {
        // The Stripe session is already dead; the row will be corrected by
        // the hourly job. Not a reason to block the new link.
        console.error(`[ADDON_SUPERSEDE] could not mark twin ${twin.id} expired:`, markError);
      }
      const { error: eventError } = await supabase.from("booking_events").insert({
        booking_id: invoice.booking_id,
        event_type: "addon_invoice_superseded",
        channel: "admin",
        metadata: { superseded_invoice_id: twin.id, replaced_by_invoice_id: invoice.id },
      });
      if (eventError) console.error("[ADDON_SUPERSEDE] could not log event:", eventError);
    }

    // A row the hourly job marked expired by AGE may still have been paid in
    // Stripe whose webhook is delayed (Stripe retries for days). Before a new
    // link for the same items goes out, ask Stripe about recently expired,
    // unpaid twins; a completed one blocks the new link (Codex review).
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: expiredTwins, error: expiredError } = await supabase
      .from("booking_addon_invoices")
      .select("*")
      .eq("booking_id", invoice.booking_id)
      .eq("payment_status", "expired")
      .is("paid_at", null)
      .not("stripe_session_id", "is", null)
      .gte("created_at", since)
      .neq("id", invoice.id);
    if (expiredError) {
      console.error("[ADDON_SUPERSEDE] could not list expired twins:", expiredError);
      return fail(500, "Could not check older links for the same items. No link was sent; try again.");
    }
    for (const twin of (expiredTwins ?? []) as AddonInvoiceRow[]) {
      if (!isAddonTwin(twin, invoice)) continue;
      try {
        const live = await stripe.checkout.sessions.retrieve(String(twin.stripe_session_id));
        if (live.status === "complete") {
          console.warn(`[ADDON_SUPERSEDE] expired twin ${twin.id} was paid in Stripe; webhook pending`);
          return fail(409, "The guest already paid an identical add-on invoice for this booking (Stripe is still confirming it). No new link was sent.");
        }
      } catch (stripeErr) {
        console.error(`[ADDON_SUPERSEDE] could not check expired twin ${twin.id}:`, stripeErr);
        return fail(502, "Could not confirm in Stripe that an older link for the same items was not paid. No new link was sent; try again.");
      }
    }

    return { ok: true };
  } catch (err) {
    console.error("[ADDON_SUPERSEDE] unexpected error:", err);
    return fail(500, "Could not check for an older link for the same items. No link was sent; try again.");
  }
}

interface AddonInvoiceRequest {
  invoice_id: string;
  // Ignored since S-3: recipient, name, date and reservation number are read
  // from the booking the invoice belongs to.
  customer_email?: string;
  customer_name?: string;
  event_date?: string;
  reservation_number?: string;
}

function buildInvoiceEmailHTML(
  customerName: string,
  reservationNumber: string,
  eventDate: string,
  lineItems: { label: string; amount: string }[],
  totalAmount: string,
  paymentUrl: string
): string {
  const firstName = escapeHtml(customerName.split(" ")[0]);
  const formattedDate = new Date(eventDate).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const detailRows: Array<[string, string]> = [
    ["Service", "Amount"],
    ...lineItems.map((item) => [escapeHtml(item.label), escapeHtml(item.amount)] as [string, string]),
    ["Total Due", totalAmount],
  ];

  const body =
    heroModule({
      display: displayTitle("Additional Services", { size: 36 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
      para(
        `Great news! Additional services have been added to your event on <strong>${formattedDate}</strong>. Here's a quick breakdown of what's been included:`,
      ) +
      detailTable(detailRows) +
      para(
        `To confirm these add-ons, please complete payment using the button below. Once paid, everything will be set for your event day!`,
      ) +
      primaryButton("Complete Payment", paymentUrl) +
      `<p style="margin:14px 0 0;font-size:11.5px;line-height:1.5;color:${BRAND.muted};text-align:center;font-family:Arial,Helvetica,sans-serif;">If the button doesn't work, copy and paste this link:<br><a href="${paymentUrl}" style="word-break:break-all;color:${BRAND.accent};text-decoration:none;">${paymentUrl}</a></p>` +
      para(
        `If you have any questions about these services, just reply to this email and we'll be happy to help.`,
      ) +
      para(`<strong>Orlando Event Venue Team</strong>`),
    );

  return emailShell({
    title: "Additional Services",
    preview: "We've added new services to your upcoming event.",
    body,
  });
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // S-3 (ClickUp 86e40ach2): creates a live Stripe payment link and emails
    // it, so only the admin dashboard (or a service-role caller) may run it.
    const auth = await authorizeAdminOrService(
      req.headers.get("Authorization"),
      supabaseServiceKey,
      supabaseAdminAuthDeps(supabase),
    );
    if (!auth.ok) {
      return new Response(
        JSON.stringify({ error: auth.error }),
        { status: auth.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { invoice_id }: AddonInvoiceRequest = await req.json();

    if (!invoice_id) {
      return new Response(
        JSON.stringify({ error: "invoice_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Processing addon invoice:", invoice_id);

    // Fetch dynamic pricing from venue_pricing table
    const { data: pricingRows, error: pricingError } = await supabase
      .from("venue_pricing")
      .select("item_key, price, extra_fee")
      .eq("is_active", true);

    if (pricingError) console.error("Failed to fetch venue_pricing:", pricingError);

    const pricingMap: Record<string, { price: number; extra_fee: number }> = {};
    for (const row of pricingRows ?? []) {
      pricingMap[row.item_key] = { price: Number(row.price), extra_fee: Number(row.extra_fee ?? 0) };
    }

    const SETUP_PRICE = pricingMap["setup_breakdown"]?.price ?? 100;
    const TABLECLOTH_UNIT_PRICE = pricingMap["tablecloth_rental"]?.price ?? 5;
    const TABLECLOTH_CLEANING = pricingMap["tablecloth_rental"]?.extra_fee ?? 25;
    const PROCESSING_FEE_PCT = pricingMap["processing_fee"]?.price ?? 3.5;

    const { data: invoice, error: invoiceError } = await supabase
      .from("booking_addon_invoices")
      .select("*")
      .eq("id", invoice_id)
      .single();

    if (invoiceError || !invoice) {
      console.error("Invoice not found:", invoiceError);
      return new Response(
        JSON.stringify({ error: "Invoice not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // One Checkout Session per invoice row. Re-running would overwrite the
    // session id the webhook and the expiry job match on, and email a second
    // link for the same row (M-30, 86e40ach2). A new link = a new invoice.
    if (invoice.paid_at || invoice.payment_status !== "pending" || invoice.stripe_session_id) {
      return new Response(
        JSON.stringify({ error: "This add-on invoice already has a payment link or is closed. Create a new invoice instead." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Recipient and email details come from the booking, never the request.
    const { data: invoiceBooking, error: invoiceBookingError } = await supabase
      .from("bookings")
      .select("email, full_name, event_date, reservation_number")
      .eq("id", invoice.booking_id)
      .single();

    if (invoiceBookingError || !invoiceBooking) {
      console.error("Booking for add-on invoice not found:", invoiceBookingError);
      return new Response(
        JSON.stringify({ error: "Booking not found for this invoice" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const customer_email = String(invoiceBooking.email ?? "").trim().toLowerCase();
    const customer_name = String(invoiceBooking.full_name ?? "").trim() || "Customer";
    const event_date = String(invoiceBooking.event_date ?? "");
    const reservation_number = String(invoiceBooking.reservation_number ?? "");
    if (!customer_email || !customer_email.includes("@")) {
      return new Response(
        JSON.stringify({ error: "Booking has no valid customer email" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const stripeSecretKey = Deno.env.get("Stripe_Secret_Key");
    if (!stripeSecretKey) {
      throw new Error("Stripe secret key not configured");
    }

    const stripe = new Stripe(stripeSecretKey, { apiVersion: "2023-10-16" });

    const stripeLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const emailLineItems: { label: string; amount: string }[] = [];

    if (invoice.package !== "none" && Number(invoice.package_cost) > 0) {
      const packageLabel = PACKAGE_LABELS[invoice.package] || invoice.package;
      let hours = 0;
      if (invoice.package_start_time && invoice.package_end_time) {
        const start = new Date(`2000-01-01T${invoice.package_start_time}`);
        const end = new Date(`2000-01-01T${invoice.package_end_time}`);
        hours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
      }
      const description = hours > 0 ? `${packageLabel} (${hours}h)` : packageLabel;

      stripeLineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: description,
            description: `Production package for event on ${event_date}`,
          },
          unit_amount: Math.round(Number(invoice.package_cost) * 100),
        },
        quantity: 1,
      });
      emailLineItems.push({ label: description, amount: `$${Number(invoice.package_cost).toFixed(2)}` });
    }

    if (invoice.setup_breakdown) {
      const setupCents = Math.round(SETUP_PRICE * 100);
      stripeLineItems.push({
        price_data: {
          currency: "usd",
          product_data: { name: "Setup & Breakdown of Chairs/Tables" },
          unit_amount: setupCents,
        },
        quantity: 1,
      });
      emailLineItems.push({ label: "Setup & Breakdown", amount: `$${SETUP_PRICE.toFixed(2)}` });
    }

    if (invoice.tablecloths && Number(invoice.tablecloth_quantity) > 0) {
      const tableclothTotal = Number(invoice.tablecloth_quantity) * TABLECLOTH_UNIT_PRICE + TABLECLOTH_CLEANING;
      stripeLineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: `Tablecloth Rental (${invoice.tablecloth_quantity} tablecloths)`,
            description: `${invoice.tablecloth_quantity} x $${TABLECLOTH_UNIT_PRICE} + $${TABLECLOTH_CLEANING} cleaning fee`,
          },
          unit_amount: Math.round(tableclothTotal * 100),
        },
        quantity: 1,
      });
      emailLineItems.push({
        label: `Tablecloths (${invoice.tablecloth_quantity} x $${TABLECLOTH_UNIT_PRICE} + $${TABLECLOTH_CLEANING} cleaning)`,
        amount: `$${tableclothTotal.toFixed(2)}`,
      });
    }

    // Bar Service
    const barPackage = (invoice as { bar_package?: string }).bar_package;
    const barSubtotal = Number((invoice as { bar_subtotal?: number }).bar_subtotal ?? 0);
    const barGuestCount = Number((invoice as { bar_guest_count?: number }).bar_guest_count ?? 0);
    const barRate = Number((invoice as { bar_rate_per_guest?: number }).bar_rate_per_guest ?? 0);
    const barLabel = (invoice as { bar_package_label?: string }).bar_package_label || barPackage || "Bar Service";
    if (barPackage && barPackage !== "none" && barSubtotal > 0) {
      stripeLineItems.push({
        price_data: {
          currency: "usd",
          product_data: {
            name: `Bar Service: ${barLabel}`,
            description: `${barGuestCount} guests × $${barRate.toFixed(2)}/guest`,
          },
          unit_amount: Math.round(barSubtotal * 100),
        },
        quantity: 1,
      });
      emailLineItems.push({
        label: `Bar Service: ${barLabel} (${barGuestCount} × $${barRate.toFixed(2)})`,
        amount: `$${barSubtotal.toFixed(2)}`,
      });
    }

    if (stripeLineItems.length === 0) {
      return new Response(
        JSON.stringify({ error: "No items to charge" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const PROCESSING_FEE_RATE = PROCESSING_FEE_PCT / 100;
    const baseAmountCents = stripeLineItems.reduce(
      (sum, item) => sum + (item.price_data?.unit_amount || 0), 0
    );
    const feeCents = Math.round(baseAmountCents * PROCESSING_FEE_RATE);
    console.log(`Addon invoice fee: base=${baseAmountCents}c, fee=${feeCents}c`);

    const feeLabel = `Processing Fee (${PROCESSING_FEE_PCT}%)`;
    stripeLineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: feeLabel },
        unit_amount: feeCents,
      },
      quantity: 1,
    });
    emailLineItems.push({ label: feeLabel, amount: `$${(feeCents / 100).toFixed(2)}` });

    const customers = await stripe.customers.list({ email: customer_email, limit: 1 });
    let customerId: string;
    if (customers.data.length > 0) {
      customerId = customers.data[0].id;
    } else {
      const newCustomer = await stripe.customers.create({
        email: customer_email,
        name: customer_name,
        metadata: { booking_id: invoice.booking_id },
      });
      customerId = newCustomer.id;
    }

    const origin = getFrontendUrl();

    const connectedAccountId = Deno.env.get("STRIPE_CONNECTED_ACCOUNT_ID");
    const totalAmountCentsWithFee = stripeLineItems.reduce(
      (sum, item) => sum + (item.price_data?.unit_amount || 0), 0
    );

    // M-30: close any older unpaid link for the same items first.
    const superseded = await supersedeAddonTwins(supabase, stripe, invoice);
    if (!superseded.ok) {
      return new Response(
        JSON.stringify({ error: superseded.error }),
        { status: superseded.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Idempotency key per invoice row: two concurrent calls for the same row
    // get the SAME Checkout Session from Stripe, never two payable links.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ["card"],
      line_items: stripeLineItems,
      mode: "payment",
      success_url: `${origin}/booking-confirmation?session_id={CHECKOUT_SESSION_ID}&booking_id=${invoice.booking_id}&type=addon`,
      cancel_url: `${origin}/booking-confirmation?cancelled=true&booking_id=${invoice.booking_id}&type=addon`,
      metadata: {
        booking_id: invoice.booking_id,
        invoice_id: invoice.id,
        payment_type: "addon_invoice",
        reservation_number: reservation_number || "",
      },
      ...(connectedAccountId ? {
        payment_intent_data: {
          transfer_data: {
            destination: connectedAccountId,
            amount: Math.round(totalAmountCentsWithFee * 0.20),
          },
        },
      } : {}),
    }, { idempotencyKey: `addon-invoice-session-${invoice.id}` });

    console.log("Stripe checkout session created:", session.id, "URL:", session.url);

    // The idempotency key replays the first session for this row for 24h. If
    // that session was already closed (an earlier failed attempt expired it),
    // never email it: the row is spent, a new invoice gets a new key.
    if (session.status !== "open" || !session.url) {
      return new Response(
        JSON.stringify({ error: "The payment link for this invoice was already closed. Create a new invoice instead." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Atomic claim: only the call that stores the session id sends the email.
    const { data: claimedRow, error: updateError } = await supabase
      .from("booking_addon_invoices")
      .update({
        payment_url: session.url,
        stripe_session_id: session.id,
        link_created_at: new Date().toISOString(),
        processing_fee_pct: PROCESSING_FEE_PCT,
        processing_fee: feeCents / 100,
        total_charged: (baseAmountCents + feeCents) / 100,
      })
      .eq("id", invoice.id)
      .is("stripe_session_id", null)
      .select("id")
      .maybeSingle();

    if (updateError && (updateError as { code?: string }).code === "23505") {
      // DB-enforced: another link for the same items on this booking became
      // active first (booking_addon_invoices_one_active_link_uidx).
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireErr) {
        console.error("Could not expire losing add-on session:", session.id, expireErr);
      }
      return new Response(
        JSON.stringify({ error: "Another payment link for the same items is already active on this booking. No new link was sent." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (updateError) {
      // Without the session id on the row, the webhook and the expiry job
      // cannot match it, and the 409 guard would allow a second link. Kill the
      // session and stop before emailing a link the system cannot track.
      console.error("Error updating invoice with payment URL:", updateError);
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireErr) {
        console.error("Could not expire untracked add-on session:", session.id, expireErr);
      }
      return new Response(
        JSON.stringify({ error: "Could not save the payment link. No email was sent; create a new invoice." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!claimedRow) {
      // Another call for this row stored a session first. With the idempotency
      // key it is this same session, already emailed by that call: do not
      // email again. A different session would be a second payable link: kill it.
      const { data: current } = await supabase
        .from("booking_addon_invoices")
        .select("stripe_session_id, payment_url")
        .eq("id", invoice.id)
        .maybeSingle();
      if (current?.stripe_session_id === session.id) {
        return new Response(
          JSON.stringify({ success: true, payment_url: current?.payment_url ?? session.url, session_id: session.id, already_sent: true }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (expireErr) {
        console.error("Could not expire losing add-on session:", session.id, expireErr);
      }
      return new Response(
        JSON.stringify({ error: "This add-on invoice already has a payment link. Create a new invoice instead." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Revalidate right before emailing: a concurrent request for a twin may
    // have closed this link after we stored it. Residual (accepted): a
    // replacement landing between this check and SMTP can still produce one
    // email with a dead link; no money moves, and only one admin login exists.
    const { data: beforeSend, error: beforeSendError } = await supabase
      .from("booking_addon_invoices")
      .select("payment_status, stripe_session_id")
      .eq("id", invoice.id)
      .maybeSingle();
    if (beforeSendError || beforeSend?.payment_status !== "pending" || beforeSend?.stripe_session_id !== session.id) {
      console.warn("[ADDON] link closed before email; not sending", invoice.id, beforeSendError);
      return new Response(
        JSON.stringify({ error: "This link was replaced by another invoice for the same items before it was sent. No email was sent." }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send email with payment link
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

    if (gmailUser && gmailPassword && session.url) {
      try {
        const client = new SMTPClient({
          connection: {
            hostname: "smtp.gmail.com",
            port: 465,
            tls: true,
            auth: { username: gmailUser, password: gmailPassword },
          },
        });

        const totalWithFeeCents = baseAmountCents + feeCents;
        const totalFormatted = `$${(totalWithFeeCents / 100).toFixed(2)}`;
        const emailHTML = sanitizeForSmtp(buildInvoiceEmailHTML(
          customer_name,
          reservation_number,
          event_date,
          emailLineItems,
          totalFormatted,
          session.url
        ));

        await client.send({
          from: gmailUser,
          to: customer_email,
          subject: `Additional Services Invoice: ${reservation_number} | Orlando Event Venue`,
          content: `You have a new invoice of ${totalFormatted} for additional services. Pay here: ${session.url}`,
          html: emailHTML,
        });

        await client.close();
        console.log("Invoice email sent to:", customer_email);
      } catch (emailError) {
        console.error("Error sending invoice email:", emailError);
      }
    } else {
      console.warn("Gmail credentials not configured, skipping invoice email");
    }

    // Log the event
    await supabase.from("booking_events").insert({
      booking_id: invoice.booking_id,
      event_type: "addon_invoice_created",
      channel: "admin",
      metadata: {
        invoice_id: invoice.id,
        total_amount: invoice.total_amount,
        stripe_session_id: session.id,
        payment_url: session.url,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        payment_url: session.url,
        session_id: session.id,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in create-addon-invoice:", error);
    const errorMessage = error instanceof Error ? error.message : "Internal server error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
