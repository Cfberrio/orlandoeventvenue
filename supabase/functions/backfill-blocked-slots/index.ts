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
    // Auth check for admin secret
    const adminSecret = Deno.env.get("ADMIN_SECRET");
    const providedSecret = req.headers.get("authorization")?.replace("Bearer ", "");
    
    if (adminSecret && providedSecret !== adminSecret) {
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

    console.log(`[BACKFILL] Starting backfill of blocked slots for existing appointments`);

    // Get ALL appointments from today onwards (no 24h limit)
    const now = new Date();
    const futureLimit = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000); // 1 year ahead
    
    const startTime = now.toISOString();
    const endTime = futureLimit.toISOString();

    console.log(`[BACKFILL] Fetching appointments from ${startTime} to ${endTime}`);

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
      const errorText = await resp.text();
      console.error(`[BACKFILL] GHL API error: ${resp.status} ${errorText}`);
      throw new Error(`GHL API error: ${resp.status}`);
    }

    const data = await resp.json();
    const events = data.events || [];

    console.log(`[BACKFILL] Found ${events.length} events from GHL`);

    // Get existing blocked slots to avoid duplicates
    const { data: bookingsWithSlots } = await supabase
      .from("bookings")
      .select("ghl_appointment_id, ghl_blocked_slot_id")
      .not("ghl_blocked_slot_id", "is", null);

    const existingSlotsByAppointment = new Map(
      (bookingsWithSlots || []).map(b => [b.ghl_appointment_id, b.ghl_blocked_slot_id])
    );

    console.log(`[BACKFILL] Found ${existingSlotsByAppointment.size} existing blocked slots in DB`);

    let created = 0;
    let skipped = 0;
    let errors = 0;
    const errorDetails: Array<{appointmentId: string; error: string}> = [];

    // For each appointment, check if blocked slot exists
    for (const event of events) {
      const appointmentId = event.id || event.appointmentId;
      
      if (!appointmentId) {
        console.warn(`[BACKFILL] Event without ID, skipping:`, event.title);
        skipped++;
        continue;
      }

      // Skip if already has blocked slot in our DB
      if (existingSlotsByAppointment.has(appointmentId)) {
        console.log(`[BACKFILL] Appointment ${appointmentId} already has blocked slot, skipping`);
        skipped++;
        continue;
      }

      // Check if this appointment is in our bookings table
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, ghl_blocked_slot_id, full_name")
        .eq("ghl_appointment_id", appointmentId)
        .single();

      if (booking && booking.ghl_blocked_slot_id) {
        // Already has blocked slot
        console.log(`[BACKFILL] Booking ${booking.id} already has blocked slot, skipping`);
        skipped++;
        continue;
      }

      // Create blocked slot for this appointment
      const blockedSlotUrl = `${GHL_API_BASE}/calendars/${GHL_CALENDAR_ID}/blocked-slots`;
      const blockedSlotPayload = {
        startTime: event.startTime,
        endTime: event.endTime,
        title: event.title || "Booking",
        reason: "Backfilled from existing appointment"
      };

      console.log(`[BACKFILL] Creating blocked slot for appointment ${appointmentId}: ${event.title}`);

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

        console.log(`[BACKFILL] ✅ Created blocked slot ${blockedSlotId} for appointment ${appointmentId}`);

        // Update booking if exists in our DB
        if (booking) {
          await supabase
            .from("bookings")
            .update({ ghl_blocked_slot_id: blockedSlotId })
            .eq("id", booking.id);
          console.log(`[BACKFILL] Updated booking ${booking.id} with blocked slot ID`);
        }

        created++;
      } else {
        const errorText = await createResp.text();
        console.error(`[BACKFILL] ❌ Failed to create blocked slot for ${appointmentId}: ${createResp.status} ${errorText}`);
        errorDetails.push({
          appointmentId,
          error: `${createResp.status}: ${errorText}`
        });
        errors++;
      }
    }

    console.log(`[BACKFILL] Completed: ${created} created, ${skipped} skipped, ${errors} errors`);

    return new Response(
      JSON.stringify({
        ok: true,
        created,
        skipped,
        errors,
        total: events.length,
        errorDetails: errorDetails.length > 0 ? errorDetails : undefined
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error("[BACKFILL] Error:", err);
    return new Response(
      JSON.stringify({ ok: false, error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
