import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-04-15";
const GHL_CALENDAR_ID = "tCUlP3Dalpf0fnhAPG52";

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check for cron secret
    const cronSecret = Deno.env.get("CRON_SECRET");
    const providedSecret = req.headers.get("authorization")?.replace("Bearer ", "");
    
    if (cronSecret && providedSecret !== cronSecret) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const ghlToken = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN");
    const locationId = Deno.env.get("GHL_LOCATION_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    if (!ghlToken || !locationId) {
      throw new Error("Missing GHL credentials");
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get appointments from last 24 hours to catch Google Calendar syncs
    const now = new Date();
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const futureLimit = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days ahead
    
    const startTime = yesterday.toISOString();
    const endTime = futureLimit.toISOString();

    console.log(`[CRON] Fetching appointments from ${startTime} to ${endTime}`);

    // Get all appointments from GHL by assigned user
    const assignedUserId = Deno.env.get("GHL_ASSIGNED_USER_ID");
    const url = `${GHL_API_BASE}/calendars/events?userId=${assignedUserId}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&locationId=${locationId}`;
    
    const resp = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghlToken}`,
        'Version': GHL_API_VERSION,
      },
    });

    if (!resp.ok) {
      throw new Error(`GHL API error: ${resp.status}`);
    }

    const data = await resp.json();
    const events = data.events || [];

    console.log(`[CRON] Found ${events.length} events from GHL`);

    // Get existing blocked slots to avoid duplicates
    const { data: bookingsWithSlots } = await supabase
      .from("bookings")
      .select("ghl_appointment_id, ghl_blocked_slot_id")
      .not("ghl_blocked_slot_id", "is", null);

    const existingSlotsByAppointment = new Map(
      (bookingsWithSlots || []).map(b => [b.ghl_appointment_id, b.ghl_blocked_slot_id])
    );

    let created = 0;
    let skipped = 0;

    // For each appointment, check if blocked slot exists
    for (const event of events) {
      const appointmentId = event.id || event.appointmentId;
      
      if (!appointmentId) {
        skipped++;
        continue;
      }

      // Skip if already has blocked slot in our DB
      if (existingSlotsByAppointment.has(appointmentId)) {
        skipped++;
        continue;
      }

      // Check if this appointment is in our bookings table
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, ghl_blocked_slot_id")
        .eq("ghl_appointment_id", appointmentId)
        .single();

      if (booking && booking.ghl_blocked_slot_id) {
        // Already has blocked slot
        skipped++;
        continue;
      }

      // Create blocked slot for this appointment
      const blockedSlotUrl = `${GHL_API_BASE}/calendars/${GHL_CALENDAR_ID}/blocked-slots`;
      const blockedSlotPayload = {
        startTime: event.startTime,
        endTime: event.endTime,
        title: event.title || "Booking",
        reason: "Auto-synced from appointment"
      };

      const createResp = await fetch(blockedSlotUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${ghlToken}`,
          'Version': GHL_API_VERSION,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(blockedSlotPayload),
      });

      if (createResp.ok) {
        const blockedSlotData = await createResp.json();
        const blockedSlotId = blockedSlotData.id || blockedSlotData.blockedSlotId;

        console.log(`[CRON] Created blocked slot ${blockedSlotId} for appointment ${appointmentId}`);

        // Update booking if exists in our DB
        if (booking) {
          await supabase
            .from("bookings")
            .update({ ghl_blocked_slot_id: blockedSlotId })
            .eq("id", booking.id);
        }

        created++;
      } else {
        console.error(`[CRON] Failed to create blocked slot for ${appointmentId}: ${createResp.status}`);
        skipped++;
      }
    }

    console.log(`[CRON] Completed: ${created} created, ${skipped} skipped`);

    return new Response(
      JSON.stringify({
        ok: true,
        created,
        skipped,
        total: events.length
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error("[CRON] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
