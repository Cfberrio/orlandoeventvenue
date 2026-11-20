import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { authorizeCaller, logBookingEvent } from "../_shared/billing-server.ts";
import { withBuild } from "../_shared/build-info.ts";
import { eventTypeLabel } from "../_shared/event-types.ts";
import {
  type AddonExpiryResult,
  type AddonSessionRow,
  expireAddonSessionsWith,
} from "../_shared/addon-session-expiry.ts";
import {
  BRAND,
  CONTACT,
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

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CancelBookingRequest {
  booking_id: string;
}

interface BookingData {
  id: string;
  reservation_number: string;
  full_name: string;
  email: string;
  event_date: string;
  event_type: string;
  event_type_other?: string | null;
  status: string;
  lifecycle_status: string;
  cancelled_at?: string | null;
}

function generateCancellationEmailHTML(booking: BookingData): string {
  const firstName = booking.full_name?.split(' ')[0] || 'there';
  const eventDate = new Date(booking.event_date).toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const body =
    heroModule({
      display: displayTitle("Booking Cancelled", { color: BRAND.danger, size: 38 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hello <strong>${escapeHtml(firstName)}</strong>,</p>` +
      para(`Your booking at Orlando Event Venue has been cancelled.`) +
      `<p style="margin:20px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:12px;font-weight:bold;color:${BRAND.muted};text-transform:uppercase;letter-spacing:1px;">Cancelled Booking Details</p>` +
      detailTable([
        ["Reservation", escapeHtml(booking.reservation_number)],
        ["Event Date", eventDate],
        ["Event Type", escapeHtml(eventTypeLabel(booking.event_type, booking.event_type_other))],
      ]) +
      para(`If you have any questions or would like to rebook, please contact us:`) +
      para(
        `<strong>Email:</strong> <a href="mailto:${CONTACT.email}" style="color:${BRAND.accent};text-decoration:none;">${CONTACT.email}</a><br>` +
        `<strong>Phone:</strong> <a href="tel:+14079745979" style="color:${BRAND.accent};text-decoration:none;">${CONTACT.phone}</a>`,
      ) +
      para(`We are sorry to see your booking cancelled. We hope to serve you in the future.`) +
      para(`<strong>Orlando Event Venue Team</strong>`),
    );

  return emailShell({
    title: "Booking Cancelled",
    preview: `Your booking at Orlando Event Venue has been cancelled.`,
    body,
    accent: BRAND.danger,
  });
}

// deno-lint-ignore no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function expireAddonSessions(supabase: any, bookingId: string): Promise<AddonExpiryResult> {
  const { data: rows, error } = await supabase
    .from("booking_addon_invoices")
    .select("id, stripe_session_id")
    .eq("booking_id", bookingId)
    .is("paid_at", null)
    .not("stripe_session_id", "is", null);
  if (error) {
    console.error("Could not list add-on invoices to expire:", error);
    return { checked: 0, expired: [], already_closed: [], failed: [{ invoice_id: "*", session_id: "*", error: error.message }] };
  }
  const stripeKey = Deno.env.get("Stripe_Secret_Key");
  const stripe = stripeKey ? new Stripe(stripeKey, { apiVersion: "2023-10-16" }) : null;
  const result = await expireAddonSessionsWith(
    (rows ?? []) as AddonSessionRow[],
    stripe
      ? {
          retrieve: (id) => stripe.checkout.sessions.retrieve(id),
          expire: (id) => stripe.checkout.sessions.expire(id),
        }
      : null,
  );
  if (result.failed.length > 0) console.error("Add-on sessions not expired:", result.failed);
  return result;
}

serve(withBuild(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== cancel-booking function ===");

    // Cancelling frees the date and stops payment collection: admin only
    // (or another edge function / GHL backend with its token).
    const authClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const caller = await authorizeCaller(req, authClient, ["admin", "service", "ghl"]);
    if (!caller) {
      return new Response(
        JSON.stringify({ ok: false, error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { booking_id }: CancelBookingRequest = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    console.log(`Cancelling booking: ${booking_id}`);

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("id, reservation_number, full_name, email, event_date, event_type, event_type_other, status, lifecycle_status, cancelled_at, payment_status, balance_session_id, balance_payment_url")
      .eq("id", booking_id)
      .single();

    if (fetchError || !booking) {
      console.error("Booking not found:", fetchError);
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (booking.status === "completed") {
      console.error("Cannot cancel completed booking");
      return new Response(
        JSON.stringify({ ok: false, error: "Cannot cancel a completed booking" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const wasAlreadyCancelled = booking.status === "cancelled";
    console.log(`Booking status: ${booking.status}, lifecycle: ${booking.lifecycle_status}, already cancelled: ${wasAlreadyCancelled}`);

    if (!wasAlreadyCancelled || !booking.cancelled_at || booking.lifecycle_status !== "cancelled") {
      const { error: updateError } = await supabase
        .from("bookings")
        .update({
          status: "cancelled",
          lifecycle_status: "cancelled",
          cancelled_at: booking.cancelled_at ?? new Date().toISOString(),
        })
        .eq("id", booking_id);

      if (updateError) {
        console.error("Error updating booking:", updateError);
        return new Response(
          JSON.stringify({ ok: false, error: "Failed to update booking status" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(wasAlreadyCancelled ? "Booking cancellation state normalized" : "Booking status updated to 'cancelled'");
    }

    // Stripe cleanup that did not go through. A session left open stays
    // payable for at most its 24h life; a payment that lands anyway is still
    // recorded and reopens the refund review (DB trigger). The office sees
    // the warning so it can expire the session in Stripe.
    const cleanupWarnings: string[] = [];

    // A cancelled event must not stay payable: void the balance link.
    if (booking.balance_payment_url || booking.balance_session_id) {
      const expired: string[] = [];
      const stripeKey = Deno.env.get("Stripe_Secret_Key");
      if (stripeKey) {
        const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });
        const candidates = new Set<string>();
        if (booking.balance_session_id) candidates.add(booking.balance_session_id);
        try {
          const customers = await stripe.customers.list({ email: booking.email, limit: 5 });
          for (const c of customers.data) {
            const open = await stripe.checkout.sessions.list({ customer: c.id, status: "open", limit: 100 });
            for (const sess of open.data) {
              if (sess.metadata?.booking_id === booking_id && sess.metadata?.payment_type === "balance") candidates.add(sess.id);
            }
          }
        } catch (e) {
          console.error("Could not list open balance sessions:", e);
          cleanupWarnings.push("could not list open balance sessions in Stripe");
        }
        for (const id of candidates) {
          try {
            const sess = await stripe.checkout.sessions.retrieve(id);
            if (sess.status === "open") {
              await stripe.checkout.sessions.expire(id);
              expired.push(id);
            }
          } catch (e) {
            console.error("Could not expire balance session", id, e);
            cleanupWarnings.push(`balance session ${id} not expired`);
          }
        }
      } else {
        cleanupWarnings.push("Stripe key missing: balance link not expired");
      }
      const { error: clearError } = await supabase
        .from("bookings")
        .update({ balance_payment_url: null, balance_link_expires_at: null })
        .eq("id", booking_id);
      if (clearError) console.error("Error clearing balance link:", clearError);
      await logBookingEvent(supabase, booking_id, "balance_link_voided_on_cancel", {
        expired_sessions: expired,
        cleared_url: !clearError,
      });
    }

    // M-9: unpaid add-on invoices must not stay payable. The DB cancel
    // trigger already marked them expired; here the Stripe sessions are
    // closed. A payment that slips in first is still recorded by the webhook
    // and shows up in the refund review.
    const addonExpiry = await expireAddonSessions(supabase, booking_id);
    if (addonExpiry.checked > 0) {
      await logBookingEvent(supabase, booking_id, "addon_invoice_voided_on_cancel", { ...addonExpiry });
    }
    for (const f of addonExpiry.failed) cleanupWarnings.push(`add-on session ${f.session_id} not expired`);
    if (cleanupWarnings.length > 0) {
      await logBookingEvent(supabase, booking_id, "cancel_cleanup_failed", { warnings: cleanupWarnings });
    }

    // What was collected decides whether the office must record a refund.
    const { data: collected, error: collectedError } = await supabase.rpc("admin_booking_collected", {
      p_booking_id: booking_id,
    });
    if (collectedError) console.error("Could not read collected amount:", collectedError);
    const collectedTotal = Number((collected as { total?: number } | null)?.total ?? 0);

    const { data: deletedJobs, error: deleteJobsError } = await supabase
      .from("scheduled_jobs")
      .delete()
      .eq("booking_id", booking_id)
      .in("status", ["pending", "failed"])
      .select("id");

    if (deleteJobsError) {
      console.error("Error deleting jobs:", deleteJobsError);
    } else {
      console.log(`Deleted ${deletedJobs?.length || 0} pending/failed jobs`);
    }

    const { data: deletedBlocks, error: deleteBlocksError } = await supabase
      .from("availability_blocks")
      .delete()
      .eq("booking_id", booking_id)
      .select("id");

    if (deleteBlocksError) {
      console.error("Error deleting availability blocks:", deleteBlocksError);
    } else {
      console.log(`Deleted ${deletedBlocks?.length || 0} linked availability blocks`);
    }

    if (wasAlreadyCancelled) {
      return new Response(
        JSON.stringify({
          ok: true,
          message: "Booking already cancelled. Cleanup completed",
          booking_id: booking_id,
          reservation_number: booking.reservation_number,
          jobs_deleted: deletedJobs?.length || 0,
          blocks_deleted: deletedBlocks?.length || 0,
          addon_sessions_expired: addonExpiry.expired.length,
          collected_total: collectedTotal,
          cleanup_warnings: cleanupWarnings,
          already_cancelled: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: eventError } = await supabase
      .from("booking_events")
      .insert({
        booking_id: booking_id,
        event_type: "booking_cancelled",
        channel: "admin",
        metadata: {
          cancelled_at: new Date().toISOString(),
          jobs_deleted: deletedJobs?.length || 0,
          blocks_deleted: deletedBlocks?.length || 0,
          previous_status: booking.status,
          previous_lifecycle: booking.lifecycle_status,
        },
      });

    if (eventError) {
      console.error("Error logging event:", eventError);
    } else {
      console.log("Cancellation event logged");
    }

    try {
      const gmailUser = Deno.env.get("GMAIL_USER");
      const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");

      if (gmailUser && gmailPassword && booking.email) {
        console.log(`Sending cancellation email to: ${booking.email}`);

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

        const emailHTML = sanitizeForSmtp(generateCancellationEmailHTML(booking as BookingData));

        await client.send({
          from: gmailUser,
          to: booking.email,
          subject: `Booking Cancelled - ${booking.reservation_number} | Orlando Event Venue`,
          content: "Your booking has been cancelled.",
          html: emailHTML,
        });

        await client.close();
        console.log("Cancellation email sent successfully");
      } else {
        console.warn("Email not sent: Missing credentials or email address");
      }
    } catch (emailError) {
      console.error("Error sending email:", emailError);
    }

    try {
      console.log("Syncing cancellation with GHL...");
      const { error: syncError } = await supabase.functions.invoke("sync-to-ghl", {
        body: { booking_id: booking_id },
      });

      if (syncError) {
        console.error("GHL sync error:", syncError);
      } else {
        console.log("GHL sync successful");
      }
    } catch (syncError) {
      console.error("Error syncing with GHL:", syncError);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        message: "Booking cancelled successfully",
        booking_id: booking_id,
        reservation_number: booking.reservation_number,
        jobs_deleted: deletedJobs?.length || 0,
        blocks_deleted: deletedBlocks?.length || 0,
        addon_sessions_expired: addonExpiry.expired.length,
        collected_total: collectedTotal,
        cleanup_warnings: cleanupWarnings,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    console.error("Error in cancel-booking:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";

    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
}));