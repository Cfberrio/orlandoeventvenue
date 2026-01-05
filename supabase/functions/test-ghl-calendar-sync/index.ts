import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_API_VERSION = "2021-04-15";

interface TestResult {
  step: string;
  passed: boolean;
  details: string;
  data?: unknown;
}

/**
 * Get appointment from GHL for verification
 */
async function getAppointment(appointmentId: string, ghlToken: string): Promise<unknown> {
  const url = `https://services.leadconnectorhq.com/calendars/events/appointments/${appointmentId}`;
  
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
    },
  });

  if (!resp.ok) {
    throw new Error(`Failed to get appointment: ${resp.status}`);
  }

  return resp.json();
}

/**
 * Delete appointment from GHL
 */
async function deleteAppointment(appointmentId: string, ghlToken: string): Promise<void> {
  const url = `https://services.leadconnectorhq.com/calendars/events/${appointmentId}`;
  
  await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
    },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const results: TestResult[] = [];
  const createdBookingIds: string[] = [];
  const createdAppointmentIds: string[] = [];

  try {
    const body = await req.json().catch(() => ({}));
    const testEmail = body.email || "test@orlandoeventvenue.org";
    const testName = body.name || "TESTLUIS";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ghlToken = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN")!;
    const calendarId = Deno.env.get("GHL_CALENDAR_ID")!;
    const assignedUserId = Deno.env.get("GHL_ASSIGNED_USER_ID")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Calculate tomorrow's date
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const eventDate = tomorrow.toISOString().split("T")[0];

    // ========== TEST 1: Create hourly booking ==========
    console.log("TEST 1: Creating hourly test booking...");
    
    const hourlyBooking = {
      booking_type: "hourly",
      event_date: eventDate,
      start_time: "14:00:00",
      end_time: "16:00:00",
      number_of_guests: 25,
      event_type: "TEST - Birthday Party",
      full_name: testName,
      email: testEmail,
      phone: "555-TEST-001",
      base_rental: 500,
      total_amount: 700,
      deposit_amount: 350,
      balance_amount: 350,
      status: "confirmed",
      lifecycle_status: "pre_event",
      lead_source: "test_automation",
      initials: "TL",
      signer_name: testName,
      signature: "test-signature",
      signature_date: eventDate,
      agree_to_rules: true,
    };

    const { data: hourlyData, error: hourlyError } = await supabase
      .from("bookings")
      .insert(hourlyBooking)
      .select()
      .single();

    if (hourlyError || !hourlyData) {
      results.push({
        step: "Create hourly booking",
        passed: false,
        details: `Failed: ${hourlyError?.message}`,
      });
      throw new Error("Failed to create hourly booking");
    }

    createdBookingIds.push(hourlyData.id);
    results.push({
      step: "Create hourly booking",
      passed: true,
      details: `Created booking ${hourlyData.id}`,
      data: { booking_id: hourlyData.id, reservation_number: hourlyData.reservation_number },
    });

    // ========== TEST 2: Create internal booking ==========
    console.log("TEST 2: Creating internal test booking...");
    
    const internalBooking = {
      booking_type: "daily",
      event_date: eventDate,
      number_of_guests: 50,
      event_type: "TEST - Internal Event",
      full_name: "OEV Internal Test",
      email: "", // No email for internal
      phone: "",
      base_rental: 0,
      total_amount: 0,
      deposit_amount: 0,
      balance_amount: 0,
      status: "confirmed",
      lifecycle_status: "pre_event",
      lead_source: "internal_admin",
      initials: "IA",
      signer_name: "Admin",
      signature: "internal-signature",
      signature_date: eventDate,
      agree_to_rules: true,
    };

    const { data: internalData, error: internalError } = await supabase
      .from("bookings")
      .insert(internalBooking)
      .select()
      .single();

    if (internalError || !internalData) {
      results.push({
        step: "Create internal booking",
        passed: false,
        details: `Failed: ${internalError?.message}`,
      });
    } else {
      createdBookingIds.push(internalData.id);
      results.push({
        step: "Create internal booking",
        passed: true,
        details: `Created internal booking ${internalData.id}`,
        data: { booking_id: internalData.id },
      });
    }

    // ========== TEST 3: Sync hourly booking to calendar ==========
    console.log("TEST 3: Syncing hourly booking to GHL calendar...");
    
    const syncResp1 = await fetch(`${supabaseUrl}/functions/v1/sync-ghl-calendar`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseServiceKey}`,
      },
      body: JSON.stringify({ booking_id: hourlyData.id, skip_if_unchanged: false }),
    });

    const syncResult1 = await syncResp1.json();
    
    if (!syncResult1.ok || !syncResult1.appointment_id) {
      results.push({
        step: "Sync hourly booking",
        passed: false,
        details: `Failed: ${syncResult1.error || "No appointment_id"}`,
        data: syncResult1,
      });
    } else {
      createdAppointmentIds.push(syncResult1.appointment_id);
      results.push({
        step: "Sync hourly booking",
        passed: true,
        details: `Created appointment ${syncResult1.appointment_id}`,
        data: syncResult1,
      });
    }

    // ========== TEST 4: Sync internal booking to calendar ==========
    if (internalData) {
      console.log("TEST 4: Syncing internal booking to GHL calendar...");
      
      const syncResp2 = await fetch(`${supabaseUrl}/functions/v1/sync-ghl-calendar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ booking_id: internalData.id, skip_if_unchanged: false }),
      });

      const syncResult2 = await syncResp2.json();
      
      if (!syncResult2.ok || !syncResult2.appointment_id) {
        results.push({
          step: "Sync internal booking",
          passed: false,
          details: `Failed: ${syncResult2.error || "No appointment_id"}`,
          data: syncResult2,
        });
      } else {
        createdAppointmentIds.push(syncResult2.appointment_id);
        results.push({
          step: "Sync internal booking",
          passed: true,
          details: `Created appointment ${syncResult2.appointment_id}`,
          data: syncResult2,
        });
      }
    }

    // ========== TEST 5: Verify appointment in GHL ==========
    if (syncResult1.appointment_id) {
      console.log("TEST 5: Verifying appointment in GHL...");
      
      try {
        const apptData = await getAppointment(syncResult1.appointment_id, ghlToken) as { calendarId?: string; assignedUserId?: string; startTime?: string; endTime?: string };
        
        const calendarMatch = apptData.calendarId === calendarId;
        const userMatch = apptData.assignedUserId === assignedUserId;
        
        results.push({
          step: "Verify GHL appointment",
          passed: calendarMatch && userMatch,
          details: `calendarId: ${calendarMatch ? "PASS" : "FAIL"}, assignedUserId: ${userMatch ? "PASS" : "FAIL"}`,
          data: {
            expected_calendar: calendarId,
            actual_calendar: apptData.calendarId,
            expected_user: assignedUserId,
            actual_user: apptData.assignedUserId,
            startTime: apptData.startTime,
            endTime: apptData.endTime,
          },
        });
      } catch (err) {
        results.push({
          step: "Verify GHL appointment",
          passed: false,
          details: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
        });
      }
    }

    // ========== TEST 6: Update booking time and re-sync ==========
    console.log("TEST 6: Updating booking time and re-syncing...");
    
    const { error: updateError } = await supabase
      .from("bookings")
      .update({ start_time: "14:30:00", end_time: "16:30:00" })
      .eq("id", hourlyData.id);

    if (updateError) {
      results.push({
        step: "Update booking time",
        passed: false,
        details: `Failed: ${updateError.message}`,
      });
    } else {
      // Re-sync
      const syncResp3 = await fetch(`${supabaseUrl}/functions/v1/sync-ghl-calendar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ booking_id: hourlyData.id, skip_if_unchanged: false }),
      });

      const syncResult3 = await syncResp3.json();
      
      // Should be an UPDATE, same appointment_id
      const sameAppointment = syncResult3.appointment_id === syncResult1.appointment_id;
      const wasUpdate = syncResult3.event_type === "ghl_appointment_updated";
      
      results.push({
        step: "Update and re-sync",
        passed: sameAppointment && wasUpdate,
        details: `Same appointment: ${sameAppointment ? "PASS" : "FAIL"}, Was update: ${wasUpdate ? "PASS" : "FAIL"}`,
        data: syncResult3,
      });
    }

    // ========== CLEANUP ==========
    console.log("Cleaning up test data...");

    // Delete appointments from GHL
    for (const apptId of createdAppointmentIds) {
      try {
        await deleteAppointment(apptId, ghlToken);
        console.log(`Deleted GHL appointment: ${apptId}`);
      } catch (err) {
        console.error(`Failed to delete appointment ${apptId}:`, err);
      }
    }

    // Delete test bookings
    for (const bookingId of createdBookingIds) {
      // First delete related records
      await supabase.from("booking_events").delete().eq("booking_id", bookingId);
      await supabase.from("bookings").delete().eq("id", bookingId);
      console.log(`Deleted test booking: ${bookingId}`);
    }

    results.push({
      step: "Cleanup",
      passed: true,
      details: `Deleted ${createdAppointmentIds.length} appointments and ${createdBookingIds.length} bookings`,
    });

    // ========== SUMMARY ==========
    const allPassed = results.every(r => r.passed);
    const passCount = results.filter(r => r.passed).length;
    const totalCount = results.length;

    return new Response(
      JSON.stringify({
        summary: allPassed ? "ALL TESTS PASSED" : "SOME TESTS FAILED",
        passed: passCount,
        total: totalCount,
        results,
        config: {
          calendar_id: calendarId,
          assigned_user_id: assignedUserId,
        },
      }, null, 2),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("Test error:", err);
    
    // Cleanup on error
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ghlToken = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    for (const apptId of createdAppointmentIds) {
      try {
        await deleteAppointment(apptId, ghlToken);
      } catch (_e) { /* ignore */ }
    }

    for (const bookingId of createdBookingIds) {
      try {
        await supabase.from("booking_events").delete().eq("booking_id", bookingId);
        await supabase.from("bookings").delete().eq("id", bookingId);
      } catch (_e) { /* ignore */ }
    }

    return new Response(
      JSON.stringify({
        summary: "TEST FAILED WITH ERROR",
        error: err instanceof Error ? err.message : "Unknown error",
        results,
      }, null, 2),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
