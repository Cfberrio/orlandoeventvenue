import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

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
}

function generateCancellationEmailHTML(booking: BookingData): string {
  const firstName = booking.full_name?.split(' ')[0] || 'there';
  const eventDate = new Date(booking.event_date).toLocaleDateString('en-US', { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:20px auto;background:white;padding:0;">

<div style="background:#dc2626;padding:30px;text-align:center;color:white;">
<h1 style="margin:0;font-size:24px;">Booking Cancelled</h1>
<p style="margin:10px 0 0;">Reservation ${booking.reservation_number}</p>
</div>

<div style="padding:30px;">

<p style="margin:0;">Hello <strong>${firstName}</strong>,</p>

<p style="margin:15px 0;">
Your booking at Orlando Event Venue has been cancelled.
</p>

<div style="background:#f9fafb;border:1px solid #ddd;padding:20px;margin:20px 0;">
<p style="margin:0 0 10px;font-weight:bold;color:#666;">CANCELLED BOOKING DETAILS</p>
<p style="margin:5px 0;"><strong>Reservation:</strong> ${booking.reservation_number}</p>
<p style="margin:5px 0;"><strong>Event Date:</strong> ${eventDate}</p>
<p style="margin:5px 0;"><strong>Event Type:</strong> ${booking.event_type}</p>
</div>

<p style="margin:20px 0 10px;">
If you have any questions or would like to rebook, please contact us:
</p>

<div style="background:#eff6ff;border:1px solid #bfdbfe;padding:15px;margin:0 0 20px;">
<p style="margin:5px 0;color:#1e40af;"><strong>Email:</strong> orlandoglobalministries@gmail.com</p>
<p style="margin:5px 0;color:#1e40af;"><strong>Phone:</strong> (407) 555-0123</p>
</div>

<p style="margin:20px 0 10px;">
We are sorry to see your booking cancelled. We hope to serve you in the future.
</p>

<p style="margin:10px 0 0;">
<strong>Orlando Event Venue Team</strong>
</p>

</div>

<div style="padding:20px 30px;background:#f9fafb;font-size:11px;color:#999;text-align:center;border-top:1px solid #ddd;">
<p style="margin:0;">Orlando Event Venue - 3847 E Colonial Dr, Orlando, FL 32803</p>
<p style="margin:5px 0 0;">This is an automated notification.</p>
</div>

</div>
</body>
</html>`;
}

serve(async (req) => {
  // Handle CORS preflight
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

    // 1. Fetch booking data and validate status
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("id, reservation_number, full_name, email, event_date, event_type, status, lifecycle_status")
      .eq("id", booking_id)
      .single();

    if (fetchError || !booking) {
      console.error("Booking not found:", fetchError);
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate that booking is not completed
    if (booking.status === 'completed') {
      console.error("Cannot cancel completed booking");
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "Cannot cancel a completed booking" 
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if already cancelled
    if (booking.status === 'cancelled') {
      console.log("Booking is already cancelled");
      return new Response(
        JSON.stringify({ 
          ok: true, 
          message: "Booking is already cancelled",
          booking_id: booking_id
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Booking status: ${booking.status}, lifecycle: ${booking.lifecycle_status}`);

    // 2. Update booking status to 'cancelled'
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ 
        status: 'cancelled',
        lifecycle_status: 'cancelled'
      })
      .eq("id", booking_id);

    if (updateError) {
      console.error("Error updating booking:", updateError);
      return new Response(
        JSON.stringify({ ok: false, error: "Failed to update booking status" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Booking status updated to 'cancelled'");

    // 3. Delete pending and failed scheduled jobs
    const { data: deletedJobs, error: deleteError } = await supabase
      .from("scheduled_jobs")
      .delete()
      .eq("booking_id", booking_id)
      .in("status", ["pending", "failed"])
      .select();

    if (deleteError) {
      console.error("Error deleting jobs:", deleteError);
    } else {
      console.log(`Deleted ${deletedJobs?.length || 0} pending/failed jobs`);
    }

    // 4. Log event in booking_events
    const { error: eventError } = await supabase
      .from("booking_events")
      .insert({
        booking_id: booking_id,
        event_type: "booking_cancelled",
        channel: "admin",
        metadata: {
          cancelled_at: new Date().toISOString(),
          jobs_deleted: deletedJobs?.length || 0,
          previous_status: booking.status,
          previous_lifecycle: booking.lifecycle_status
        }
      });

    if (eventError) {
      console.error("Error logging event:", eventError);
    } else {
      console.log("Cancellation event logged");
    }

    // 5. Send cancellation email to guest
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

        const emailHTML = generateCancellationEmailHTML(booking as BookingData);

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
      // Don't fail the whole operation if email fails
    }

    // 6. Sync with GHL
    try {
      console.log("Syncing cancellation with GHL...");
      const { error: syncError } = await supabase.functions.invoke("sync-to-ghl", {
        body: { booking_id: booking_id }
      });

      if (syncError) {
        console.error("GHL sync error:", syncError);
      } else {
        console.log("GHL sync successful");
      }
    } catch (syncError) {
      console.error("Error syncing with GHL:", syncError);
      // Don't fail the whole operation if GHL sync fails
    }

    // Return success
    return new Response(
      JSON.stringify({
        ok: true,
        message: "Booking cancelled successfully",
        booking_id: booking_id,
        reservation_number: booking.reservation_number,
        jobs_deleted: deletedJobs?.length || 0
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
