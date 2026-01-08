import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-voice-agent-secret',
};

// GHL API configuration
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_CALENDAR_ID = 'tCUlP3Dalpf0fnhAPG52';
const DEFAULT_TIMEZONE = 'America/New_York';

interface RequestBody {
  booking_type: 'hourly' | 'daily';
  date: string; // YYYY-MM-DD
  start_time?: string; // HH:MM
  end_time?: string; // HH:MM
  timezone?: string;
}

interface BlockedSlotEvent {
  id?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
}

interface CheckResponse {
  occupied: boolean;
  checked_range: {
    start: string;
    end: string;
    timezone: string;
  };
  conflicts_count: number;
  conflicts_preview: Array<{
    title: string | null;
    start: string | null;
    end: string | null;
  }>;
}

// Convert date + time to epoch milliseconds in Eastern timezone
function toEpochMillis(dateStr: string, timeStr: string, timezone: string): number {
  // Create ISO string with timezone offset
  // Eastern is typically -05:00 (EST) or -04:00 (EDT)
  // We'll use a simple approach: parse as local date and adjust
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  // Create date in UTC, then we'll use the timezone for the API
  // GHL expects epoch millis, so we construct the date assuming Eastern time
  // EST = UTC-5, EDT = UTC-4. For simplicity, we'll calculate based on the date
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  
  // Adjust for Eastern Time (approximate: -5 hours for EST)
  // This is a simplification; for production, use a proper timezone library
  const easternOffset = 5 * 60 * 60 * 1000; // 5 hours in ms
  return date.getTime() + easternOffset;
}

// Get daily range (00:00:00 to 23:59:59.999)
function getDailyRange(dateStr: string, timezone: string): { startMs: number; endMs: number } {
  const startMs = toEpochMillis(dateStr, '00:00', timezone);
  const endMs = toEpochMillis(dateStr, '23:59', timezone) + (59 * 1000) + 999; // Add 59s 999ms
  return { startMs, endMs };
}

// Get hourly range
function getHourlyRange(dateStr: string, startTime: string, endTime: string, timezone: string): { startMs: number; endMs: number } | null {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  if (endMinutes <= startMinutes) {
    return null; // Invalid range
  }
  
  return {
    startMs: toEpochMillis(dateStr, startTime, timezone),
    endMs: toEpochMillis(dateStr, endTime, timezone),
  };
}

// Query GHL blocked-slots API
async function getBlockedSlots(
  locationId: string,
  startMs: number,
  endMs: number,
  ghlToken: string
): Promise<{ events: BlockedSlotEvent[]; error?: string }> {
  const url = new URL(`${GHL_API_BASE}/calendars/blocked-slots`);
  url.searchParams.set('locationId', locationId);
  url.searchParams.set('calendarId', GHL_CALENDAR_ID);
  url.searchParams.set('startTime', String(startMs));
  url.searchParams.set('endTime', String(endMs));
  
  console.log(`[GHL] Fetching blocked-slots: ${url.toString()}`);
  
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${ghlToken}`,
        'Version': '2021-04-15',
        'Content-Type': 'application/json',
      },
    });
    
    const responseText = await response.text();
    console.log(`[GHL] Response status: ${response.status}`);
    console.log(`[GHL] Response body: ${responseText}`);
    
    if (!response.ok) {
      return { events: [], error: `GHL API error: ${response.status} - ${responseText}` };
    }
    
    const data = JSON.parse(responseText);
    
    // GHL returns { events: [...] } for blocked-slots
    const events = data.events || data.blockedSlots || [];
    return { events: Array.isArray(events) ? events : [] };
  } catch (error) {
    console.error('[GHL] Fetch error:', error);
    return { events: [], error: String(error) };
  }
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  
  // Only POST allowed
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Validate voice agent secret
  const voiceSecret = req.headers.get('x-voice-agent-secret');
  const expectedSecret = Deno.env.get('VOICE_AGENT_WEBHOOK_SECRET');
  
  if (!voiceSecret || voiceSecret !== expectedSecret) {
    console.log('[AUTH] Invalid or missing x-voice-agent-secret');
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Get required env vars
  const ghlToken = Deno.env.get('GHL_PRIVATE_INTEGRATION_TOKEN');
  const locationId = Deno.env.get('GHL_LOCATION_ID');
  
  if (!ghlToken || !locationId) {
    console.error('[CONFIG] Missing GHL_PRIVATE_INTEGRATION_TOKEN or GHL_LOCATION_ID');
    return new Response(
      JSON.stringify({ error: 'Server configuration error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Parse request body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Validate required fields
  if (!body.booking_type || !body.date) {
    return new Response(
      JSON.stringify({ error: 'Missing required fields: booking_type, date' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  if (!['hourly', 'daily'].includes(body.booking_type)) {
    return new Response(
      JSON.stringify({ error: 'booking_type must be "hourly" or "daily"' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Validate date format
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    return new Response(
      JSON.stringify({ error: 'date must be in YYYY-MM-DD format' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  const timezone = body.timezone || DEFAULT_TIMEZONE;
  
  // Calculate time range
  let startMs: number;
  let endMs: number;
  let rangeStartISO: string;
  let rangeEndISO: string;
  
  if (body.booking_type === 'daily') {
    const range = getDailyRange(body.date, timezone);
    startMs = range.startMs;
    endMs = range.endMs;
    rangeStartISO = `${body.date}T00:00:00`;
    rangeEndISO = `${body.date}T23:59:59`;
  } else {
    // Hourly: require start_time and end_time
    if (!body.start_time || !body.end_time) {
      return new Response(
        JSON.stringify({ error: 'Hourly booking requires start_time and end_time' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    // Validate time format
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(body.start_time) || !timeRegex.test(body.end_time)) {
      return new Response(
        JSON.stringify({ error: 'start_time and end_time must be in HH:MM format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    const range = getHourlyRange(body.date, body.start_time, body.end_time, timezone);
    if (!range) {
      return new Response(
        JSON.stringify({ error: 'end_time must be after start_time' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    startMs = range.startMs;
    endMs = range.endMs;
    rangeStartISO = `${body.date}T${body.start_time}:00`;
    rangeEndISO = `${body.date}T${body.end_time}:00`;
  }
  
  console.log(`[CHECK] Checking ${body.booking_type} availability for ${body.date}, range: ${startMs} - ${endMs}`);
  
  // Query GHL for blocked slots
  const { events, error } = await getBlockedSlots(locationId, startMs, endMs, ghlToken);
  
  if (error) {
    console.error('[GHL] API error:', error);
    // Return a response indicating we couldn't check, but don't fail completely
    return new Response(
      JSON.stringify({
        error: 'Could not verify availability with calendar',
        details: error,
      }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Build response
  const occupied = events.length > 0;
  const conflictsPreview = events.slice(0, 3).map((event) => ({
    title: event.title || null,
    start: event.startTime || null,
    end: event.endTime || null,
  }));
  
  const response: CheckResponse = {
    occupied,
    checked_range: {
      start: rangeStartISO,
      end: rangeEndISO,
      timezone,
    },
    conflicts_count: events.length,
    conflicts_preview: conflictsPreview,
  };
  
  console.log(`[CHECK] Result: occupied=${occupied}, conflicts=${events.length}`);
  
  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
