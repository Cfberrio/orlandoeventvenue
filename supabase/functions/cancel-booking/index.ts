import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";
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
        ["Event Type", escapeHtml(booking.event_type)],
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== cancel-booking function ===");

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
      .select("id, reservation_number, full_name, email, event_date, event_type, status, lifecycle_status, cancelled_at")
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
});