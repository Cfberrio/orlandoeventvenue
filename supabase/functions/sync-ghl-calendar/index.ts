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

interface StaffAssignment {
  staff_id: string;
  assignment_role: string;
  staff_members: {
    email: string | null;
    full_name: string;
  };
}

/**
 * Determine if we're in DST for America/New_York
 * DST: second Sunday of March to first Sunday of November
 */
function isDST(date: Date): boolean {
  const year = date.getFullYear();
  
  // Second Sunday of March
  const marchFirst = new Date(year, 2, 1);
  const marchFirstDay = marchFirst.getDay();
  const secondSundayMarch = 8 + (7 - marchFirstDay) % 7;
  const dstStart = new Date(year, 2, secondSundayMarch, 2, 0, 0);
  
  // First Sunday of November  
  const novFirst = new Date(year, 10, 1);
  const novFirstDay = novFirst.getDay();
  const firstSundayNov = 1 + (7 - novFirstDay) % 7;
  const dstEnd = new Date(year, 10, firstSundayNov, 2, 0, 0);
  
  return date >= dstStart && date < dstEnd;
}

/**
 * Convert event_date + time string to ISO timestamp with proper ET offset
 * GHL requires ISO 8601 format with timezone offset
 */
function toEasternISO(eventDate: string, timeStr: string): string {
  // Parse time (format: "HH:MM" or "HH:MM:SS")
  const [hours, minutes] = timeStr.split(":").map(Number);
  
  // Create date object to check DST
  const [year, month, day] = eventDate.split("-").map(Number);
  const dateObj = new Date(year, month - 1, day, hours, minutes);
  
  // Determine offset: -04:00 for EDT (DST), -05:00 for EST (standard)
  const offset = isDST(dateObj) ? "-04:00" : "-05:00";
  
  // Format as ISO 8601 with timezone offset
  const dateTimeStr = `${eventDate}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00${offset}`;
  
  console.log(`Time conversion: ${eventDate} ${timeStr} -> ${dateTimeStr} (DST: ${isDST(dateObj)})`);
  
  return dateTimeStr;
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
 * Search for existing contact in GHL by email
 */
async function findGHLContactByEmail(
  locationId: string,
  email: string,
  ghlToken: string
): Promise<string | null> {
  const url = `https://services.leadconnectorhq.com/contacts/search`;
  
  console.log(`Searching for GHL contact with email: ${email}`);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      locationId,
      query: email,
      limit: 1,
    }),
  });

  if (!resp.ok) {
    console.log("GHL contact search failed, will try to create:", resp.status);
    return null;
  }

  const data = await resp.json();
  const contacts = data.contacts || [];
  
  // Find exact email match
  const match = contacts.find((c: { email?: string }) => 
    c.email?.toLowerCase() === email.toLowerCase()
  );
  
  if (match) {
    console.log(`Found existing GHL contact: ${match.id}`);
    return match.id;
  }
  
  return null;
}

/**
 * Create a contact in GHL (or return existing if duplicate detected)
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
    
    // Check if it's a duplicate contact error - extract the contactId from the error
    try {
      const errData = JSON.parse(errText);
      if (errData.meta?.contactId) {
        console.log(`Contact already exists in GHL, using existing: ${errData.meta.contactId}`);
        return errData.meta.contactId;
      }
    } catch {
      // Not JSON or no contactId in error
    }
    
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
 * Get staff email for GHL user lookup
 */
async function getStaffGHLUserIds(
  bookingId: string,
  locationId: string,
  ghlToken: string,
  // deno-lint-ignore no-explicit-any
  supabase: any
): Promise<string[]> {
  // Fetch staff assignments with email
  const { data: assignments, error } = await supabase
    .from("booking_staff_assignments")
    .select(`
      staff_id,
      assignment_role,
      staff_members!inner(email, full_name)
    `)
    .eq("booking_id", bookingId);

  if (error || !assignments || assignments.length === 0) {
    console.log("No staff assignments found for booking");
    return [];
  }

  console.log(`Found ${assignments.length} staff assignments:`, JSON.stringify(assignments));

  // For each staff member with email, try to find their GHL user ID
  const ghlUserIds: string[] = [];
  
  for (const assignment of assignments as StaffAssignment[]) {
    const staffEmail = assignment.staff_members?.email;
    if (!staffEmail) {
      console.log(`Staff ${assignment.staff_id} has no email, skipping`);
      continue;
    }

    // Search for GHL team member by email using GET /users endpoint
    try {
      const userListUrl = `https://services.leadconnectorhq.com/users/?locationId=${locationId}`;
      const resp = await fetch(userListUrl, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${ghlToken}`,
          "Version": GHL_API_VERSION,
          "Accept": "application/json",
        },
      });

      if (resp.ok) {
        const data = await resp.json();
        const users = data.users || [];
        console.log(`GHL returned ${users.length} users for location`);
        
        const matchedUser = users.find((u: { email?: string }) => 
          u.email?.toLowerCase() === staffEmail.toLowerCase()
        );
        
        if (matchedUser) {
          console.log(`Found GHL user for staff ${staffEmail}: ${matchedUser.id}`);
          ghlUserIds.push(matchedUser.id);
        } else {
          console.log(`No GHL user found for staff email: ${staffEmail}. Available emails:`, 
            users.map((u: { email?: string }) => u.email).join(", "));
        }
      } else {
        const errText = await resp.text();
        console.log(`GHL users list failed for ${staffEmail}:`, resp.status, errText);
      }
    } catch (err) {
      console.error(`Error listing GHL users for ${staffEmail}:`, err);
    }
  }

  return ghlUserIds;
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
  ghlToken: string,
  additionalUserIds: string[] = []
): Promise<{ appointmentId: string }> {
  const url = "https://services.leadconnectorhq.com/calendars/events/appointments";
  
  const title = `${booking.event_type} - ${booking.full_name} (${booking.reservation_number || "N/A"})`;
  
  // Combine primary assigned user with additional staff users
  const allUserIds = [assignedUserId, ...additionalUserIds.filter(id => id !== assignedUserId)];
  
  const payload: Record<string, unknown> = {
    calendarId,
    locationId,
    startTime,
    endTime,
    title,
    appointmentStatus: "confirmed",
    assignedUserId, // Primary owner
    address: VENUE_ADDRESS,
    toNotify: true, // Enable notifications so staff get calendar invites
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
    notes: `Booking ID: ${booking.id}\nReservation: ${booking.reservation_number || "N/A"}\nGuests: ${booking.number_of_guests}\nType: ${booking.booking_type}`,
  };
  
  // Add additional staff as users if GHL supports it
  if (allUserIds.length > 1) {
    payload.users = allUserIds;
    console.log(`Adding ${allUserIds.length} users to appointment:`, allUserIds);
  }
  
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
  console.log("GHL appointment created:", JSON.stringify(data));
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
  cancelled: boolean = false,
  additionalUserIds: string[] = []
): Promise<void> {
  const url = `https://services.leadconnectorhq.com/calendars/events/appointments/${appointmentId}`;
  
  const title = `${booking.event_type} - ${booking.full_name} (${booking.reservation_number || "N/A"})`;
  
  // Combine primary assigned user with additional staff users
  const allUserIds = [assignedUserId, ...additionalUserIds.filter(id => id !== assignedUserId)];
  
  const payload: Record<string, unknown> = {
    calendarId,
    locationId,
    startTime,
    endTime,
    title,
    appointmentStatus: cancelled ? "cancelled" : "confirmed",
    assignedUserId,
    address: VENUE_ADDRESS,
    toNotify: true, // Enable notifications
    ignoreDateRange: true,
    ignoreFreeSlotValidation: true,
    notes: `Booking ID: ${booking.id}\nReservation: ${booking.reservation_number || "N/A"}\nGuests: ${booking.number_of_guests}\nType: ${booking.booking_type}`,
  };
  
  // Add additional staff as users
  if (allUserIds.length > 1) {
    payload.users = allUserIds;
  }
  
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

    // Calculate times with proper timezone
    const times = calculateTimes(bookingData);
    if (!times && !isCancelled) {
      console.log("Cannot calculate times for booking, skipping calendar sync");
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "No calculable times" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Calculated times for booking ${bookingData.reservation_number}: start=${times?.startTime}, end=${times?.endTime}`);

    // Get staff GHL user IDs for calendar invites
    const staffGHLUserIds = await getStaffGHLUserIds(booking_id, locationId, ghlToken, supabase);
    console.log(`Staff GHL user IDs: ${JSON.stringify(staffGHLUserIds)}`);

    // Check if update is needed (optimization) - but force update if staff changed
    if (skip_if_unchanged && bookingData.ghl_appointment_id && times) {
      const existingStart = bookingData.ghl_appointment_start_at;
      const existingEnd = bookingData.ghl_appointment_end_at;
      
      // Compare with timezone-aware times
      if (existingStart === times.startTime && existingEnd === times.endTime && !isCancelled && staffGHLUserIds.length === 0) {
        console.log("Appointment times unchanged and no new staff, skipping update");
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
        true, // cancelled
        staffGHLUserIds
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
        false,
        staffGHLUserIds
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
        ghlToken,
        staffGHLUserIds
      );
      appointmentId = result.appointmentId;
      eventType = "ghl_appointment_created";
    } else {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "No action needed" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Update booking with appointment info (store with timezone)
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
        staff_user_ids: staffGHLUserIds,
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
        staff_synced: staffGHLUserIds.length,
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
