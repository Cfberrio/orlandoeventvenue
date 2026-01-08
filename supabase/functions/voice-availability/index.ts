import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIMEZONE = 'America/New_York';

// Venue operating hours (9 AM - 11 PM Eastern)
const VENUE_OPEN_HOUR = 9;
const VENUE_CLOSE_HOUR = 23;

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

interface BookingConflict {
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  booking_type: string;
}

/**
 * Convert a date string and time to Eastern Time ISO format
 */
function toEasternISO(dateStr: string, timeStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = timeStr.split(':').map(Number);
  
  // Determine if DST is active
  const testDate = new Date(year, month - 1, day);
  const jan = new Date(year, 0, 1);
  const jul = new Date(year, 6, 1);
  const stdOffset = Math.max(jan.getTimezoneOffset(), jul.getTimezoneOffset());
  const isDST = testDate.getTimezoneOffset() < stdOffset;
  
  // Eastern is UTC-5 (EST) or UTC-4 (EDT)
  const offsetHours = isDST ? 4 : 5;
  const offsetStr = isDST ? '-04:00' : '-05:00';
  
  return `${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${offsetStr}`;
}

/**
 * Check bookings in our database for the given date range
 */
async function getBookingsForDateRange(
  supabase: any,
  startDate: string,
  endDate: string
): Promise<BookingConflict[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('event_date, start_time, end_time, booking_type')
    .gte('event_date', startDate)
    .lte('event_date', endDate)
    .not('status', 'eq', 'cancelled')
    .not('status', 'eq', 'declined');

  if (error) {
    console.error('[DB] Error fetching bookings:', error);
    return [];
  }

  console.log(`[DB] Found ${data?.length || 0} bookings in range`);
  return data || [];
}

/**
 * Check availability blocks in our database
 */
async function getBlocksForDateRange(
  supabase: any,
  startDate: string,
  endDate: string
): Promise<{ start_date: string; end_date: string; block_type: string }[]> {
  const { data, error } = await supabase
    .from('availability_blocks')
    .select('start_date, end_date, block_type')
    .lte('start_date', endDate)
    .gte('end_date', startDate);

  if (error) {
    console.error('[DB] Error fetching blocks:', error);
    return [];
  }

  console.log(`[DB] Found ${data?.length || 0} availability blocks in range`);
  return data || [];
}

/**
 * Check if a specific time window is available
 */
function isWindowAvailable(
  requestedDate: string,
  requestedStart: string,
  requestedEnd: string,
  bookings: BookingConflict[],
  blocks: { start_date: string; end_date: string; block_type: string }[]
): boolean {
  // Check availability blocks first
  for (const block of blocks) {
    if (requestedDate >= block.start_date && requestedDate <= block.end_date) {
      console.log(`[Check] Date ${requestedDate} blocked by availability block`);
      return false;
    }
  }

  // Check bookings
  for (const booking of bookings) {
    if (booking.event_date === requestedDate) {
      // Daily booking blocks the entire day
      if (booking.booking_type === 'daily') {
        console.log(`[Check] Date ${requestedDate} has daily booking`);
        return false;
      }

      // Hourly booking - check time overlap
      if (booking.start_time && booking.end_time) {
        const bookingStart = booking.start_time.substring(0, 5);
        const bookingEnd = booking.end_time.substring(0, 5);
        
        // Check if times overlap
        if (requestedStart < bookingEnd && requestedEnd > bookingStart) {
          console.log(`[Check] Time overlap: requested ${requestedStart}-${requestedEnd} conflicts with ${bookingStart}-${bookingEnd}`);
          return false;
        }
      }
    }
  }

  return true;
}

/**
 * Find next available slots
 */
function findNextAvailableSlots(
  startDate: string,
  bookings: BookingConflict[],
  blocks: { start_date: string; end_date: string; block_type: string }[],
  durationHours: number,
  maxSlots: number = 5
): FreeSlot[] {
  const slots: FreeSlot[] = [];
  const today = new Date(startDate);
  
  // Look up to 30 days ahead
  for (let dayOffset = 0; dayOffset < 30 && slots.length < maxSlots; dayOffset++) {
    const checkDate = new Date(today);
    checkDate.setDate(today.getDate() + dayOffset);
    const dateStr = checkDate.toISOString().split('T')[0];
    
    // Try different start times (9 AM to 7 PM for a 4-hour window)
    for (let hour = VENUE_OPEN_HOUR; hour <= VENUE_CLOSE_HOUR - durationHours && slots.length < maxSlots; hour++) {
      const startTime = `${String(hour).padStart(2, '0')}:00`;
      const endHour = hour + durationHours;
      const endTime = `${String(endHour).padStart(2, '0')}:00`;
      
      if (isWindowAvailable(dateStr, startTime, endTime, bookings, blocks)) {
        slots.push({
          start: toEasternISO(dateStr, startTime),
          end: toEasternISO(dateStr, endTime),
        });
        // Only add one slot per day to provide variety
        break;
      }
    }
  }
  
  return slots;
}

/**
 * Generate notes for the voice agent
 */
function generateAgentNotes(available: boolean, nextSlots: FreeSlot[], requestedDate: string): string {
  if (available) {
    return `Según el calendario, esa fecha y hora parece disponible. Para confirmar definitivamente, el cliente debe completar la reserva en nuestro sitio web orlando-event-venue.lovable.app/book.`;
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
    return `Esa fecha u hora no está disponible según el calendario. La próxima disponibilidad es ${formatted}. Para reservar, el cliente debe usar el sitio web orlando-event-venue.lovable.app/book.`;
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

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Set defaults
    const durationHours = body.duration_hours || 4;
    const bookingType = body.booking_type || 'hourly';
    const startTime = body.start_time || (bookingType === 'daily' ? '09:00' : '10:00');
    
    // Calculate window
    let windowStart: string;
    let windowEnd: string;
    let requestedStartTime: string;
    let requestedEndTime: string;
    
    if (bookingType === 'daily') {
      windowStart = toEasternISO(body.date, '09:00');
      windowEnd = toEasternISO(body.date, '23:00');
      requestedStartTime = '09:00';
      requestedEndTime = '23:00';
    } else {
      windowStart = toEasternISO(body.date, startTime);
      const [h, m] = startTime.split(':').map(Number);
      const endHour = Math.min(h + durationHours, VENUE_CLOSE_HOUR);
      const endTimeStr = `${String(endHour).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      windowEnd = toEasternISO(body.date, endTimeStr);
      requestedStartTime = startTime;
      requestedEndTime = endTimeStr;
    }

    console.log(`[Window] ${windowStart} to ${windowEnd}`);

    // Get date range for search (requested date + 30 days for next slots)
    const endSearchDate = new Date(body.date);
    endSearchDate.setDate(endSearchDate.getDate() + 30);
    const endSearchStr = endSearchDate.toISOString().split('T')[0];

    // Fetch bookings and blocks from database
    const [bookings, blocks] = await Promise.all([
      getBookingsForDateRange(supabase, body.date, endSearchStr),
      getBlocksForDateRange(supabase, body.date, endSearchStr),
    ]);

    // Check if requested window is available
    const available = isWindowAvailable(
      body.date,
      requestedStartTime,
      requestedEndTime,
      bookings,
      blocks
    );

    console.log(`[Check] Window available: ${available}`);

    // Find next available slots
    const nextSlots = findNextAvailableSlots(
      body.date,
      bookings,
      blocks,
      durationHours,
      5
    );

    console.log(`[Slots] Found ${nextSlots.length} next available slots`);

    // Build response
    const response: AvailabilityResponse = {
      ok: true,
      available,
      checked_window: {
        start: windowStart,
        end: windowEnd,
        tz: TIMEZONE,
      },
      next_slots: nextSlots,
      notes_for_agent: generateAgentNotes(available, nextSlots, body.date),
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
