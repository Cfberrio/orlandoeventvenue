import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import { getFrontendUrl } from "../_shared/config.ts";
import { toCents } from "../_shared/booking-pricing.ts";
import { authorizeCaller, loadLatestSnapshot, logBookingEvent, sendBillingAlert } from "../_shared/billing-server.ts";
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
  referenceModule,
  sanitizeForSmtp,
  signature,
  textModule,
} from "../_shared/email-layout.ts";
import { eventTypeLabel } from "../_shared/event-types.ts";
import { splitLabel } from "../_shared/deposit-split.ts";

import { withBuild } from "../_shared/build-info.ts";
import { balanceDue, bookingTypeLabel, formatLongDate, orlandoToday } from "../_shared/guest-timeline.ts";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ghl-backend-token",
};

interface BalancePaymentRequest {
  booking_id: string;
}

serve(withBuild(async (req) => {
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
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const caller = await authorizeCaller(req, authClient, ["ghl", "service", "admin"]);

    if (!caller) {
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
    // Optional Stripe idempotency key. schedule-balance-payment sends one on
    // its reschedule path so two overlapping reschedules of the same booking
    // get the same Checkout Session instead of two payable links.
    const idempotencyKey =
      typeof body.idempotency_key === "string" && /^[A-Za-z0-9:_.-]{1,200}$/.test(body.idempotency_key)
        ? body.idempotency_key
        : undefined;

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

    if (booking.status === "cancelled") {
      console.log("Booking is cancelled; no balance link");
      return new Response(JSON.stringify({
        error: "Booking is cancelled",
        status: booking.status,
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
    // M-17 (86e40ach2): the balance fee uses the % the guest was quoted at
    // checkout (stored on the booking), not today's price list. M-16: no
    // silent 3.5% fallback when neither is available.
    const storedPct = booking.processing_fee_pct != null ? Number(booking.processing_fee_pct) : NaN;
    const livePct = feeRow?.price != null ? Number(feeRow.price) : NaN;
    const FEE_PCT = Number.isFinite(storedPct) && storedPct >= 0 ? storedPct : livePct;
    if (!Number.isFinite(FEE_PCT)) {
      return new Response(JSON.stringify({ error: "Processing fee is not configured (Pricing page)" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const PROCESSING_FEE_RATE = FEE_PCT / 100;
    const FEE_LABEL = `Processing Fee (${FEE_PCT}%)`;

    // The balance charged must match the price the booking was confirmed at.
    const snapshot = await loadLatestSnapshot(supabase, booking.id);
    if (snapshot && toCents(snapshot.balance_amount) !== toCents(booking.balance_amount)) {
      console.error(`[balance-link] balance ${booking.balance_amount} differs from snapshot ${snapshot.balance_amount} (${booking.id})`);
      await logBookingEvent(supabase, booking.id, "balance_amount_mismatch", {
        stored_balance: booking.balance_amount,
        snapshot_balance: snapshot.balance_amount,
        snapshot_id: snapshot.id,
      });
      await sendBillingAlert(`Balance link blocked on ${booking.reservation_number || booking.id}`, [
        ["Booking", `${booking.reservation_number || ""} (${booking.id})`],
        ["Stored balance", `$${booking.balance_amount}`],
        ["Confirmed balance (snapshot)", `$${snapshot.balance_amount}`],
        ["Action", "The booking's balance was changed after it was confirmed. Review before sending a payment link."],
      ]);
      return new Response(JSON.stringify({ error: "Balance does not match the confirmed price; review required" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const balanceAmountCents = toCents(booking.balance_amount);
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
      const customerParams = {
        email: booking.email,
        name: booking.full_name,
        phone: booking.phone,
        metadata: {
          booking_id: booking.id,
          reservation_number: booking.reservation_number || "",
        },
      };
      // Without a key, call exactly as before (no options argument).
      const customer = idempotencyKey
        ? await stripe.customers.create(customerParams, { idempotencyKey: `${idempotencyKey}:customer` })
        : await stripe.customers.create(customerParams);
      customerId = customer.id;
      console.log("Created new Stripe customer:", customerId);
    }

    // Balance sessions of this booking that Stripe already knows about.
    const isThisBalance = (sess: Stripe.Checkout.Session) =>
      sess.metadata?.booking_id === booking.id && sess.metadata?.payment_type === "balance";
    const listSessions = async (status: "open" | "complete") => {
      try {
        const res = await stripe.checkout.sessions.list({ customer: customerId, status, limit: 100 });
        return res.data.filter(isThisBalance);
      } catch (e) {
        console.error(`[balance-link] could not list ${status} sessions:`, e);
        return [] as Stripe.Checkout.Session[];
      }
    };

    const paidAlready = await listSessions("complete");
    if (paidAlready.some((sess: Stripe.Checkout.Session) => sess.payment_status === "paid")) {
      console.warn(`[balance-link] a balance session for ${booking.id} is already paid; webhook pending`);
      return new Response(JSON.stringify({ error: "Balance payment already received; processing" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const connectedAccountId = Deno.env.get("STRIPE_CONNECTED_ACCOUNT_ID");

    // Get the origin for redirect URLs
    const origin = getFrontendUrl();

    // Create Checkout Session for balance payment
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `Balance Payment - ${booking.reservation_number || "Event Booking"}`,
              description: `Remaining balance for ${eventTypeLabel(booking.event_type, booking.event_type_other)} on ${booking.event_date}`,
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
    };
    const session = idempotencyKey
      ? await stripe.checkout.sessions.create(sessionParams, { idempotencyKey: `${idempotencyKey}:session` })
      : await stripe.checkout.sessions.create(sessionParams);

    console.log("Created Stripe Checkout Session:", session.id);

    // Only one payable balance link may exist: expire the previous ones.
    const openSessions = await listSessions("open");
    // Only sessions OLDER than this one, so concurrent calls converge on the newest.
    const staleIds = new Set(
      openSessions
        .filter((sess: Stripe.Checkout.Session) => sess.created <= session.created)
        .map((sess: Stripe.Checkout.Session) => sess.id),
    );
    if (booking.balance_session_id) staleIds.add(booking.balance_session_id);
    staleIds.delete(session.id);
    for (const staleId of staleIds) {
      try {
        const stale = await stripe.checkout.sessions.retrieve(staleId);
        if (stale.status === "open") {
          await stripe.checkout.sessions.expire(staleId);
          console.log("Expired previous balance session:", staleId);
        }
      } catch (e) {
        console.error("[balance-link] could not expire previous session:", staleId, e);
      }
    }
    console.log("Payment URL:", session.url);

    const expiresAt = new Date(session.expires_at! * 1000).toISOString();

    // Update booking with balance payment link data + persist exact fee amounts
    const { data: claimedRows, error: updateError } = await supabase
      .from("bookings")
      .update({
        balance_payment_url: session.url,
        balance_link_expires_at: expiresAt,
        balance_session_id: session.id,
        updated_at: new Date().toISOString(),
        balance_fee: feeCents / 100,
        balance_total_charged: totalChargeCents / 100,
      })
      .eq("id", booking.id)
      .eq("payment_status", "deposit_paid")
      .neq("status", "cancelled")
      .select("id");

    // Not saved (error) or no longer collectible (paid/cancelled meanwhile):
    // never leave an unrecorded payable link behind.
    if (updateError || !claimedRows || claimedRows.length === 0) {
      try {
        await stripe.checkout.sessions.expire(session.id);
      } catch (e) {
        console.error("[balance-link] could not expire unsaved session:", session.id, e);
      }
    }
    if (!updateError && (!claimedRows || claimedRows.length === 0)) {
      console.warn(`[balance-link] booking ${booking.id} no longer collectible; session expired`);
      return new Response(JSON.stringify({ error: "Booking is no longer awaiting a balance payment" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (updateError) {
      console.error("Error updating booking with balance link:", updateError);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to save payment link to database" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log the event
    const { error: linkEventError } = await supabase.from("booking_events").insert({
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

    // Sync first: the GHL workflow sends P01 only if this handoff really lands.
    // sync-to-ghl answers 200 {ok:false} on GHL errors and {ok:true, skipped:true}
    // for internal_admin bookings, so res.ok alone is not proof.
    let ghlHandoff = false;
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
      const syncBody = await syncResponse.json().catch(() => null);
      ghlHandoff = syncResponse.ok && syncBody?.ok === true && syncBody?.skipped !== true;
      if (ghlHandoff) {
        console.log("Successfully synced booking to GHL after balance link creation");
      } else {
        console.error("syncToGHL did not hand off:", syncResponse.status, syncBody);
      }
    } catch (syncError) {
      console.error("Error calling syncToGHL:", syncError);
    }

    // P01 has one sender: the GHL "Balance Payment Email (On URL Ready)" workflow,
    // which fires on every new balance_payment_url (synced below) and emails the
    // 1st, 2nd and 3rd link. A direct email here only covers what GHL will not send:
    // an admin resend after those 3 attempts. Before this, an admin resend went out
    // twice (SMTP here + GHL), e.g. OEV-E6CHMR on 2026-11-18.
    let directEmail = false;
    let directSent = false;
    if (sendEmail && session.url) {
      // Counts the link event logged just above, so > 3 means GHL already used its 3 sends.
      const { count: linkCount, error: countError } = await supabase
        .from("booking_events")
        .select("id", { count: "exact", head: true })
        .eq("booking_id", booking.id)
        .eq("event_type", "balance_payment_link_created");
      // If we cannot tell, send: a duplicate beats a guest who never gets the link.
      directEmail = !ghlHandoff || linkEventError != null || countError != null || (linkCount ?? 0) > 3;
      if (countError) console.error("Could not count balance links, sending P01 directly:", countError);
    }

    if (directEmail && session.url) {
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
          const balanceTotalFormatted = fmtCurrency((balanceAmountCents + feeCents) / 100);
          const paymentUrl = session.url;
          // CM2-04: the real due date; "due now" when it is today or already past
          // (short-notice bookings), never a date that has already gone by.
          const due = balanceDue(booking.event_date, orlandoToday());

          // Copy is verbatim from the 2026-11-09 communication chain rewrite
          // (ClickUp 86e3zwmg5, P01), same as the GHL template. Do not reword.
          const finalLabel = splitLabel("balance", booking).toLowerCase();
          const dueText = due.dueNow ? "Now" : formatLongDate(due.dueDate);
          const expiresText = new Date(expiresAt).toLocaleString("en-US", {
            timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit",
          });
          const emailBody =
            heroModule({
              display: displayTitle("Your Remaining Payment Is Due", { size: 34 }),
            }) +
            gap() +
            textModule(
              `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${escapeHtml(firstName)}</strong>,</p>` +
              para(`Your ${finalLabel} is due.`) +
              detailTable([
                ["Amount", balanceTotalFormatted],
                ["Due", dueText],
                ["Link expires", expiresText],
              ]) +
              primaryButton("Complete Final Payment", paymentUrl) +
              `<p style="margin:14px 0 0;font-size:12px;color:${BRAND.muted};text-align:center;line-height:1.5;">If the button doesn't work, copy and paste this link:<br><a href="${paymentUrl}" style="color:${BRAND.accent};word-break:break-all;">${paymentUrl}</a></p>` +
              para(`If you've already paid, you're all set. Having trouble with the link? Reply here or call 407 974 5979.`) +
              signature(),
            ) +
            gap() +
            referenceModule([
              ["Reservation Number", escapeHtml(booking.reservation_number || "")],
              ["Event Date", eventDate],
              ["Event Time", timeRange],
              ["Event Type", escapeHtml(eventTypeLabel(booking.event_type, booking.event_type_other))],
              ["Booking Type", escapeHtml(bookingTypeLabel(booking.booking_type, booking.start_time, booking.end_time))],
              ["Guest Count", escapeHtml(String(booking.number_of_guests ?? ""))],
            ]);

          const emailHTML = sanitizeForSmtp(emailShell({
            title: "Your Remaining Payment Is Due",
            preview: `${balanceTotalFormatted}, due ${dueText}.`,
            body: emailBody,
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
            subject: `Your Remaining Payment Is Due`,
            content: `Your ${splitLabel("balance", booking).toLowerCase()} is due. Amount: ${balanceTotalFormatted}. Due: ${due.dueNow ? "Now" : formatLongDate(due.dueDate)}. Pay here: ${paymentUrl}`,
            html: emailHTML,
          });

          await smtpClient.close();
          directSent = true;
          console.log("Balance payment email sent to:", booking.email);
        } catch (emailError) {
          console.error("Error sending balance payment email:", emailError);
        }
      } else {
        console.warn("Gmail credentials not configured, skipping balance payment email");
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        payment_url: session.url,
        session_id: session.id,
        amount: booking.balance_amount,
        // "ghl" = the GHL balance workflow emails the link; "direct" = sent from here;
        // "failed" = nobody sent it (admin must resend or share the link by hand).
        email_sent_by: sendEmail ? (directEmail ? (directSent ? "direct" : "failed") : "ghl") : null,
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
}));
