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
  booking_type?: string;
  date?: string;
  start_time?: string;
  end_time?: string;
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

// Normalize time string to 24h format "HH:MM"
// Accepts: "18:00", "6:00 PM", "6 PM", "06:00 pm", etc.
function normalizeTime(timeStr: string): string | null {
  if (!timeStr) return null;
  
  const input = timeStr.trim().toUpperCase();
  
  // Try 24h format first: "18:00" or "9:00"
  const match24h = input.match(/^(\d{1,2}):(\d{2})$/);
  if (match24h) {
    const h = parseInt(match24h[1], 10);
    const m = parseInt(match24h[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
    }
    return null;
  }
  
  // Try AM/PM with minutes: "6:00 PM", "06:30 AM"
  const matchAmPm = input.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (matchAmPm) {
    let h = parseInt(matchAmPm[1], 10);
    const m = parseInt(matchAmPm[2], 10);
    const period = matchAmPm[3];
    
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
  
  // Try AM/PM without minutes: "6 PM", "12 AM"
  const matchAmPmShort = input.match(/^(\d{1,2})\s*(AM|PM)$/);
  if (matchAmPmShort) {
    let h = parseInt(matchAmPmShort[1], 10);
    const period = matchAmPmShort[2];
    
    if (h < 1 || h > 12) return null;
    
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    
    return `${h.toString().padStart(2, '0')}:00`;
  }
  
  return null;
}

// Convert date + time to epoch milliseconds in Eastern timezone
function toEpochMillis(dateStr: string, timeStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  
  // Create date in UTC, then adjust for Eastern
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  
  // Eastern Time offset (EST = UTC-5, EDT = UTC-4)
  // For simplicity, assume EST (-5h)
  const easternOffset = 5 * 60 * 60 * 1000;
  return date.getTime() + easternOffset;
}

// Get daily range (00:00:00 to 23:59:59.999)
function getDailyRange(dateStr: string): { startMs: number; endMs: number } {
  const startMs = toEpochMillis(dateStr, '00:00');
  const endMs = toEpochMillis(dateStr, '23:59') + (59 * 1000) + 999;
  return { startMs, endMs };
}

// Get hourly range
function getHourlyRange(dateStr: string, startTime: string, endTime: string): { startMs: number; endMs: number } | null {
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);
  
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;
  
  if (endMinutes <= startMinutes) {
    return null; // Invalid range
  }
  
  return {
    startMs: toEpochMillis(dateStr, startTime),
    endMs: toEpochMillis(dateStr, endTime),
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
    const events = data.events || data.blockedSlots || [];
    return { events: Array.isArray(events) ? events : [] };
  } catch (error) {
    console.error('[GHL] Fetch error:', error);
    return { events: [], error: String(error) };
  }
}

// Log body safely (redact secrets)
function logBody(body: Record<string, unknown>): void {
  const safe = { ...body };
  // Redact any field that might contain a secret
  for (const key of Object.keys(safe)) {
    if (/secret|token|key|password/i.test(key)) {
      safe[key] = '[REDACTED]';
    }
  }
  console.log('[BODY] Received:', JSON.stringify(safe));
}

// Build 422 error response
function validation422(missingFields: string[], receivedKeys: string[]): Response {
  return new Response(
    JSON.stringify({
      error: 'invalid_payload',
      missing_fields: missingFields,
      received_keys: receivedKeys,
      examples: {
        daily: {
          booking_type: 'daily',
          date: '2025-02-15',
          timezone: 'America/New_York',
        },
        hourly: {
          booking_type: 'hourly',
          date: '2025-02-15',
          start_time: '18:00',
          end_time: '22:00',
          timezone: 'America/New_York',
        },
        hourly_ampm: {
          booking_type: 'hourly',
          date: '2025-02-15',
          start_time: '6:00 PM',
          end_time: '10:00 PM',
          timezone: 'America/New_York',
        },
      },
    }),
    { status: 422, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
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
  let rawBody: Record<string, unknown>;
  try {
    rawBody = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
  
  // Log received body
  logBody(rawBody);
  
  const body: RequestBody = {
    booking_type: typeof rawBody.booking_type === 'string' ? rawBody.booking_type.trim().toLowerCase() : undefined,
    date: typeof rawBody.date === 'string' ? rawBody.date.trim() : undefined,
    start_time: typeof rawBody.start_time === 'string' ? rawBody.start_time.trim() : undefined,
    end_time: typeof rawBody.end_time === 'string' ? rawBody.end_time.trim() : undefined,
    timezone: typeof rawBody.timezone === 'string' ? rawBody.timezone.trim() : undefined,
  };
  
  const receivedKeys = Object.keys(rawBody);
  
  // Validate booking_type
  const missingFields: string[] = [];
  
  if (!body.booking_type || !['hourly', 'daily'].includes(body.booking_type)) {
    missingFields.push('booking_type (must be "hourly" or "daily")');
  }
  
  // Validate date
  if (!body.date || !/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    missingFields.push('date (YYYY-MM-DD format)');
  }
  
  // For hourly, validate times
  const isHourly = body.booking_type === 'hourly';
  let normalizedStart: string | null = null;
  let normalizedEnd: string | null = null;
  
  if (isHourly) {
    if (!body.start_time) {
      missingFields.push('start_time (required for hourly)');
    } else {
      normalizedStart = normalizeTime(body.start_time);
      if (!normalizedStart) {
        missingFields.push('start_time (invalid format, use "18:00" or "6:00 PM")');
      }
    }
    
    if (!body.end_time) {
      missingFields.push('end_time (required for hourly)');
    } else {
      normalizedEnd = normalizeTime(body.end_time);
      if (!normalizedEnd) {
        missingFields.push('end_time (invalid format, use "22:00" or "10:00 PM")');
      }
    }
  }
  
  // Return 422 if any validation failed
  if (missingFields.length > 0) {
    console.log('[VALIDATION] Failed:', missingFields);
    return validation422(missingFields, receivedKeys);
  }
  
  const timezone = body.timezone || DEFAULT_TIMEZONE;
  
  // Calculate time range
  let startMs: number;
  let endMs: number;
  let rangeStartISO: string;
  let rangeEndISO: string;
  
  if (body.booking_type === 'daily') {
    const range = getDailyRange(body.date!);
    startMs = range.startMs;
    endMs = range.endMs;
    rangeStartISO = `${body.date}T00:00:00`;
    rangeEndISO = `${body.date}T23:59:59`;
  } else {
    // Hourly
    const range = getHourlyRange(body.date!, normalizedStart!, normalizedEnd!);
    if (!range) {
      return new Response(
        JSON.stringify({ 
          error: 'invalid_time_range',
          message: 'end_time must be after start_time',
          received: { start_time: normalizedStart, end_time: normalizedEnd },
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    startMs = range.startMs;
    endMs = range.endMs;
    rangeStartISO = `${body.date}T${normalizedStart}:00`;
    rangeEndISO = `${body.date}T${normalizedEnd}:00`;
  }
  
  console.log(`[CHECK] Checking ${body.booking_type} availability for ${body.date}, range: ${startMs} - ${endMs}`);
  
  // Query GHL for blocked slots
  const { events, error } = await getBlockedSlots(locationId, startMs, endMs, ghlToken);
  
  if (error) {
    console.error('[GHL] API error:', error);
    return new Response(
      JSON.stringify({
        error: 'calendar_check_failed',
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
