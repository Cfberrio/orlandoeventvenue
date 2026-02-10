import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SMTPClient } from "https://deno.land/x/denomailer@1.6.0/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALERT_EMAIL = "orlandoglobalministries@gmail.com";

/**
 * Send instant critical failure alert email for GHL sync failures
 */
async function sendCriticalAlert(functionName: string, reservationNumber: string, errorMsg: string, bookingId?: string): Promise<void> {
  try {
    const gmailUser = Deno.env.get("GMAIL_USER");
    const gmailPassword = Deno.env.get("GMAIL_APP_PASSWORD");
    if (!gmailUser || !gmailPassword) return;

    const client = new SMTPClient({
      connection: { hostname: "smtp.gmail.com", port: 465, tls: true, auth: { username: gmailUser, password: gmailPassword } },
    });

    const timestamp = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
    const html = `<html><body style="font-family:Arial;padding:20px;"><h2 style="color:#dc2626;">CRITICAL FAILURE: ${functionName}</h2><p><b>Reservation:</b> ${reservationNumber}</p><p><b>Error:</b> ${errorMsg}</p><p><b>Time:</b> ${timestamp} EST</p>${bookingId ? `<p><b>Booking ID:</b> ${bookingId}</p>` : ""}<p style="margin-top:20px;color:#666;">GHL sync failure may prevent customer from entering workflow. Immediate action required.</p></body></html>`;

    await client.send({
      from: `"OEV Alert" <${gmailUser}>`,
      to: ALERT_EMAIL,
      subject: `🚨 CRITICAL: ${functionName} Failed for ${reservationNumber}`,
      html,
    });
    await client.close();
    console.log(`[ALERT] Critical GHL failure alert sent for ${reservationNumber}`);
  } catch (alertErr) {
    console.error("[ALERT] Failed to send critical alert:", alertErr);
  }
}

/**
 * Log critical error to booking_events table
 */
async function logCriticalError(supabase: any, bookingId: string, functionName: string, errorMessage: string): Promise<void> {
  try {
    await supabase.from("booking_events").insert({
      booking_id: bookingId,
      event_type: `${functionName.replace(/-/g, "_")}_critical_failure`,
      channel: "system",
      metadata: {
        error_message: errorMessage,
        timestamp: new Date().toISOString(),
        requires_manual_intervention: true,
      },
    });
  } catch (logErr) {
    console.error("Failed to log critical error:", logErr);
  }
}

// Booking snapshot interface for GHL
interface BookingSnapshot {
  booking_id: string;
  reservation_number: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  booking_type: string | null;
  status: string | null;
  payment_status: string | null;
  lifecycle_status: string | null;
  number_of_guests: number | null;
  event_type: string | null;
  package: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  balance_amount: number | null;
  balance_payment_url: string | null;
  balance_link_expires_at: string | null;
  is_deposit_paid: string;
  is_fully_paid: string;
  has_staff_assigned: string;
  cleaning_report_completed: string;
  host_report_completed: string;
  host_report_step: string | null;
  review_received: string;
  pre_event_ready: string;
  short_notice_balance: string;
  customer: {
    full_name: string | null;
    email: string | null;
    phone: string | null;
  };
  // Staff info - ALWAYS custodial role (used by GHL Internal Notifications)
  // Will be null if no custodial staff assigned (NEVER fallback to production/assistant)
  staff_email: string | null;  // Email of custodial staff ONLY
  staff_name: string | null;   // Name of custodial staff ONLY
  staff_id: string | null;     // ID of custodial staff ONLY
  // Deprecated - kept for backwards compatibility (same as staff_* fields)
  custodial_email: string | null;
  custodial_name: string | null;
  custodial_staff_id: string | null;
  custodial_count: number;
}

// Booking row type from database
interface BookingRow {
  id: string;
  reservation_number: string | null;
  event_date: string | null;
  start_time: string | null;
  end_time: string | null;
  booking_type: string | null;
  status: string | null;
  payment_status: string | null;
  lifecycle_status: string | null;
  number_of_guests: number | null;
  event_type: string | null;
  package: string | null;
  total_amount: number | null;
  deposit_amount: number | null;
  balance_amount: number | null;
  balance_payment_url: string | null;
  balance_link_expires_at: string | null;
  pre_event_ready: string | null;
  host_report_step: string | null;
  full_name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * Builds a complete booking snapshot for sending to GHL.
 * Fetches booking data and related info, computes boolean flags.
 */
async function buildBookingSnapshot(
  supabaseUrl: string,
  supabaseServiceKey: string,
  bookingId: string,
  options?: { force_host_report_completed?: boolean }
): Promise<BookingSnapshot> {
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch the main booking record
  const { data: bookingData, error: bookingError } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", bookingId)
    .maybeSingle();

  if (bookingError) {
    console.error("Error fetching booking:", bookingError);
    throw new Error(`Failed to fetch booking: ${bookingError.message}`);
  }

  if (!bookingData) {
    throw new Error(`Booking not found: ${bookingId}`);
  }

  const booking = bookingData as BookingRow;

  // Fetch staff assignments with staff member details
  const { data: staffAssignments, error: staffError } = await supabase
    .from("booking_staff_assignments")
    .select(`
      staff_id,
      assignment_role,
      created_at,
      staff_members (
        id,
        full_name,
        email
      )
    `)
    .eq("booking_id", bookingId)
    .order("created_at", { ascending: true });

  if (staffError) {
    console.error("Error fetching staff assignments:", staffError);
  }

  // Get total staff count
  const staffCount = staffAssignments?.length || 0;

  // Get Custodial staff FIRST (this is what GHL workflows need for notifications)
  // CRITICAL: staff_email/name/id now ALWAYS point to custodial (never production/assistant)
  const custodialAssignments = staffAssignments?.filter(a => a.assignment_role === "Custodial") || [];
  const custodialCount = custodialAssignments.length;
  const firstCustodial = custodialAssignments[0]; // Already sorted by created_at ASC
  const custodialMember = firstCustodial?.staff_members as unknown as { id: string; full_name: string; email: string } | null;
  
  // CRITICAL: staff_email now ALWAYS points to custodial (never production/assistant)
  const staff_email = custodialMember?.email || null;
  const staff_name = custodialMember?.full_name || null;
  const staff_id = custodialMember?.id || null;

  // Log clearly with warning if no custodial
  if (custodialCount === 0 && staffCount > 0) {
    console.warn(`⚠️ Booking ${bookingId} has ${staffCount} staff but NO CUSTODIAL - staff_email will be null`);
  }
  console.log(`Staff info (CUSTODIAL ONLY) for booking ${bookingId}: email=${staff_email}, name=${staff_name}, custodial_count=${custodialCount}, total_staff=${staffCount}`);

  // Safety check: verify staff_email is actually custodial (should ALWAYS be true with new logic)
  if (staff_email) {
    const actualStaffRole = staffAssignments?.find(a => 
      (a.staff_members as any)?.email === staff_email
    )?.assignment_role;
    
    if (actualStaffRole && actualStaffRole !== "Custodial") {
      console.error(`🚨 CRITICAL: staff_email is set to non-custodial role: ${actualStaffRole}`);
      console.error(`This should NEVER happen - check the filtering logic!`);
      console.error(`Booking: ${bookingId}, Email: ${staff_email}`);
    }
  }

  // Check for completed cleaning reports
  const { data: cleaningReports, error: cleaningError } = await supabase
    .from("booking_cleaning_reports")
    .select("status")
    .eq("booking_id", bookingId)
    .eq("status", "completed");

  if (cleaningError) {
    console.error("Error fetching cleaning reports:", cleaningError);
  }

  // Check for submitted host reports
  const { data: hostReports, error: hostError } = await supabase
    .from("booking_host_reports")
    .select("id")
    .eq("booking_id", bookingId);

  if (hostError) {
    console.error("Error fetching host reports:", hostError);
  }

  // Check for reviews
  const { data: reviews, error: reviewError } = await supabase
    .from("booking_reviews")
    .select("id")
    .eq("booking_id", bookingId);

  if (reviewError) {
    console.error("Error fetching reviews:", reviewError);
  }

  // Compute string flags (GHL requires text values)
  const has_staff_assigned = (staffCount || 0) >= 1 ? "true" : "false";
  const is_deposit_paid = (booking.payment_status === "deposit_paid" || booking.payment_status === "fully_paid") ? "true" : "false";
  const is_fully_paid = booking.payment_status === "fully_paid" ? "true" : "false";
  const cleaning_report_completed = (cleaningReports?.length || 0) > 0 ? "true" : "false";
  const host_report_completed = options?.force_host_report_completed === true
    ? "true"
    : (hostReports?.length || 0) > 0 ? "true" : "false";
  const review_received = (reviews?.length || 0) > 0 ? "true" : "false";
  const pre_event_ready = booking.pre_event_ready || 'false';

  // Calculate short_notice_balance: "true" if event is 15 days or less away
  let short_notice_balance = "false";
  try {
    if (booking.event_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Normalize to start of day
      const eventDate = new Date(booking.event_date);
      eventDate.setHours(0, 0, 0, 0);
      
      const diffMs = eventDate.getTime() - today.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      
      // "true" if 15 days or less (includes past dates)
      short_notice_balance = diffDays <= 15 ? "true" : "false";
      console.log(`short_notice_balance for booking ${booking.id}: ${short_notice_balance} (${diffDays} days until event)`);
    }
  } catch (err) {
    console.error("Error calculating short_notice_balance:", err);
    short_notice_balance = "false";
  }

  // Build and return the snapshot
  return {
    booking_id: booking.id,
    reservation_number: booking.reservation_number,
    event_date: booking.event_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booking_type: booking.booking_type,
    status: booking.status,
    payment_status: booking.payment_status,
    lifecycle_status: booking.lifecycle_status,
    number_of_guests: booking.number_of_guests,
    event_type: booking.event_type,
    package: booking.package,
    total_amount: booking.total_amount ? Number(booking.total_amount) : null,
    deposit_amount: booking.deposit_amount ? Number(booking.deposit_amount) : null,
    balance_amount: booking.balance_amount ? Number(booking.balance_amount) : null,
    balance_payment_url: booking.balance_payment_url,
    balance_link_expires_at: booking.balance_link_expires_at,
    is_deposit_paid,
    is_fully_paid,
    has_staff_assigned,
    cleaning_report_completed,
    host_report_completed,
    host_report_step: booking.host_report_step,
    review_received,
    pre_event_ready,
    short_notice_balance,
    customer: {
      full_name: booking.full_name,
      email: booking.email,
      phone: booking.phone,
    },
    // Staff info (ALWAYS custodial role - used by GHL notifications)
    staff_email,      // null if no custodial assigned
    staff_name,       // null if no custodial assigned
    staff_id,         // null if no custodial assigned
    // Deprecated fields (kept for backwards compatibility, same values as staff_*)
    custodial_email: staff_email,
    custodial_name: staff_name,
    custodial_staff_id: staff_id,
    custodial_count: custodialCount,
  };
}

/**
 * Edge function that sends a booking snapshot to GHL.
 * Called internally after important booking events.
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id, force_host_report_completed } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get GHL webhook URL from environment
    const ghlWebhookUrl = Deno.env.get("GHL_BOOKING_WEBHOOK_URL");
    if (!ghlWebhookUrl) {
      console.error("GHL_BOOKING_WEBHOOK_URL not configured");
      return new Response(
        JSON.stringify({ ok: false, error: "GHL webhook URL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get Supabase credentials
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // First check if this is an internal booking - skip GHL sync for those
    const supabaseCheck = createClient(supabaseUrl, supabaseServiceKey);
    const { data: bookingCheck, error: checkError } = await supabaseCheck
      .from("bookings")
      .select("lead_source")
      .eq("id", booking_id)
      .maybeSingle();

    if (checkError) {
      console.error("Error checking booking:", checkError);
      throw new Error(`Failed to check booking: ${checkError.message}`);
    }

    // Skip GHL webhook sync for internal admin bookings (but still sync calendar!)
    if (bookingCheck?.lead_source === "internal_admin") {
      console.log("Skipping GHL webhook sync for internal_admin booking:", booking_id);
      
      // Still sync to calendar for internal bookings
      try {
        console.log("Triggering GHL calendar sync for internal booking:", booking_id);
        const calendarResp = await fetch(`${supabaseUrl}/functions/v1/sync-ghl-calendar`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({ booking_id }),
        });
        const calendarResult = await calendarResp.json();
        console.log("GHL calendar sync result for internal:", calendarResult);
      } catch (calendarErr) {
        console.error("Error syncing calendar for internal booking:", calendarErr);
      }
      
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "internal_admin booking", calendar_synced: true }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Build the booking snapshot
    console.log("Building snapshot for booking:", booking_id);
    const snapshot = await buildBookingSnapshot(supabaseUrl, supabaseServiceKey, booking_id, { force_host_report_completed });

    // Send to GHL
    console.log("Sending snapshot to GHL:", ghlWebhookUrl);
    const ghlResponse = await fetch(ghlWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      console.error("GHL returned non-2xx:", ghlResponse.status, errorText);
      // Log but don't crash - GHL might be temporarily unavailable
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "GHL returned error",
          ghl_status: ghlResponse.status 
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Successfully sent snapshot to GHL for booking:", booking_id);

    // Also sync to GHL Calendar (fire-and-forget, don't block main sync)
    try {
      console.log("Triggering GHL calendar sync for booking:", booking_id);
      fetch(`${supabaseUrl}/functions/v1/sync-ghl-calendar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ booking_id }),
      }).then(async (resp) => {
        if (resp.ok) {
          const result = await resp.json();
          console.log("GHL calendar sync result:", result);
        } else {
          console.error("GHL calendar sync failed:", resp.status);
        }
      }).catch((err) => {
        console.error("GHL calendar sync error:", err);
      });
    } catch (calendarErr) {
      console.error("Error triggering calendar sync:", calendarErr);
    }

    return new Response(
      JSON.stringify({ ok: true, booking_id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("Error in syncToGHL:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    
    // Try to get booking info and send alert for GHL sync failures
    try {
      const body = await req.clone().json().catch(() => ({}));
      if (body.booking_id) {
        const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
        const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        const { data: booking } = await supabase
          .from("bookings")
          .select("reservation_number")
          .eq("id", body.booking_id)
          .single();
        
        if (booking) {
          await sendCriticalAlert("sync-to-ghl", booking.reservation_number || body.booking_id, errorMessage, body.booking_id);
          await logCriticalError(supabase, body.booking_id, "sync-to-ghl", errorMessage);
        }
      }
    } catch (alertErr) {
      console.error("Error sending GHL failure alert:", alertErr);
    }
    
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
