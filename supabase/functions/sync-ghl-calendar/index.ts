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
 * Get timezone offset in milliseconds using Intl.DateTimeFormat
 * This correctly handles DST transitions for any timezone
 */
function getTimeZoneOffsetMillis(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    parseInt(map.hour, 10),
    parseInt(map.minute, 10),
    parseInt(map.second, 10)
  );
  return asUTC - date.getTime();
}

/**
 * Convert zoned date/time to UTC milliseconds
 */
function zonedDateTimeToUtcMillis(
  dateStr: string,
  timeHHmm: string,
  timeZone: string
): number | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  
  const tm = timeHHmm.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!tm) return null;
  const h = parseInt(tm[1], 10), mi = parseInt(tm[2], 10), s = parseInt(tm[3] || "0", 10);
  
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = getTimeZoneOffsetMillis(new Date(utcGuess), timeZone);
  return utcGuess - offset;
}

/**
 * Convert zoned date/time to UTC ISO string (ends with "Z")
 */
function zonedDateTimeToUtcISOString(
  dateStr: string,
  timeStr: string,
  timeZone: string
): string | null {
  const ms = zonedDateTimeToUtcMillis(dateStr, timeStr, timeZone);
  if (ms === null) return null;
  return new Date(ms).toISOString(); // Ends with "Z"
}

/**
 * Calculate start/end times based on booking type
 * Returns UTC ISO strings (ending with "Z")
 */
function calculateTimes(booking: BookingData): { startTime: string; endTime: string } | null {
  if (!booking.event_date) return null;

  let startTimeStr: string;
  let endTimeStr: string;

  if (booking.booking_type === "hourly") {
    if (!booking.start_time || !booking.end_time) {
      console.log("Hourly booking missing times, cannot calculate");
      return null; // Don't create appointment without times
    }
    startTimeStr = booking.start_time;
    endTimeStr = booking.end_time;
  } else if (booking.booking_type === "daily") {
    // Daily: block entire day (00:00:00 - 23:59:59)
    startTimeStr = "00:00:00";
    endTimeStr = "23:59:59";
  } else {
    // Unknown booking type: block entire day as fallback
    console.log(`Unknown booking_type: ${booking.booking_type}, using daily fallback`);
    startTimeStr = "00:00:00";
    endTimeStr = "23:59:59";
  }

  const startISO = zonedDateTimeToUtcISOString(booking.event_date, startTimeStr, TIMEZONE);
  const endISO = zonedDateTimeToUtcISOString(booking.event_date, endTimeStr, TIMEZONE);
  
  if (!startISO || !endISO) {
    console.log("Failed to convert times to UTC ISO");
    return null;
  }

  console.log(`Time conversion: ${booking.event_date} ${startTimeStr}-${endTimeStr} ET -> ${startISO} - ${endISO} UTC`);

  return { startTime: startISO, endTime: endISO };
}

/**
 * Search for existing contact in GHL by email
 */
async function findGHLContactByEmail(
  locationId: string,
  email: string,
  ghlToken: string,
  tokenFingerprint: string | null
): Promise<string | null> {
  const url = `https://services.leadconnectorhq.com/contacts/search`;
  
  console.log(`Searching for GHL contact with email: ${email}`);

  const resp = await fetchWithTimeout(url, {
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
  }, 8000);

  if (resp.status === 401) {
    console.error(`[GHL][401] contacts search denied with token: ${tokenFingerprint}`);
    throw new Error("ghl_scope_contacts_read_denied");
  }

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
  ghlToken: string,
  tokenFingerprint: string | null
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

  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, 8000);

  if (resp.status === 401) {
    console.error(`[GHL][401] contacts.write denied with token: ${tokenFingerprint}`);
    throw new Error("ghl_scope_contacts_write_denied");
  }

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
  supabase: any,
  tokenFingerprint: string | null
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
    ghlToken,
    tokenFingerprint
  );
  
  // Save contact ID to booking for future use
  await supabase
    .from("bookings")
    .update({ ghl_contact_id: contactId })
    .eq("id", booking.id);
  
  console.log(`Saved GHL contact ${contactId} to booking ${booking.id}`);
  
  return contactId;
}

interface StaffInfo {
  ghlUserId: string | null;
  name: string;
  email: string;
  role: string;
}

interface StaffSyncResult {
  ghlUserIds: string[];
  staffInfo: StaffInfo[];
}

/**
 * Get staff info and GHL user IDs for calendar sync
 */
async function getStaffForCalendarSync(
  bookingId: string,
  locationId: string,
  ghlToken: string,
  // deno-lint-ignore no-explicit-any
  supabase: any
): Promise<StaffSyncResult> {
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
    return { ghlUserIds: [], staffInfo: [] };
  }

  console.log(`Found ${assignments.length} staff assignments:`, JSON.stringify(assignments));

  // Get all GHL users once (not per staff member)
  let ghlUsers: { id: string; email?: string }[] = [];
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
      ghlUsers = data.users || [];
      console.log(`GHL returned ${ghlUsers.length} users for location`);
    } else {
      const errText = await resp.text();
      console.log(`GHL users list failed:`, resp.status, errText);
    }
  } catch (err) {
    console.error(`Error listing GHL users:`, err);
  }

  const ghlUserIds: string[] = [];
  const staffInfo: StaffInfo[] = [];
  
  for (const assignment of assignments as StaffAssignment[]) {
    const staffEmail = assignment.staff_members?.email || "";
    const staffName = assignment.staff_members?.full_name || "Unknown";
    const staffRole = assignment.assignment_role || "Staff";

    // Try to find GHL user for this staff member
    let ghlUserId: string | null = null;
    if (staffEmail) {
      const matchedUser = ghlUsers.find((u) => 
        u.email?.toLowerCase() === staffEmail.toLowerCase()
      );
      if (matchedUser) {
        console.log(`Found GHL user for staff ${staffEmail}: ${matchedUser.id}`);
        ghlUserId = matchedUser.id;
        ghlUserIds.push(matchedUser.id);
      } else {
        console.log(`No GHL user found for staff email: ${staffEmail}`);
      }
    }

    staffInfo.push({
      ghlUserId,
      name: staffName,
      email: staffEmail,
      role: staffRole,
    });
  }

  return { ghlUserIds, staffInfo };
}

/**
 * Build formatted notes for calendar event
 */
function buildEventNotes(booking: BookingData, staffInfo: StaffInfo[]): string {
  const notesLines = [
    `Orlando Event Venue – Access Instructions & Rules`,
    `Welcome to Orlando Event Venue!`,
    `3847 E Colonial Dr, Orlando, FL 32803`,
    `Wifi - User: GlobalChurch / Password: Orlandoministry`,
    ``,
    `Step-by-Step Venue Access`,
    `1. Locate the Entrance`,
    `Arrive at Colonial Event Space in Colonial Town Center. Look for the Global sign with the number 3847 displayed.`,
    ``,
    `2. Venue Entry & Lockbox Access`,
    `• Facing the Global sign, go to the door on the left side of the building.`,
    `• On the wall near the entrance, you will find a black lockbox with a touchscreen keypad.`,
    `• Touch the screen first to light it up, then enter the CODE: 10102025.`,
    `• Unlock the box and retrieve the Magnetic Key.`,
    ``,
    `3. Unlock the Door`,
    `• Tap the magnetic key on the sensor (located on the right side of the door).`,
    `• After unlocking, return the key to the lockbox and close it.`,
    ``,
    `4. Enter the Venue`,
    `• Open the door and step inside.`,
    `• On the left wall, locate the remote labeled "Light".`,
    `• Point it at the lights and press the left-side buttons to turn them on.`,
    `• Return the remote to its original spot after use.`,
    ``,
    `Venue Rules & Penalties`,
    `1. Setup & Breakdown – $150 Fee if Violated`,
    `Guests must set up chairs/tables and return them to their original layout within allocated setup/breakdown time.`,
    ``,
    `2. No Alcohol – $250 Fee`,
    `Strictly prohibited. Violations recorded by cameras. Severe cases may end event without refund.`,
    ``,
    `3. No Drugs – $500 Fee`,
    `Possession/use strictly forbidden. Law enforcement may be notified.`,
    ``,
    `4. No Smoking – $300 Fee`,
    `Applies indoors and around the venue perimeter.`,
    ``,
    `5. No Pets – $100 Fee`,
    `Only certified service animals allowed with prior authorization.`,
    ``,
    `6. Food & Beverage – $300 Fee for Violations`,
    `• Professional caterers allowed (with liability insurance).`,
    `• Commercially prepared food permitted.`,
    `• No on-site cooking unless pre-approved.`,
    ``,
    `7. No Glitter/Confetti – $300 Cleaning Fee`,
    `Strictly prohibited (includes rice, similar items).`,
    ``,
    `8. Setup/Breakdown Time Limits – $200/hr Fee`,
    `50% of booking time is allocated for setup/breakdown. Example: 2 hrs for setup/cleanup in a 4-hr booking.`,
    ``,
    `9. Noise Limits – $150 Fee`,
    `Amplified music allowed within city ordinance limits. All events must end before quiet hours.`,
    ``,
    `10. Occupancy Limit – $200 Fee`,
    `Maximum capacity is 90 guests.`,
    ``,
    `11. Decorations – $200 Fee for Damage`,
    `No nails, staples, residue tape, or open flames (unless pre-approved).`,
    ``,
    `12. Damage & Repair – $200 Minimum`,
    `Guest is responsible for any damage caused during the event.`,
    ``,
    `Contact:`,
    `Luis Torres`,
    `(407) 276-3234`,
  ];

  // Add staff section if there are staff assigned
  if (staffInfo.length > 0) {
    notesLines.push(``);
    notesLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    notesLines.push(`👷 ASSIGNED STAFF`);
    notesLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    notesLines.push(``);
    
    for (const staff of staffInfo) {
      const syncStatus = staff.ghlUserId ? "✅" : "⚠️";
      notesLines.push(`${syncStatus} ${staff.name}`);
      notesLines.push(`   📧 ${staff.email || "No email"}`);
      notesLines.push(`   🏷️ Role: ${staff.role}`);
      notesLines.push(``);
    }
  }

  // Add booking info at the end
  notesLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  notesLines.push(`📋 BOOKING INFO`);
  notesLines.push(`━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  notesLines.push(`Reservation: ${booking.reservation_number || "N/A"}`);
  notesLines.push(`Guest: ${booking.full_name}`);
  notesLines.push(`Phone: ${booking.phone}`);
  notesLines.push(`Email: ${booking.email}`);
  notesLines.push(`Guests: ${booking.number_of_guests}`);

  return notesLines.join('\n');
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
  staffResult: StaffSyncResult,
  tokenFingerprint: string | null
): Promise<{ appointmentId: string }> {
  const url = "https://services.leadconnectorhq.com/calendars/events/appointments";
  
  // Build title: {full_name} {event_type} - Orlando Event Venue
  const eventTypeDisplay = booking.event_type.charAt(0).toUpperCase() + booking.event_type.slice(1);
  const title = `${booking.full_name} ${eventTypeDisplay} - Orlando Event Venue`;
  
  // Combine primary assigned user with additional staff users
  const allUserIds = [assignedUserId, ...staffResult.ghlUserIds.filter(id => id !== assignedUserId)];
  
  // Build notes with staff info included
  const notes = buildEventNotes(booking, staffResult.staffInfo);
  
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
    notes,
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

  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, 8000);

  if (resp.status === 401) {
    console.error(`[GHL][401] calendars.events.write denied with token: ${tokenFingerprint}`);
    throw new Error("ghl_scope_calendars_events_write_denied");
  }

  if (!resp.ok) {
    const errText = await resp.text();
    console.error("GHL create appointment failed:", resp.status, errText);
    throw new Error(`Failed to create appointment: ${resp.status} - ${errText}`);
  }

  const data = await resp.json();
  const appointmentId = data.id || data.event?.id || data.appointment?.id;
  console.log("GHL appointment created:", appointmentId);
  
  return { appointmentId };
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
  staffResult: StaffSyncResult,
  tokenFingerprint: string | null,
): Promise<void> {
  const url = `https://services.leadconnectorhq.com/calendars/events/appointments/${appointmentId}`;
  
  // Build title: {full_name} {event_type} - Orlando Event Venue
  const eventTypeDisplay = booking.event_type.charAt(0).toUpperCase() + booking.event_type.slice(1);
  const title = `${booking.full_name} ${eventTypeDisplay} - Orlando Event Venue`;
  
  // Combine primary assigned user with additional staff users
  const allUserIds = [assignedUserId, ...staffResult.ghlUserIds.filter(id => id !== assignedUserId)];
  
  // Build notes with staff info included
  const notes = buildEventNotes(booking, staffResult.staffInfo);
  
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
    notes,
  };
  
  // Add additional staff as users
  if (allUserIds.length > 1) {
    payload.users = allUserIds;
    console.log(`Adding ${allUserIds.length} users to appointment:`, allUserIds);
  }
  
  // Only include contactId if we have one
  if (contactId) {
    payload.contactId = contactId;
  }

  console.log("Updating GHL appointment:", appointmentId, JSON.stringify(payload));

  const resp = await fetchWithTimeout(url, {
    method: "PUT",
    headers: {
      "Authorization": `Bearer ${ghlToken}`,
      "Version": GHL_API_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, 8000);

  if (resp.status === 401) {
    console.error(`[GHL][401] calendars.events.write denied with token: ${tokenFingerprint}`);
    throw new Error("ghl_scope_calendars_events_write_denied");
  }

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

/**
 * Extract booking_id from various payload formats
 * Supports: { booking_id }, { record: { id } }, { new: { id } }, { data: { record: { id } } }
 */
function extractBookingId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  
  // Format: { booking_id: "..." }
  if (typeof obj.booking_id === "string") return obj.booking_id;
  
  // Format: { record: { id: "..." } }
  if (obj.record && typeof obj.record === "object") {
    const rec = obj.record as Record<string, unknown>;
    if (typeof rec.id === "string") return rec.id;
  }
  
  // Format: { new: { id: "..." } } (trigger format)
  if (obj.new && typeof obj.new === "object") {
    const newRec = obj.new as Record<string, unknown>;
    if (typeof newRec.id === "string") return newRec.id;
  }
  
  // Format: { data: { record: { id: "..." } } }
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (data.record && typeof data.record === "object") {
      const rec = data.record as Record<string, unknown>;
      if (typeof rec.id === "string") return rec.id;
    }
  }
  
  return null;
}

// ============= GHL CONFIG WITH DEBUG =============

interface GhlConfig {
  token: string;
  locationId: string;
  calendarId: string;
  assignedUserId: string;
  debug: {
    hasToken: boolean;
    hasLocationId: boolean;
    hasCalendarId: boolean;
    hasAssignedUserId: boolean;
    tokenFingerprint: string | null;
    locationId: string;
    calendarId: string;
    assignedUserId: string;
  };
}

function getGhlConfig(): GhlConfig {
  const token = (Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN") ?? "").trim();
  const locationId = (Deno.env.get("GHL_LOCATION_ID") ?? "").trim();
  const calendarId = (Deno.env.get("GHL_CALENDAR_ID") ?? "").trim();
  const assignedUserId = (Deno.env.get("GHL_ASSIGNED_USER_ID") ?? "").trim();
  
  // Token fingerprint (primeros 8 + últimos 4 chars)
  const tokenFingerprint = token.length > 12 
    ? token.slice(0, 8) + "..." + token.slice(-4)
    : null;
  
  return {
    token,
    locationId,
    calendarId,
    assignedUserId,
    debug: {
      hasToken: token.length > 0,
      hasLocationId: locationId.length > 0,
      hasCalendarId: calendarId.length > 0,
      hasAssignedUserId: assignedUserId.length > 0,
      tokenFingerprint,
      locationId,  // Safe to expose (not a secret)
      calendarId,  // Safe to expose
      assignedUserId,  // Safe to expose
    }
  };
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit,
  timeoutMs: number = 8000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('GHL request timeout');
    }
    throw error;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Security check (optional)
  const expectedSecret = Deno.env.get("BOOKING_SYNC_WEBHOOK_SECRET");
  if (expectedSecret) {
    const providedSecret = req.headers.get("x-sync-secret");
    if (!providedSecret || providedSecret !== expectedSecret) {
      console.log("[AUTH] Invalid or missing sync secret");
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "auth_failed",
          message: "Invalid or missing x-sync-secret header"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // Debug env mode
  const url = new URL(req.url);
  const debugEnv = url.searchParams.get('debug_env') === '1' || req.headers.get('x-debug-env') === 'true';
  
  if (debugEnv) {
    const cfg = getGhlConfig();
    return new Response(
      JSON.stringify({
        ok: false,
        error: "debug_env",
        message: "Environment diagnostics",
        cfg: cfg.debug
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  try {
    const rawBody = await req.json().catch(() => ({}));
    const booking_id = extractBookingId(rawBody);
    const skip_if_unchanged = rawBody.skip_if_unchanged ?? true;

    if (!booking_id) {
      const receivedKeys = Object.keys(rawBody);
      return new Response(
        JSON.stringify({ 
          ok: false, 
          error: "booking_id_missing",
          receivedKeys,
          expected: "{ booking_id } or { record: { id } } or { new: { id } }"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get environment variables
    const cfg = getGhlConfig();
    const ghlToken = cfg.token;
    const locationId = cfg.locationId;
    const calendarId = cfg.calendarId;
    const assignedUserId = cfg.assignedUserId;
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Log config status (without exposing full token)
    console.log(`[CONFIG] hasToken=${cfg.debug.hasToken} tokenFP=${cfg.debug.tokenFingerprint} hasLocation=${cfg.debug.hasLocationId} location=${cfg.debug.locationId}`);

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

    // Get staff info and GHL user IDs for calendar sync
    const staffResult = await getStaffForCalendarSync(booking_id, locationId, ghlToken, supabase);
    console.log(`Staff sync result: ${staffResult.ghlUserIds.length} GHL users, ${staffResult.staffInfo.length} staff total`);

    // Check if update is needed (optimization) - but force update if staff changed
    if (skip_if_unchanged && bookingData.ghl_appointment_id && times) {
      const existingStart = bookingData.ghl_appointment_start_at;
      const existingEnd = bookingData.ghl_appointment_end_at;
      
      // Compare with timezone-aware times - always update if there's staff to show
      if (existingStart === times.startTime && existingEnd === times.endTime && !isCancelled && staffResult.staffInfo.length === 0) {
        console.log("Appointment times unchanged and no staff, skipping update");
        return new Response(
          JSON.stringify({ ok: true, skipped: true, reason: "Times unchanged" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Ensure we have a contact (create if needed)
    const contactId = await ensureContact(bookingData, locationId, ghlToken, supabase, cfg.debug.tokenFingerprint);

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
        staffResult,
        cfg.debug.tokenFingerprint
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
        staffResult,
        cfg.debug.tokenFingerprint
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
        staffResult,
        cfg.debug.tokenFingerprint
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
        staff_user_ids: staffResult.ghlUserIds,
        staff_info: staffResult.staffInfo,
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
        staff_synced: staffResult.staffInfo.length,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    console.error("Sync failed:", errorMessage);
    
    // Check if it's a scope error
    if (errorMessage.includes('ghl_scope_')) {
      const which = errorMessage.includes('contacts') ? 'contacts.write' : 
                    errorMessage.includes('calendars') ? 'calendars.events.write' : 
                    'unknown';
      
      // Log scope error (booking_id not in scope in catch block)
      console.error("GHL scope error detected:", which, "error:", errorMessage);
      
      return new Response(
        JSON.stringify({
          ok: false,
          error: "ghl_scope_error",
          message: "Token lacks required scope",
          details: { which }
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    // Check if it's a timeout
    if (errorMessage.includes('timeout')) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "ghl_timeout",
          message: "GHL API request timed out"
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ ok: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Export for testing
export { getAppointment, deleteAppointment, calculateTimes };
