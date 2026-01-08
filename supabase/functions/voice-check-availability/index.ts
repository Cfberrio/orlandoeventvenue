import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-voice-agent-secret, x-self-test',
};

// GHL API configuration
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_CALENDAR_ID = 'tCUlP3Dalpf0fnhAPG52';
const DEFAULT_TIMEZONE = 'America/New_York';

interface NormalizedPayload {
  booking_type: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
}

interface BlockedSlotEvent {
  id?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
}

// ============= KEY NORMALIZATION MAPS =============
const BOOKING_TYPE_KEYS = ['booking_type', 'bookingtype', 'booking type', 'type'];
const DATE_KEYS = ['date', 'event_date', 'eventdate', 'event date'];
const START_TIME_KEYS = ['start_time', 'starttime', 'start time', 'start'];
const END_TIME_KEYS = ['end_time', 'endtime', 'end time', 'end'];
const TIMEZONE_KEYS = ['timezone', 'tz', 'time_zone', 'timzone'];

// ============= UTILITY FUNCTIONS =============

// Unwrap value if it's an object like {value: X}, {text: X}, {label: X}
function unwrapValue(val: unknown): unknown {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const obj = val as Record<string, unknown>;
    if ('value' in obj) return obj.value;
    if ('text' in obj) return obj.text;
    if ('label' in obj) return obj.label;
  }
  return val;
}

// Find a value from an object using multiple possible keys (case-insensitive)
function findValue(obj: Record<string, unknown>, possibleKeys: string[]): string | null {
  if (!obj || typeof obj !== 'object') return null;
  
  const lowerKeys = possibleKeys.map(k => k.toLowerCase().replace(/[_\s]/g, ''));
  
  for (const [key, rawVal] of Object.entries(obj)) {
    const normalizedKey = key.toLowerCase().replace(/[_\s]/g, '');
    if (lowerKeys.includes(normalizedKey)) {
      const val = unwrapValue(rawVal);
      if (typeof val === 'string') return val.trim();
      if (typeof val === 'number') return String(val);
    }
  }
  return null;
}

// Search for values in root and nested containers
function findInAllContainers(rawBody: Record<string, unknown>, possibleKeys: string[]): string | null {
  // Try root first
  const rootVal = findValue(rawBody, possibleKeys);
  if (rootVal) return rootVal;
  
  // Try nested containers
  const containers = ['data', 'payload', 'params', 'parameters', 'inputs', 'body', 'fields'];
  for (const containerKey of containers) {
    const container = rawBody[containerKey];
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      const val = findValue(container as Record<string, unknown>, possibleKeys);
      if (val) return val;
    }
  }
  
  return null;
}

// Collect all keys from root and nested containers (for debugging)
function collectAllKeys(rawBody: Record<string, unknown>): string[] {
  const keys: string[] = [...Object.keys(rawBody)];
  
  const containers = ['data', 'payload', 'params', 'parameters', 'inputs', 'body', 'fields'];
  for (const containerKey of containers) {
    const container = rawBody[containerKey];
    if (container && typeof container === 'object' && !Array.isArray(container)) {
      for (const k of Object.keys(container as Record<string, unknown>)) {
        keys.push(`${containerKey}.${k}`);
      }
    }
  }
  
  return keys;
}

// Normalize time string to 24h format "HH:MM"
// Accepts: "18:00", "6:00 PM", "6 PM", "6PM", "06:00pm", etc.
function normalizeTime(timeStr: string): string | null {
  if (!timeStr) return null;
  
  // Clean up: trim, uppercase, remove extra spaces
  const input = timeStr.trim().toUpperCase().replace(/\s+/g, ' ');
  
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
  
  // Try AM/PM with minutes: "6:00 PM", "06:30AM", "6:00PM"
  const matchAmPm = input.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (matchAmPm) {
    let h = parseInt(matchAmPm[1], 10);
    const m = parseInt(matchAmPm[2], 10);
    const period = matchAmPm[3];
    
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    
    if (period === 'PM' && h !== 12) h += 12;
    if (period === 'AM' && h === 12) h = 0;
    
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
  
  // Try AM/PM without minutes: "6 PM", "6PM", "12AM"
  const matchAmPmShort = input.match(/^(\d{1,2})\s?(AM|PM)$/);
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
    console.log(`[GHL] Response body: ${responseText.substring(0, 500)}`);
    
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
function logBody(label: string, body: Record<string, unknown>): void {
  const safe = JSON.parse(JSON.stringify(body));
  const redactKeys = (obj: Record<string, unknown>) => {
    for (const key of Object.keys(obj)) {
      if (/secret|token|key|password|auth/i.test(key)) {
        obj[key] = '[REDACTED]';
      } else if (obj[key] && typeof obj[key] === 'object') {
        redactKeys(obj[key] as Record<string, unknown>);
      }
    }
  };
  redactKeys(safe);
  console.log(`[${label}]`, JSON.stringify(safe));
}

// Normalize payload from any GHL format
function normalizePayload(rawBody: Record<string, unknown>): NormalizedPayload {
  const bookingType = findInAllContainers(rawBody, BOOKING_TYPE_KEYS);
  const date = findInAllContainers(rawBody, DATE_KEYS);
  const startTime = findInAllContainers(rawBody, START_TIME_KEYS);
  const endTime = findInAllContainers(rawBody, END_TIME_KEYS);
  const timezone = findInAllContainers(rawBody, TIMEZONE_KEYS);
  
  return {
    booking_type: bookingType ? bookingType.toLowerCase() : null,
    date: date,
    start_time: startTime ? normalizeTime(startTime) : null,
    end_time: endTime ? normalizeTime(endTime) : null,
    timezone: timezone || DEFAULT_TIMEZONE,
  };
}

// Build 422 validation error response
function validation422(
  missingFields: string[], 
  receivedKeys: string[], 
  normalizedPayload: NormalizedPayload,
  rawStartTime?: string | null,
  rawEndTime?: string | null
): Response {
  return new Response(
    JSON.stringify({
      error: 'validation_failed',
      missing_fields: missingFields,
      received_keys: receivedKeys,
      normalized_payload: normalizedPayload,
      raw_times: { start_time: rawStartTime, end_time: rawEndTime },
      examples: {
        daily: {
          booking_type: 'daily',
          date: '2026-02-15',
          timezone: 'America/New_York',
        },
        hourly: {
          booking_type: 'hourly',
          date: '2026-02-15',
          start_time: '18:00',
          end_time: '22:00',
          timezone: 'America/New_York',
        },
        hourly_ampm: {
          booking_type: 'hourly',
          date: '2026-02-15',
          start_time: '6:00 PM',
          end_time: '10:00 PM',
          timezone: 'America/New_York',
        },
      },
    }),
    { status: 422, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
  );
}

// Self-test mode
function runSelfTests(): { passed: boolean; results: Array<{ test: string; passed: boolean; details: string }> } {
  const results: Array<{ test: string; passed: boolean; details: string }> = [];
  
  // Test 1: Daily payload normalization
  const dailyPayload = { Date: '2026-02-06', booking_type: 'daily', timezone: 'America/New_York' };
  const dailyNorm = normalizePayload(dailyPayload);
  const dailyPass = dailyNorm.booking_type === 'daily' && dailyNorm.date === '2026-02-06';
  results.push({
    test: 'daily_normalization',
    passed: dailyPass,
    details: JSON.stringify(dailyNorm),
  });
  
  // Test 2: Hourly payload normalization with AM/PM
  const hourlyPayload = { 
    booking_type: 'hourly', 
    Date: '2026-02-06', 
    start_time: '6:00 PM', 
    end_time: '10:00 PM',
    timezone: 'America/New_York'
  };
  const hourlyNorm = normalizePayload(hourlyPayload);
  const hourlyPass = hourlyNorm.booking_type === 'hourly' 
    && hourlyNorm.date === '2026-02-06'
    && hourlyNorm.start_time === '18:00'
    && hourlyNorm.end_time === '22:00';
  results.push({
    test: 'hourly_normalization_ampm',
    passed: hourlyPass,
    details: JSON.stringify(hourlyNorm),
  });
  
  // Test 3: Nested payload (data container)
  const nestedPayload = { 
    data: { 
      booking_type: 'hourly', 
      date: '2026-03-01', 
      start_time: { value: '2 PM' }, 
      end_time: { value: '6 PM' } 
    } 
  };
  const nestedNorm = normalizePayload(nestedPayload);
  const nestedPass = nestedNorm.booking_type === 'hourly' 
    && nestedNorm.date === '2026-03-01'
    && nestedNorm.start_time === '14:00'
    && nestedNorm.end_time === '18:00';
  results.push({
    test: 'nested_payload_with_wrapped_values',
    passed: nestedPass,
    details: JSON.stringify(nestedNorm),
  });
  
  // Test 4: Case-insensitive keys
  const casePayload = { BookingType: 'daily', DATE: '2026-04-01', Timezone: 'America/New_York' };
  const caseNorm = normalizePayload(casePayload);
  const casePass = caseNorm.booking_type === 'daily' && caseNorm.date === '2026-04-01';
  results.push({
    test: 'case_insensitive_keys',
    passed: casePass,
    details: JSON.stringify(caseNorm),
  });
  
  // Test 5: Time format variations
  const timeTests = [
    { input: '6:00 PM', expected: '18:00' },
    { input: '6PM', expected: '18:00' },
    { input: '6 PM', expected: '18:00' },
    { input: '18:00', expected: '18:00' },
    { input: '12:30 AM', expected: '00:30' },
    { input: '12 PM', expected: '12:00' },
  ];
  let timePass = true;
  const timeDetails: string[] = [];
  for (const t of timeTests) {
    const result = normalizeTime(t.input);
    if (result !== t.expected) {
      timePass = false;
      timeDetails.push(`FAIL: ${t.input} -> ${result} (expected ${t.expected})`);
    } else {
      timeDetails.push(`OK: ${t.input} -> ${result}`);
    }
  }
  results.push({
    test: 'time_format_variations',
    passed: timePass,
    details: timeDetails.join('; '),
  });
  
  const allPassed = results.every(r => r.passed);
  return { passed: allPassed, results };
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
  
  // Check for self-test mode
  const selfTest = req.headers.get('x-self-test');
  if (selfTest === 'true') {
    console.log('[SELF-TEST] Running internal tests...');
    const testResults = runSelfTests();
    return new Response(
      JSON.stringify({
        mode: 'self-test',
        overall: testResults.passed ? 'PASS' : 'FAIL',
        results: testResults.results,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
  logBody('RAW_BODY', rawBody);
  
  // Collect all received keys for debugging
  const receivedKeys = collectAllKeys(rawBody);
  console.log('[KEYS] Received:', receivedKeys.join(', '));
  
  // Normalize payload
  const normalized = normalizePayload(rawBody);
  console.log('[NORMALIZED]', JSON.stringify(normalized));
  
  // Get raw times for error reporting
  const rawStartTime = findInAllContainers(rawBody, START_TIME_KEYS);
  const rawEndTime = findInAllContainers(rawBody, END_TIME_KEYS);
  
  // Validate
  const missingFields: string[] = [];
  
  if (!normalized.booking_type || !['hourly', 'daily'].includes(normalized.booking_type)) {
    missingFields.push('booking_type (must be "hourly" or "daily")');
  }
  
  if (!normalized.date || !/^\d{4}-\d{2}-\d{2}$/.test(normalized.date)) {
    missingFields.push('date (YYYY-MM-DD format)');
  }
  
  const isHourly = normalized.booking_type === 'hourly';
  
  if (isHourly) {
    if (!rawStartTime) {
      missingFields.push('start_time (required for hourly)');
    } else if (!normalized.start_time) {
      missingFields.push(`start_time (could not parse "${rawStartTime}" - use "18:00" or "6:00 PM")`);
    }
    
    if (!rawEndTime) {
      missingFields.push('end_time (required for hourly)');
    } else if (!normalized.end_time) {
      missingFields.push(`end_time (could not parse "${rawEndTime}" - use "22:00" or "10:00 PM")`);
    }
  }
  
  if (missingFields.length > 0) {
    console.log('[VALIDATION] Failed:', missingFields);
    return validation422(missingFields, receivedKeys, normalized, rawStartTime, rawEndTime);
  }
  
  // Calculate time range
  let startMs: number;
  let endMs: number;
  let rangeStartISO: string;
  let rangeEndISO: string;
  
  if (normalized.booking_type === 'daily') {
    const range = getDailyRange(normalized.date!);
    startMs = range.startMs;
    endMs = range.endMs;
    rangeStartISO = `${normalized.date}T00:00:00`;
    rangeEndISO = `${normalized.date}T23:59:59`;
  } else {
    const range = getHourlyRange(normalized.date!, normalized.start_time!, normalized.end_time!);
    if (!range) {
      return new Response(
        JSON.stringify({ 
          error: 'invalid_time_range',
          message: 'end_time must be after start_time',
          normalized,
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    startMs = range.startMs;
    endMs = range.endMs;
    rangeStartISO = `${normalized.date}T${normalized.start_time}:00`;
    rangeEndISO = `${normalized.date}T${normalized.end_time}:00`;
  }
  
  console.log(`[CHECK] ${normalized.booking_type} for ${normalized.date}, range: ${startMs} - ${endMs}`);
  
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
  const available = !occupied;
  const conflictsPreview = events.slice(0, 3).map((event) => ({
    title: event.title || null,
    start: event.startTime || null,
    end: event.endTime || null,
  }));
  
  const reason = occupied 
    ? `Found ${events.length} conflict(s) in the requested time range`
    : 'No conflicts found - time slot is available';
  
  const response = {
    available,
    occupied,
    reason,
    checked_range: {
      start: rangeStartISO,
      end: rangeEndISO,
      timezone: normalized.timezone,
    },
    conflicts_count: events.length,
    conflicts_preview: conflictsPreview,
    normalized,
  };
  
  console.log(`[RESULT] available=${available}, conflicts=${events.length}`);
  
  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});
