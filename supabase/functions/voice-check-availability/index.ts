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

// ============= INPUT NORMALIZATION =============

// NOTE: GHL can send keys with different casing, spaces, camelCase, nesting, and wrapped values.
// This section is intentionally tolerant to maximize compatibility with Voice Agent "Custom Action Test".

type AnyRecord = Record<string, unknown>;

const FIELD_ALIASES = {
  booking_type: ["booking_type", "bookingType", "Booking Type", "type", "booking"],
  date: ["date", "Date", "event_date", "eventDate", "day"],
  start_time: ["start_time", "startTime", "Start Time", "from", "start"],
  end_time: ["end_time", "endTime", "End Time", "to", "end"],
  timezone: ["timezone", "Timezone", "tz"],
} as const;

type CanonicalField = keyof typeof FIELD_ALIASES;

function normalizeKey(key: string): string {
  // Lowercase and strip everything except [a-z0-9]
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const FIELD_ALIAS_SETS: Record<CanonicalField, Set<string>> = {
  booking_type: new Set(FIELD_ALIASES.booking_type.map(normalizeKey)),
  date: new Set(FIELD_ALIASES.date.map(normalizeKey)),
  start_time: new Set(FIELD_ALIASES.start_time.map(normalizeKey)),
  end_time: new Set(FIELD_ALIASES.end_time.map(normalizeKey)),
  timezone: new Set(FIELD_ALIASES.timezone.map(normalizeKey)),
};

function isPlainObject(val: unknown): val is AnyRecord {
  return !!val && typeof val === "object" && !Array.isArray(val);
}

// Unwrap value if it's an object like {value: X}, {text: X}, {label: X}, {name: X}
function unwrapValue(val: unknown, maxDepth = 3): unknown {
  let cur: unknown = val;
  for (let i = 0; i < maxDepth; i++) {
    if (!isPlainObject(cur)) return cur;
    const obj = cur as AnyRecord;
    if ("value" in obj) {
      cur = obj.value;
      continue;
    }
    if ("text" in obj) {
      cur = obj.text;
      continue;
    }
    if ("label" in obj) {
      cur = obj.label;
      continue;
    }
    if ("name" in obj) {
      cur = obj.name;
      continue;
    }
    return cur;
  }
  return cur;
}

function toStringOrNull(val: unknown): string | null {
  const unwrapped = unwrapValue(val);
  if (typeof unwrapped === "string") return unwrapped.trim();
  if (typeof unwrapped === "number") return String(unwrapped);
  if (typeof unwrapped === "boolean") return unwrapped ? "true" : "false";
  return null;
}

function parseBodyText(rawText: string): { body: AnyRecord; mode: "json" | "form" | "empty" | "unknown"; error?: string } {
  const text = (rawText ?? "").trim();
  if (!text) return { body: {}, mode: "empty" };

  // 1) Try JSON
  try {
    const parsed = JSON.parse(text);
    if (isPlainObject(parsed)) return { body: parsed, mode: "json" };
    // If JSON is not an object, still wrap it for debug purposes.
    return { body: { _value: parsed }, mode: "json" };
  } catch (e) {
    // fallthrough
    const jsonError = String(e);

    // 2) Try form-urlencoded
    try {
      const params = new URLSearchParams(text);
      const obj: AnyRecord = {};
      let any = false;
      for (const [k, v] of params.entries()) {
        any = true;
        // if key repeats, keep last (GHL usually doesn't repeat)
        obj[k] = v;
      }
      if (any) return { body: obj, mode: "form" };
    } catch {
      // ignore
    }

    return { body: { _raw: text }, mode: "unknown", error: jsonError };
  }
}

function collectAllKeysDeep(val: unknown, maxKeys = 300, maxDepth = 6): string[] {
  const keys: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, path: string, depth: number) => {
    if (keys.length >= maxKeys) return;
    if (depth > maxDepth) return;
    if (!node || typeof node !== "object") return;
    if (seen.has(node)) return;
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        walk(node[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    const obj = node as AnyRecord;
    for (const k of Object.keys(obj)) {
      const nextPath = path ? `${path}.${k}` : k;
      keys.push(nextPath);
      if (keys.length >= maxKeys) return;
      walk(obj[k], nextPath, depth + 1);
    }
  };

  walk(val, "", 0);
  return keys;
}

function collectAllStringsDeep(val: unknown, maxStrings = 200, maxDepth = 8): string[] {
  const strings: string[] = [];
  const seen = new Set<unknown>();

  const walk = (node: unknown, depth: number) => {
    if (strings.length >= maxStrings) return;
    if (depth > maxDepth) return;

    const unwrapped = unwrapValue(node);
    if (typeof unwrapped === "string") {
      const s = unwrapped.trim();
      if (s) strings.push(s);
      return;
    }

    if (!unwrapped || typeof unwrapped !== "object") return;
    if (seen.has(unwrapped)) return;
    seen.add(unwrapped);

    if (Array.isArray(unwrapped)) {
      for (const item of unwrapped) walk(item, depth + 1);
      return;
    }

    const obj = unwrapped as AnyRecord;
    for (const v of Object.values(obj)) walk(v, depth + 1);
  };

  walk(val, 0);
  return strings;
}

function findByAliasesDeep(root: unknown, aliases: Set<string>): { value: string | null; path: string | null } {
  const seen = new Set<unknown>();

  const walk = (node: unknown, path: string, depth: number): { value: string | null; path: string | null } => {
    if (depth > 10) return { value: null, path: null };
    if (!node || typeof node !== "object") return { value: null, path: null };
    if (seen.has(node)) return { value: null, path: null };
    seen.add(node);

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const r = walk(node[i], `${path}[${i}]`, depth + 1);
        if (r.value) return r;
      }
      return { value: null, path: null };
    }

    const obj = node as AnyRecord;

    // direct match on this object
    for (const [k, v] of Object.entries(obj)) {
      const nk = normalizeKey(k);
      if (aliases.has(nk)) {
        const sv = toStringOrNull(v);
        if (sv) return { value: sv, path: path ? `${path}.${k}` : k };
      }
    }

    // also search common containers first (helps with speed and determinism)
    const preferredContainers = ["body", "data", "payload", "params", "parameters", "inputs", "variables", "fields"];
    for (const c of preferredContainers) {
      const child = obj[c];
      if (child && typeof child === "object") {
        const r = walk(child, path ? `${path}.${c}` : c, depth + 1);
        if (r.value) return r;
      }
    }

    // generic deep search
    for (const [k, v] of Object.entries(obj)) {
      if (!v || typeof v !== "object") continue;
      const r = walk(v, path ? `${path}.${k}` : k, depth + 1);
      if (r.value) return r;
    }

    return { value: null, path: null };
  };

  return walk(root, "", 0);
}

function parseDateToYYYYMMDD(input: string): string | null {
  const s = input.trim();

  // ISO-like: 2026-02-06 or 2026-02-06T...
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // Slash date: 2026/2/6 or 2026/02/06
  const slash = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) {
    const mm = String(parseInt(slash[2], 10)).padStart(2, "0");
    const dd = String(parseInt(slash[3], 10)).padStart(2, "0");
    return `${slash[1]}-${mm}-${dd}`;
  }

  // Month name: Feb 6, 2026 / February 6 2026
  const month = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+(\d{4})\b/);
  if (month) {
    const monthName = month[1].toLowerCase();
    const day = String(parseInt(month[2], 10)).padStart(2, "0");
    const year = month[3];

    const months: Record<string, string> = {
      jan: "01",
      january: "01",
      feb: "02",
      february: "02",
      mar: "03",
      march: "03",
      apr: "04",
      april: "04",
      may: "05",
      jun: "06",
      june: "06",
      jul: "07",
      july: "07",
      aug: "08",
      august: "08",
      sep: "09",
      sept: "09",
      september: "09",
      oct: "10",
      october: "10",
      nov: "11",
      november: "11",
      dec: "12",
      december: "12",
    };

    const mm = months[monthName];
    if (mm) return `${year}-${mm}-${day}`;
  }

  return null;
}

// Normalize time string to 24h format "HH:mm"
// Accepts: "18:00", "6:00 PM", "6 PM", "6PM", "06:00pm", "600 pm" (tolerated)
function normalizeTime(timeStr: string): string | null {
  if (!timeStr) return null;

  // Clean up: trim, uppercase, normalize spaces
  const input = timeStr.trim().toUpperCase().replace(/\s+/g, " ");

  // If "18:00:00" => "18:00"
  const match24hWithSeconds = input.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (match24hWithSeconds) {
    const h = parseInt(match24hWithSeconds[1], 10);
    const m = parseInt(match24hWithSeconds[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
    return null;
  }

  // 24h format: "18:00" or "9:00"
  const match24h = input.match(/^(\d{1,2}):(\d{2})$/);
  if (match24h) {
    const h = parseInt(match24h[1], 10);
    const m = parseInt(match24h[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    }
    return null;
  }

  // AM/PM with minutes: "6:00 PM", "06:30AM", "6:00PM"
  const matchAmPm = input.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (matchAmPm) {
    let h = parseInt(matchAmPm[1], 10);
    const m = parseInt(matchAmPm[2], 10);
    const period = matchAmPm[3];

    if (h < 1 || h > 12 || m < 0 || m > 59) return null;

    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;

    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }

  // AM/PM without minutes: "6 PM", "6PM", "12AM"
  const matchAmPmShort = input.match(/^(\d{1,2})\s?(AM|PM)$/);
  if (matchAmPmShort) {
    let h = parseInt(matchAmPmShort[1], 10);
    const period = matchAmPmShort[2];

    if (h < 1 || h > 12) return null;

    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;

    return `${h.toString().padStart(2, "0")}:00`;
  }

  // Tolerate compact "600 PM" / "1230AM" => "6:00 PM" / "12:30 AM"
  const compact = input.replace(/\s+/g, ""); // "600PM"
  const matchCompact = compact.match(/^(\d{3,4})(AM|PM)$/);
  if (matchCompact) {
    const digits = matchCompact[1];
    const period = matchCompact[2];
    const hRaw = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
    const mRaw = digits.slice(-2);
    const hNum = parseInt(hRaw, 10);
    const mNum = parseInt(mRaw, 10);
    if (hNum >= 1 && hNum <= 12 && mNum >= 0 && mNum <= 59) {
      return normalizeTime(`${hNum}:${mRaw} ${period}`);
    }
  }

  return null;
}

function inferBookingType(strings: string[]): string | null {
  for (const s of strings) {
    const low = s.toLowerCase();
    if (low.includes("hourly")) return "hourly";
    if (low.includes("daily")) return "daily";
  }
  return null;
}

function inferTimes(strings: string[]): string[] {
  const times: string[] = [];
  for (const s of strings) {
    // very permissive: pick substrings that look like times
    const candidates = s.match(/\b\d{1,2}(?::\d{2})?\s?(?:AM|PM)\b|\b\d{1,2}:\d{2}\b/gi);
    if (!candidates) continue;
    for (const c of candidates) {
      const nt = normalizeTime(c);
      if (nt) times.push(nt);
    }
  }
  return times;
}

function normalizePayload(raw: AnyRecord): { normalized: NormalizedPayload; mapping: Partial<Record<CanonicalField, string>> } {
  const strings = collectAllStringsDeep(raw);

  const btFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.booking_type);
  const dateFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.date);
  const stFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.start_time);
  const etFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.end_time);
  const tzFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.timezone);

  const mapping: Partial<Record<CanonicalField, string>> = {};
  if (btFound.path) mapping.booking_type = btFound.path;
  if (dateFound.path) mapping.date = dateFound.path;
  if (stFound.path) mapping.start_time = stFound.path;
  if (etFound.path) mapping.end_time = etFound.path;
  if (tzFound.path) mapping.timezone = tzFound.path;

  const bookingTypeRaw = btFound.value ?? inferBookingType(strings);
  const dateRaw = dateFound.value ?? strings.map(parseDateToYYYYMMDD).find(Boolean) ?? null;

  const inferredTimes = inferTimes(strings);
  const startRaw = stFound.value ?? (inferredTimes.length >= 1 ? inferredTimes[0] : null);
  const endRaw = etFound.value ?? (inferredTimes.length >= 2 ? inferredTimes[inferredTimes.length - 1] : null);

  const timezoneRaw = tzFound.value ?? DEFAULT_TIMEZONE;

  const booking_type = bookingTypeRaw ? bookingTypeRaw.toLowerCase() : null;
  const date = dateRaw ? parseDateToYYYYMMDD(dateRaw) : null;

  // Important: stFound/etFound might already be inferredTimes (already normalized "HH:mm")
  const start_time = startRaw ? (startRaw.includes(":") && startRaw.length === 5 ? startRaw : normalizeTime(startRaw)) : null;
  const end_time = endRaw ? (endRaw.includes(":") && endRaw.length === 5 ? endRaw : normalizeTime(endRaw)) : null;

  return {
    normalized: {
      booking_type,
      date,
      start_time,
      end_time,
      timezone: timezoneRaw || DEFAULT_TIMEZONE,
    },
    mapping,
  };
}

function examplesPayload() {
  return {
    hourly: {
      booking_type: "hourly",
      Date: "2026-02-06",
      start_time: "6:00 PM",
      end_time: "10:00 PM",
      timezone: "America/New_York",
    },
    daily: {
      booking_type: "daily",
      Date: "2026-02-06",
      timezone: "America/New_York",
    },
  };
}

function buildOkFalseResponse(params: {
  error: string;
  missing_fields: string[];
  receivedBodyShape: AnyRecord;
  receivedKeys: string[];
  normalized: NormalizedPayload;
  mapping?: AnyRecord;
}): Response {
  const payload = {
    ok: false,
    error: params.error,
    missing_fields: params.missing_fields,
    debug: {
      receivedBodyShape: params.receivedBodyShape,
      receivedKeys: params.receivedKeys,
      normalized: params.normalized,
      mapping: params.mapping ?? null,
      examples: examplesPayload(),
    },
  };

  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
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
function logBody(label: string, body: AnyRecord): void {
  const safe = JSON.parse(JSON.stringify(body));
  const redactKeys = (obj: AnyRecord) => {
    for (const key of Object.keys(obj)) {
      if (/secret|token|key|password|auth/i.test(key)) {
        obj[key] = '[REDACTED]';
      } else if (obj[key] && typeof obj[key] === 'object') {
        redactKeys(obj[key] as AnyRecord);
      }
    }
  };
  redactKeys(safe);
  console.log(`[${label}]`, JSON.stringify(safe));
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
