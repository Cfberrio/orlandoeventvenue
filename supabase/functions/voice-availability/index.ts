import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const TIMEZONE = 'America/New_York';

interface AvailabilityRequest {
  date: string; // YYYY-MM-DD
  start_time?: string; // HH:MM (optional)
  duration_hours?: number; // default 4
  booking_type?: 'hourly' | 'daily'; // optional
}

interface FreeSlot {
  start: string;
  end: string;
}

interface AvailabilityResponse {
  ok: boolean;
  available: boolean;
  checked_window: {
    start: string;
    end: string;
    tz: string;
  };
  next_slots: FreeSlot[];
  notes_for_agent: string;
  error?: string;
}

/**
 * Convert a date string and time to Eastern Time ISO format
 */
function toEasternISO(dateStr: string, timeStr: string): string {
  // Parse the date and time
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  
  // Create a date in UTC that represents this Eastern time
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, 0));
  
  // Check if DST is active for this date in America/New_York
  const jan = new Date(year, 0, 1);
  const jul = new Date(year, 6, 1);
  const janOffset = jan.getTimezoneOffset();
  const julOffset = jul.getTimezoneOffset();
  const stdOffset = Math.max(janOffset, julOffset);
  
  // Create a temp date to check DST
  const tempDate = new Date(year, month - 1, day, hour, minute);
  const isDST = tempDate.getTimezoneOffset() < stdOffset;
  
  // Eastern is UTC-5 (EST) or UTC-4 (EDT)
  const offset = isDST ? 4 : 5;
  
  // Adjust for Eastern timezone
  date.setUTCHours(date.getUTCHours() + offset);
  
  return date.toISOString();
}

/**
 * Get free slots from GHL Calendar API
 * GHL expects startDate and endDate as epoch milliseconds
 */
async function getGHLFreeSlots(
  calendarId: string,
  startDate: string,
  endDate: string,
  ghlToken: string
): Promise<{ slots: FreeSlot[]; error?: string }> {
  // Convert date strings to epoch milliseconds
  const startMs = new Date(startDate + 'T00:00:00-05:00').getTime();
  const endMs = new Date(endDate + 'T23:59:59-05:00').getTime();
  
  const url = new URL(`${GHL_API_BASE}/calendars/${calendarId}/free-slots`);
  url.searchParams.set('startDate', String(startMs));
  url.searchParams.set('endDate', String(endMs));
  url.searchParams.set('timezone', TIMEZONE);
  
  console.log(`[GHL] Fetching free slots: ${url.toString()}`);
  
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghlToken}`,
        'Version': GHL_API_VERSION,
        'Content-Type': 'application/json',
      },
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[GHL] Free slots error: ${response.status} - ${errorText}`);
      return { slots: [], error: `GHL API error: ${response.status}` };
    }
    
    const data = await response.json();
    console.log(`[GHL] Free slots response:`, JSON.stringify(data));
    
    // GHL returns slots in format: { [date]: { slots: [{slot: "HH:MM"}] } }
    const slots: FreeSlot[] = [];
    
    if (data && typeof data === 'object') {
      for (const dateKey of Object.keys(data)) {
        if (dateKey.match(/^\d{4}-\d{2}-\d{2}$/)) {
          const dayData = data[dateKey];
          if (dayData?.slots && Array.isArray(dayData.slots)) {
            for (const slotInfo of dayData.slots) {
              if (slotInfo.slot) {
                // Each slot is typically 30 min or 1 hour
                const startTime = slotInfo.slot;
                const startISO = toEasternISO(dateKey, startTime);
                
                // Calculate end time (assume 1 hour slots)
                const [h, m] = startTime.split(':').map(Number);
                const endHour = h + 1;
                const endTime = `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
                const endISO = toEasternISO(dateKey, endTime);
                
                slots.push({ start: startISO, end: endISO });
              }
            }
          }
        }
      }
    }
    
    return { slots };
  } catch (error) {
    console.error(`[GHL] Free slots exception:`, error);
    return { slots: [], error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Check if requested time window has available slots
 */
function checkWindowAvailability(
  slots: FreeSlot[],
  windowStart: Date,
  windowEnd: Date,
  durationHours: number
): { available: boolean; coveringSlots: FreeSlot[] } {
  // Find slots that overlap with our window
  const overlappingSlots = slots.filter(slot => {
    const slotStart = new Date(slot.start);
    const slotEnd = new Date(slot.end);
    return slotStart < windowEnd && slotEnd > windowStart;
  });
  
  if (overlappingSlots.length === 0) {
    return { available: false, coveringSlots: [] };
  }
  
  // For a window to be "available", we need consecutive slots covering the duration
  // This is a simplified check - we'll say it's available if there are enough slots
  const windowDurationMs = windowEnd.getTime() - windowStart.getTime();
  const requiredDurationMs = durationHours * 60 * 60 * 1000;
  
  // Calculate total available time in overlapping slots
  let totalAvailableMs = 0;
  for (const slot of overlappingSlots) {
    const slotStart = new Date(slot.start);
    const slotEnd = new Date(slot.end);
    const effectiveStart = slotStart > windowStart ? slotStart : windowStart;
    const effectiveEnd = slotEnd < windowEnd ? slotEnd : windowEnd;
    totalAvailableMs += effectiveEnd.getTime() - effectiveStart.getTime();
  }
  
  const available = totalAvailableMs >= requiredDurationMs * 0.9; // 90% coverage
  
  return { available, coveringSlots: overlappingSlots };
}

/**
 * Generate notes for the voice agent
 */
function generateAgentNotes(available: boolean, nextSlots: FreeSlot[], requestedDate: string): string {
  if (available) {
    return `Según el calendario, esa fecha parece disponible. Para confirmar definitivamente, el cliente debe completar la reserva en nuestro sitio web.`;
  } else if (nextSlots.length > 0) {
    const firstSlot = new Date(nextSlots[0].start);
    const options: Intl.DateTimeFormatOptions = { 
      weekday: 'long', 
      month: 'long', 
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: TIMEZONE
    };
    const formatted = firstSlot.toLocaleDateString('es-US', options);
    return `Esa fecha no está disponible según el calendario. La próxima disponibilidad es ${formatted}. Para reservar, el cliente debe usar el enlace de booking.`;
  } else {
    return `No encontré disponibilidad cercana en el calendario. El cliente debe contactarnos directamente o revisar el sitio web para fechas alternativas.`;
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    // Validate authorization
    const authHeader = req.headers.get('Authorization');
    const expectedSecret = Deno.env.get('VOICE_AGENT_WEBHOOK_SECRET');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[Auth] Missing or invalid Authorization header');
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    const providedToken = authHeader.replace('Bearer ', '');
    if (providedToken !== expectedSecret) {
      console.error('[Auth] Token mismatch');
      return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Parse request body
    const body: AvailabilityRequest = await req.json();
    console.log('[Request] Body:', JSON.stringify(body));

    // Validate required fields
    if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Invalid date format. Use YYYY-MM-DD' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get environment variables
    const ghlToken = Deno.env.get('GHL_PRIVATE_INTEGRATION_TOKEN');
    const calendarId = Deno.env.get('GHL_CALENDAR_ID');
    
    if (!ghlToken || !calendarId) {
      console.error('[Config] Missing GHL_PRIVATE_INTEGRATION_TOKEN or GHL_CALENDAR_ID');
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Server configuration error' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Set defaults
    const durationHours = body.duration_hours || 4;
    const bookingType = body.booking_type || 'hourly';
    const startTime = body.start_time || (bookingType === 'daily' ? '09:00' : '10:00');
    
    // Calculate window
    let windowStart: Date;
    let windowEnd: Date;
    
    if (bookingType === 'daily') {
      // Full day: 9 AM to 11 PM
      windowStart = new Date(toEasternISO(body.date, '09:00'));
      windowEnd = new Date(toEasternISO(body.date, '23:00'));
    } else {
      // Hourly: start_time to start_time + duration
      windowStart = new Date(toEasternISO(body.date, startTime));
      const [h, m] = startTime.split(':').map(Number);
      const endHour = h + durationHours;
      const endTime = `${String(Math.min(endHour, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      windowEnd = new Date(toEasternISO(body.date, endTime));
    }

    console.log(`[Window] ${windowStart.toISOString()} to ${windowEnd.toISOString()}`);

    // Fetch free slots for the requested date and a few days after
    const endSearchDate = new Date(body.date);
    endSearchDate.setDate(endSearchDate.getDate() + 14); // Look 2 weeks ahead
    const endSearchStr = endSearchDate.toISOString().split('T')[0];
    
    const { slots, error: slotsError } = await getGHLFreeSlots(
      calendarId,
      body.date,
      endSearchStr,
      ghlToken
    );

    if (slotsError) {
      console.error('[Slots] Error fetching slots:', slotsError);
      return new Response(JSON.stringify({ 
        ok: false, 
        error: 'Failed to check availability' 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Slots] Found ${slots.length} total slots`);

    // Check availability for requested window
    const { available, coveringSlots } = checkWindowAvailability(
      slots,
      windowStart,
      windowEnd,
      durationHours
    );

    // Get next available slots (up to 5)
    const futureSlots = slots
      .filter(s => new Date(s.start) >= windowStart)
      .slice(0, 5);

    // Build response
    const response: AvailabilityResponse = {
      ok: true,
      available,
      checked_window: {
        start: windowStart.toISOString(),
        end: windowEnd.toISOString(),
        tz: TIMEZONE,
      },
      next_slots: futureSlots,
      notes_for_agent: generateAgentNotes(available, futureSlots, body.date),
    };

    console.log('[Response]', JSON.stringify(response));

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Error]', error);
    return new Response(JSON.stringify({ 
      ok: false, 
      error: error instanceof Error ? error.message : 'Internal server error' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
