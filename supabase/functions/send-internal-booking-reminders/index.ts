import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  BRAND,
  displayTitle,
  emailShell,
  escapeHtml,
  gap,
  heroModule,
  linkButton,
  numberedList,
  para,
  referenceModule,
  sanitizeForSmtp,
  signature,
  textModule,
} from "../_shared/email-layout.ts";

const REMINDER_SUBJECT = "Your Event Access Page";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface BlockWithBooking {
  id: string;
  booking_id: string;
  start_date: string;
  end_date: string;
  start_time: string | null;
  end_time: string | null;
  block_type: string;
  bookings: {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    event_type: string;
    booking_origin: string;
    number_of_guests: number;
    booking_policies: {
      policy_name: string;
      send_pre_event_1d: boolean;
    };
  };
}

/**
 * Gets tomorrow's date in YYYY-MM-DD format (Orlando timezone)
 */
function getTomorrowDate(): string {
  const now = new Date();
  
  // Get tomorrow's date
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  
  // Format in Orlando timezone (America/New_York)
  const orlandoDate = tomorrow.toLocaleString('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  
  // Convert MM/DD/YYYY to YYYY-MM-DD
  const [month, day, year] = orlandoDate.split('/');
  return `${year}-${month}-${day}`;
}

/**
 * Builds HTML email for internal booking reminder
 */
function buildReminderHTML(block: BlockWithBooking, date: string): string {
  const booking = block.bookings;
  const firstName = escapeHtml(booking.full_name.split(' ')[0]);

  const timeInfo = block.block_type === "hourly" && block.start_time && block.end_time
    ? `${formatTime(block.start_time)} - ${formatTime(block.end_time)}`
    : "All day";

  const accessCodeUrl = "https://orlandoeventvenue.org/accesscode";
  const rawReservationNumber = (booking as { reservation_number?: string }).reservation_number;
  const reservationNumber = rawReservationNumber ? escapeHtml(rawReservationNumber) : undefined;

  const referenceRows: Array<[string, string]> = [];
  if (reservationNumber) referenceRows.push(["Reservation Number", reservationNumber]);
  referenceRows.push(
    ["Event Date", formatDate(date)],
    ["Event Time", timeInfo],
    ["Event Type", escapeHtml(formatEventType(booking.event_type))],
    ["Guest Count", String(booking.number_of_guests)],
  );

  // Copy is verbatim from the ClickUp spec "OEV POST BOOKING COMMUNICATIONS",
  // section S04. Access instructions live only on the Event Page — never here.
  const body =
    heroModule({
      display: displayTitle(REMINDER_SUBJECT, { size: 38 }),
    }) +
    gap() +
    textModule(
      `<p style="margin:0;font-size:16px;font-family:Arial,Helvetica,sans-serif;color:${BRAND.text};">Hi <strong>${firstName}</strong>,</p>` +
      para(`Your event is tomorrow.`) +
      para(`Your door code and complete instructions for entering the venue are available only on your Event Page:`) +
      linkButton(accessCodeUrl) +
      para(`Enter your reservation number when prompted.`) +
      para(`Your Event Page includes:`) +
      numberedList([
        `Your live door code when it becomes available.`,
        `Complete instructions for entering the venue.`,
        `Wifi information.`,
        `The venue rules.`,
        `Your Before You Leave checklist.`,
        `Your Guest Report.`,
      ]) +
      para(`Your live door code will appear on the page one hour before your event begins.`) +
      para(`Please make sure whoever arrives first has the Event Page link and your reservation number.`) +
      para(`Need help? Call or text 407 974 5979.`) +
      signature(),
    ) +
    gap() +
    referenceModule(referenceRows);

  return sanitizeForSmtp(emailShell({
    title: REMINDER_SUBJECT,
    preview: "Your door code and complete entry instructions will be available on your Event Page.",
    body,
  }));
}

function formatEventType(eventType: string): string {
  return eventType
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Format time from HH:MM:SS to HH:MM AM/PM
 */
function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':');
  const hour = parseInt(hours);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
  return `${displayHour}:${minutes} ${ampm}`;
}

/**
 * Format date from YYYY-MM-DD to readable format
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

/**
 * Send reminder via GHL API
 * Creates a note/task or sends SMS/email through GHL
 */
async function sendViaGHL(block: BlockWithBooking, message: string): Promise<void> {
  const ghlApiKey = Deno.env.get("GHL_API_KEY");
  const ghlLocationId = Deno.env.get("GHL_LOCATION_ID");
  
  if (!ghlApiKey || !ghlLocationId) {
    console.log("[WARN] GHL credentials not configured, skipping GHL notification");
    return;
  }

  const booking = block.bookings;
  
  // Option 1: Send SMS via GHL (if phone exists)
  if (booking.phone) {
    try {
      const smsResponse = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ghlApiKey}`,
          "Content-Type": "application/json",
          "Version": "2021-07-28",
        },
        body: JSON.stringify({
          type: "SMS",
          contactId: "", // Would need to lookup contact by phone
          message: message,
          locationId: ghlLocationId,
        }),
      });

      if (!smsResponse.ok) {
        console.error("[GHL_SMS_ERROR]", await smsResponse.text());
      } else {
        console.log(`[GHL_SMS_SENT] To ${booking.phone}`);
      }
    } catch (err) {
      console.error("[GHL_SMS_ERROR]", err);
    }
  }

  // Option 2: Send email via GHL (if email exists)
  if (booking.email) {
    try {
      const emailResponse = await fetch("https://services.leadconnectorhq.com/conversations/messages", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${ghlApiKey}`,
          "Content-Type": "application/json",
          "Version": "2021-07-28",
        },
        body: JSON.stringify({
          type: "Email",
          contactId: "", // Would need to lookup contact by email
          subject: "🔔 Event Reminder: Tomorrow at Orlando Event Venue",
          message: message.replace(/\n/g, '<br>'),
          locationId: ghlLocationId,
        }),
      });

      if (!emailResponse.ok) {
        console.error("[GHL_EMAIL_ERROR]", await emailResponse.text());
      } else {
        console.log(`[GHL_EMAIL_SENT] To ${booking.email}`);
      }
    } catch (err) {
      console.error("[GHL_EMAIL_ERROR]", err);
    }
  }
}

/**
 * Send via SendGrid (HTML email)
 */
async function sendViaSendGrid(block: BlockWithBooking, htmlContent: string): Promise<void> {
  const sendGridApiKey = Deno.env.get("SENDGRID_API_KEY");
  const fromEmail = Deno.env.get("SENDGRID_FROM_EMAIL") || "noreply@orlandoeventvenue.com";
  
  if (!sendGridApiKey) {
    console.log("[WARN] SendGrid not configured, skipping email");
    return;
  }

  const booking = block.bookings;
  
  try {
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${sendGridApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{
          to: [{ email: booking.email, name: booking.full_name }],
          subject: REMINDER_SUBJECT,
        }],
        from: { email: fromEmail, name: "Orlando Event Venue" },
        content: [{
          type: "text/html",
          value: htmlContent
        }],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[SENDGRID_ERROR]", errorText);
      throw new Error(`SendGrid failed: ${errorText}`);
    }

    console.log(`[SENDGRID_SENT] Email to ${booking.email}`);
  } catch (err) {
    console.error("[SENDGRID_ERROR]", err);
    throw err;
  }
}

/**
 * Main handler
 */
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("=== send-internal-booking-reminders ===");
    console.log("Starting 1-day reminder check...");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get tomorrow's date
    const tomorrowStr = getTomorrowDate();
    console.log(`[INFO] Checking for events on: ${tomorrowStr}`);

    // Fetch all availability blocks for tomorrow from internal bookings
    const { data: blocks, error: blocksError } = await supabase
      .from("availability_blocks")
      .select(`
        id,
        booking_id,
        start_date,
        end_date,
        start_time,
        end_time,
        block_type,
        bookings!inner(
          id,
          full_name,
          email,
          phone,
          event_type,
          booking_origin,
          number_of_guests,
          reservation_number,
          booking_policies!inner(
            policy_name,
            send_pre_event_1d
          )
        )
      `)
      .eq("source", "internal_admin")
      .eq("start_date", tomorrowStr);

    if (blocksError) {
      console.error("[ERROR] Failed to fetch blocks:", blocksError);
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Failed to fetch availability blocks",
          details: blocksError 
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    const totalBlocks = blocks?.length || 0;
    console.log(`[INFO] Found ${totalBlocks} internal booking occurrence(s) for tomorrow`);

    if (totalBlocks === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          date: tomorrowStr,
          total_blocks: 0,
          sent: 0,
          skipped: 0,
          errors: 0,
          message: "No internal bookings scheduled for tomorrow"
        }),
        { 
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    let sent = 0;
    let skipped = 0;
    let errors = 0;
    const results: Array<{ block_id: string; status: string; reason?: string }> = [];

    // Process each block
    for (const rawBlock of blocks) {
      // Supabase returns arrays even with !inner, so we need to extract the first element
      const bookingData = Array.isArray(rawBlock.bookings) ? rawBlock.bookings[0] : rawBlock.bookings;
      const policyData = Array.isArray(bookingData?.booking_policies) ? bookingData.booking_policies[0] : bookingData?.booking_policies;
      
      // Transform to expected type
      const block: BlockWithBooking = {
        ...rawBlock,
        bookings: {
          ...bookingData,
          booking_policies: policyData
        }
      };
      
      const booking = block.bookings;
      const policy = booking.booking_policies;

      console.log(`\n[PROCESSING] Block ${block.id} for booking ${booking.id} (${booking.full_name})`);

      // Guard clause: Check if policy allows 1-day reminders
      if (!policy.send_pre_event_1d) {
        console.log(`[POLICY_SKIP] send_pre_event_1d is FALSE for policy: ${policy.policy_name}`);
        skipped++;
        results.push({
          block_id: block.id,
          status: "skipped",
          reason: "policy_disabled"
        });
        continue;
      }

      // Check if reminder already sent for this block
      const { data: existingReminder } = await supabase
        .from("availability_block_reminders")
        .select("id, sent_at")
        .eq("block_id", block.id)
        .eq("reminder_type", "1d_before")
        .maybeSingle();

      if (existingReminder) {
        console.log(`[SKIP] Reminder already sent at ${existingReminder.sent_at}`);
        skipped++;
        results.push({
          block_id: block.id,
          status: "skipped",
          reason: "already_sent"
        });
        continue;
      }

      // Build reminder HTML email
      const htmlContent = buildReminderHTML(block, tomorrowStr);

      // Send reminder
      let channel = "none";
      let sendError: string | null = null;

      try {
        // Try SendGrid first (more reliable for emails)
        if (Deno.env.get("SENDGRID_API_KEY")) {
          await sendViaSendGrid(block, htmlContent);
          channel = "sendgrid";
        } else if (Deno.env.get("GHL_API_KEY")) {
          // Fallback to GHL (using plain text version)
          const plainText = `Event: ${booking.event_type}\nDate: ${tomorrowStr}\nContact: ${booking.full_name}`;
          await sendViaGHL(block, plainText);
          channel = "ghl";
        } else {
          console.warn("[WARN] No email provider configured!");
          channel = "none";
        }

        // Record successful send
        const { error: insertError } = await supabase
          .from("availability_block_reminders")
          .insert({
            block_id: block.id,
            booking_id: booking.id,
            reminder_type: "1d_before",
            channel: channel,
            status: "sent",
            metadata: {
              event_date: tomorrowStr,
              event_type: booking.event_type,
              recipient_email: booking.email,
              recipient_phone: booking.phone,
            }
          });

        if (insertError) {
          console.error("[DB_ERROR] Failed to record reminder:", insertError);
          // Continue anyway, reminder was sent
        }

        console.log(`[SUCCESS] ✅ Reminder sent for block ${block.id} via ${channel}`);
        sent++;
        results.push({
          block_id: block.id,
          status: "sent"
        });

      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`[ERROR] Failed to send reminder for block ${block.id}:`, errorMessage);
        
        // Record failed attempt
        await supabase
          .from("availability_block_reminders")
          .insert({
            block_id: block.id,
            booking_id: booking.id,
            reminder_type: "1d_before",
            channel: channel,
            status: "failed",
            error_message: errorMessage,
          });

        errors++;
        results.push({
          block_id: block.id,
          status: "error",
          reason: errorMessage
        });
      }
    }

    console.log("\n=== Summary ===");
    console.log(`Total blocks: ${totalBlocks}`);
    console.log(`Sent: ${sent}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);

    return new Response(
      JSON.stringify({
        success: true,
        date: tomorrowStr,
        total_blocks: totalBlocks,
        sent,
        skipped,
        errors,
        results,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (err) {
    console.error("[FATAL_ERROR]", err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error",
        message: errorMessage
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});
