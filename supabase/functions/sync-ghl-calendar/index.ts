import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_API_VERSION = "2021-04-15";
const VENUE_ADDRESS = "Orlando Event Venue, 3847 E Colonial Dr, Orlando, FL 32803";
const TIMEZONE = "America/New_York";

interface BookingData {
  id: string;
  reservation_number: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  booking_type: string;
  status: string;
  full_name: string;
  email: string;
  phone: string;
  event_type: string;
  number_of_guests: number;
  lead_source: string | null;
  ghl_appointment_id: string | null;
  ghl_contact_id: string | null;
  ghl_appointment_start_at: string | null;
  ghl_appointment_end_at: string | null;
}

/**
 * Convert event_date + time string to ISO timestamp in ET
 */
function toEasternISO(eventDate: string, timeStr: string): string {
  // Parse time (format: "HH:MM" or "HH:MM:SS")
  const [hours, minutes] = timeStr.split(":").map(Number);
  
  // Create date in ET
  const dateStr = `${eventDate}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  
  // For GHL API, we need ISO format with timezone
  // GHL expects: "2024-01-15T14:00:00-05:00" or just the date-time and we specify timezone
  return dateStr;
}

/**
 * Calculate start/end times based on booking type
 */
function calculateTimes(booking: BookingData): { startTime: string; endTime: string } | null {
  if (!booking.event_date) return null;

  let startTimeStr: string;
  let endTimeStr: string;

  if (booking.booking_type === "hourly" && booking.start_time && booking.end_time) {
    startTimeStr = booking.start_time;
    endTimeStr = booking.end_time;
  } else if (booking.booking_type === "daily") {
    // Daily bookings: 10 AM to 10 PM ET
    startTimeStr = "10:00:00";
    endTimeStr = "22:00:00";
  } else {
    // Fallback: use provided times or defaults
    startTimeStr = booking.start_time || "10:00:00";
    endTimeStr = booking.end_time || "22:00:00";
  }

  return {
    startTime: toEasternISO(booking.event_date, startTimeStr),
    endTime: toEasternISO(booking.event_date, endTimeStr),
  };
}

/**
 * Create a contact in GHL
 */
async function createGHLContact(
  locationId: string,
  email: string,
  name: string,
  phone: string | null,
  ghlToken: string
): Promise<string> {
  const url = "https://services.leadconnectorhq.com/contacts";
  
  const payload: Record<string, unknown> = {
    locationId,
    email,
    name,
    source: "Lovable Booking System",
  };
  
  if (phone) {
    payload.phone = phone;
  }

  console.log("Creating GHL contact:", JSON.stringify(payload));

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("GHL create contact failed:", resp.status, errText);
    throw new Error(`Failed to create contact: ${resp.status} - ${errText}`);
  }

  const data = await resp.json();
  const contactId = data.contact?.id || data.id;
  console.log("GHL contact created:", contactId);
  return contactId;
}

/**
 * Ensure we have a GHL contact for the booking
 * - If ghl_contact_id exists, use it
 * - Otherwise, create a new contact in GHL
 * - For internal bookings without email, use placeholder email
 */
async function ensureContact(
  booking: BookingData,
  locationId: string,
  ghlToken: string,
  // deno-lint-ignore no-explicit-any
  supabase: any
): Promise<string> {
  // Use existing contact ID if available (set by GHL webhook automation)
  if (booking.ghl_contact_id) {
    console.log(`Using existing GHL contact: ${booking.ghl_contact_id}`);
    return booking.ghl_contact_id;
  }
  
  // Determine email and name for contact creation
  let email: string;
  let name: string;
  
  if (booking.email && booking.email.trim() !== "") {
    // Normal booking with email
    email = booking.email;
    name = booking.full_name || "Guest";
  } else {
    // Internal booking without email - use placeholder
    const reservationNum = booking.reservation_number || booking.id.substring(0, 8);
    email = `internal+${reservationNum}@orlandoeventvenue.org`;
    name = booking.full_name || "OEV Internal Booking";
    console.log(`Internal booking without email, using placeholder: ${email}`);
  }
  
  // Create contact in GHL
  const contactId = await createGHLContact(
    locationId,
    email,
    name,
    booking.phone || null,
    ghlToken
  );
  
  // Save contact ID to booking for future use
  await supabase
    .from("bookings")
    .update({ ghl_contact_id: contactId })
    .eq("id", booking.id);
  
  console.log(`Saved GHL contact ${contactId} to booking ${booking.id}`);
  
  return contactId;
}

/**
 * Create appointment in GHL Calendar
 */
async function createAppointment(
  contactId: string | null,
  calendarId: string,
  locationId: string,
  assignedUserId: string,
  booking: BookingData,
  startTime: string,
  endTime: string,
  ghlToken: string
): Promise<{ appointmentId: string }> {
  const url = "https://services.leadconnectorhq.com/calendars/events/appointments";
  
  const title = `${booking.event_type} - ${booking.full_name} (${booking.reservation_number || "N/A"})`;
  
  const payload: Record<string, unknown> = {
    calendarId,
    locationId,
    startTime,
    endTime,
    title,
    appointmentStatus: "confirmed",
    assignedUserId,
    address: VENUE_ADDRESS,
    toNotify: false,
    ignoreDateRange: false,
    notes: `Booking ID: ${booking.id}\nReservation: ${booking.reservation_number || "N/A"}\nGuests: ${booking.number_of_guests}\nType: ${booking.booking_type}`,
  };
  
  // Only include contactId if we have one
  if (contactId) {
    payload.contactId = contactId;
  }

  console.log("Creating GHL appointment:", JSON.stringify(payload));

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("GHL create appointment failed:", resp.status, errText);
    throw new Error(`Failed to create appointment: ${resp.status} - ${errText}`);
  }

  const data = await resp.json();
  console.log("GHL appointment created:", data);
  return { appointmentId: data.id || data.event?.id || data.appointment?.id };
}

/**
 * Update existing appointment in GHL Calendar
 */
async function updateAppointment(
  appointmentId: string,
  contactId: string | null,
  calendarId: string,
  locationId: string,
  assignedUserId: string,
  booking: BookingData,
  startTime: string,
  endTime: string,
  ghlToken: string,
  cancelled: boolean = false
): Promise<void> {
  const url = `https://services.leadconnectorhq.com/calendars/events/appointments/${appointmentId}`;
  
  const title = `${booking.event_type} - ${booking.full_name} (${booking.reservation_number || "N/A"})`;
  
  const payload: Record<string, unknown> = {
    calendarId,
    locationId,
    startTime,
    endTime,
    title,
    appointmentStatus: cancelled ? "cancelled" : "confirmed",
    assignedUserId,
    address: VENUE_ADDRESS,
    toNotify: false,
    notes: `Booking ID: ${booking.id}\nReservation: ${booking.reservation_number || "N/A"}\nGuests: ${booking.number_of_guests}\nType: ${booking.booking_type}`,
  };
  
  // Only include contactId if we have one
  if (contactId) {
    payload.contactId = contactId;
  }

  console.log("Updating GHL appointment:", appointmentId, JSON.stringify(payload));

  const resp = await fetch(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("GHL update appointment failed:", resp.status, errText);
    throw new Error(`Failed to update appointment: ${resp.status} - ${errText}`);
  }

  console.log("GHL appointment updated successfully");
}

/**
 * Get appointment from GHL
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
    const errText = await resp.text();
    throw new Error(`Failed to get appointment: ${resp.status} - ${errText}`);
  }

  return resp.json();
}

/**
 * Delete appointment from GHL
 */
async function deleteAppointment(appointmentId: string, ghlToken: string): Promise<void> {
  const url = `https://services.leadconnectorhq.com/calendars/events/${appointmentId}`;
  
  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
    },
  });

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("GHL delete appointment failed:", resp.status, errText);
    // Don't throw - deletion is best-effort for cleanup
  } else {
    console.log("GHL appointment deleted successfully");
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { booking_id, skip_if_unchanged = true } = await req.json();

    if (!booking_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "booking_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get environment variables
    const ghlToken = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN");
    const locationId = Deno.env.get("GHL_LOCATION_ID");
    const calendarId = Deno.env.get("GHL_CALENDAR_ID");
    const assignedUserId = Deno.env.get("GHL_ASSIGNED_USER_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!ghlToken || !locationId || !calendarId || !assignedUserId) {
      console.error("Missing GHL configuration");
      return new Response(
        JSON.stringify({ ok: false, error: "GHL not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Fetch booking
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      console.error("Booking not found:", bookingError);
      return new Response(
        JSON.stringify({ ok: false, error: "Booking not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const bookingData = booking as BookingData;
    const isCancelled = bookingData.status === "cancelled";

    // Calculate times
    const times = calculateTimes(bookingData);
    if (!times && !isCancelled) {
      console.log("Cannot calculate times for booking, skipping calendar sync");
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "No calculable times" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if update is needed (optimization)
    if (skip_if_unchanged && bookingData.ghl_appointment_id && times) {
      const existingStart = bookingData.ghl_appointment_start_at;
      const existingEnd = bookingData.ghl_appointment_end_at;
      
      // Compare just the date-time portion
      if (existingStart?.includes(times.startTime) && existingEnd?.includes(times.endTime) && !isCancelled) {
        console.log("Appointment times unchanged, skipping update");
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: "Times unchanged" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Ensure we have a contact (create if needed)
    const contactId = await ensureContact(bookingData, locationId, ghlToken, supabase);

    let appointmentId = bookingData.ghl_appointment_id;
    let eventType: string;

    if (isCancelled && appointmentId) {
      // Update appointment to cancelled status
      await updateAppointment(
        appointmentId,
        contactId,
        calendarId,
        locationId,
        assignedUserId,
        bookingData,
        times?.startTime || "",
        times?.endTime || "",
        ghlToken,
        true // cancelled
      );
      eventType = "ghl_appointment_cancelled";
    } else if (appointmentId && times) {
      // Update existing appointment
      await updateAppointment(
        appointmentId,
        contactId,
        calendarId,
        locationId,
        assignedUserId,
        bookingData,
        times.startTime,
        times.endTime,
        ghlToken,
        false
      );
      eventType = "ghl_appointment_updated";
    } else if (times && !isCancelled) {
      // Create new appointment
      const result = await createAppointment(
        contactId,
        calendarId,
        locationId,
        assignedUserId,
        bookingData,
        times.startTime,
        times.endTime,
        ghlToken
      );
      appointmentId = result.appointmentId;
      eventType = "ghl_appointment_created";
    } else {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "No action needed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update booking with appointment info
    if (times) {
      await supabase
        .from("bookings")
        .update({
          ghl_appointment_id: appointmentId,
          ghl_calendar_id: calendarId,
          ghl_assigned_user_id: assignedUserId,
          ghl_appointment_start_at: times.startTime,
          ghl_appointment_end_at: times.endTime,
        })
        .eq("id", booking_id);
    }

    // Log event
    await supabase.from("booking_events").insert({
      booking_id,
      event_type: eventType,
      channel: "ghl_calendar",
      metadata: {
        appointment_id: appointmentId,
        calendar_id: calendarId,
        contact_id: contactId,
        start_time: times?.startTime,
        end_time: times?.endTime,
      },
    });

    console.log(`Calendar sync complete for booking ${booking_id}: ${eventType}`);

    return new Response(
      JSON.stringify({
        ok: true,
        booking_id,
        appointment_id: appointmentId,
        event_type: eventType,
        calendar_id: calendarId,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    console.error("Error in sync-ghl-calendar:", err);
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Export for testing
export { getAppointment, deleteAppointment, calculateTimes };
