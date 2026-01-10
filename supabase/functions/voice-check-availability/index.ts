import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-voice-agent-secret, x-self-test, x-api-key, x-ghl-payload, x-params, x-variables',
};

// GHL API configuration
const GHL_API_BASE = 'https://services.leadconnectorhq.com';
const GHL_CALENDAR_ID = 'tCUlP3Dalpf0fnhAPG52';
const DEFAULT_TIMEZONE = 'America/New_York';

interface NormalizedPayload {
  booking_type?: "hourly" | "daily";
  date?: string; // "YYYY-MM-DD"
  start_time?: string; // "HH:mm" (24h)
  end_time?: string; // "HH:mm" (24h)
  timezone?: string;
}

interface GHLEvent {
  id?: string;
  title?: string;
  startTime?: string | number;
  endTime?: string | number;
  start_time?: string | number;
  end_time?: string | number;
  start?: string | number;
  end?: string | number;
  startDate?: string;
  endDate?: string;
  appointmentStatus?: string;
  status?: string;
  event?: {
    startTime?: string | number;
    endTime?: string | number;
  };
  appointment?: {
    startTime?: string | number;
    endTime?: string | number;
  };
}

// ============= INPUT NORMALIZATION =============

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

function unwrapValue(val: unknown, maxDepth = 3): unknown {
  let cur: unknown = val;
  for (let i = 0; i < maxDepth; i++) {
    if (!isPlainObject(cur)) return cur;
    const obj = cur as AnyRecord;
    if ("value" in obj) { cur = obj.value; continue; }
    if ("text" in obj) { cur = obj.text; continue; }
    if ("label" in obj) { cur = obj.label; continue; }
    if ("name" in obj) { cur = obj.name; continue; }
    if ("time" in obj) { cur = obj.time; continue; }
    if ("date" in obj) { cur = obj.date; continue; }
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

function parseBodyText(rawText: string): { body: AnyRecord; mode: "json" | "form" | "empty" | "unknown" | "query"; error?: string } {
  const text = (rawText ?? "").trim();
  if (!text) return { body: {}, mode: "empty" };

  try {
    const parsed = JSON.parse(text);
    if (isPlainObject(parsed)) return { body: parsed, mode: "json" };
    return { body: { _value: parsed }, mode: "json" };
  } catch (e) {
    const jsonError = String(e);
    try {
      const params = new URLSearchParams(text);
      const obj: AnyRecord = {};
      let any = false;
      for (const [k, v] of params.entries()) { any = true; obj[k] = v; }
      if (any) return { body: obj, mode: "form" };
    } catch { /* ignore */ }
    return { body: { _raw: text }, mode: "unknown", error: jsonError };
  }
}

function collectAllKeysDeep(val: unknown, maxKeys = 300, maxDepth = 6): string[] {
  const keys: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, path: string, depth: number) => {
    if (keys.length >= maxKeys || depth > maxDepth) return;
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], `${path}[${i}]`, depth + 1);
      return;
    }
    for (const k of Object.keys(node as AnyRecord)) {
      const nextPath = path ? `${path}.${k}` : k;
      keys.push(nextPath);
      walk((node as AnyRecord)[k], nextPath, depth + 1);
    }
  };
  walk(val, "", 0);
  return keys;
}

function collectAllStringsDeep(val: unknown, maxStrings = 200, maxDepth = 8): string[] {
  const strings: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown, depth: number) => {
    if (strings.length >= maxStrings || depth > maxDepth) return;
    const unwrapped = unwrapValue(node);
    if (typeof unwrapped === "string") { const s = unwrapped.trim(); if (s) strings.push(s); return; }
    if (!unwrapped || typeof unwrapped !== "object" || seen.has(unwrapped)) return;
    seen.add(unwrapped);
    if (Array.isArray(unwrapped)) { for (const item of unwrapped) walk(item, depth + 1); return; }
    for (const v of Object.values(unwrapped as AnyRecord)) walk(v, depth + 1);
  };
  walk(val, 0);
  return strings;
}

function findByAliasesDeep(root: unknown, aliases: Set<string>): { value: string | null; path: string | null } {
  const seen = new Set<unknown>();
  const walk = (node: unknown, path: string, depth: number): { value: string | null; path: string | null } => {
    if (depth > 10 || !node || typeof node !== "object" || seen.has(node)) return { value: null, path: null };
    seen.add(node);
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) { const r = walk(node[i], `${path}[${i}]`, depth + 1); if (r.value) return r; }
      return { value: null, path: null };
    }
    const obj = node as AnyRecord;
    for (const [k, v] of Object.entries(obj)) {
      if (aliases.has(normalizeKey(k))) { const sv = toStringOrNull(v); if (sv) return { value: sv, path: path ? `${path}.${k}` : k }; }
    }
    const preferredContainers = ["body", "data", "payload", "params", "parameters", "inputs", "variables", "fields"];
    for (const c of preferredContainers) {
      const child = obj[c];
      if (child && typeof child === "object") { const r = walk(child, path ? `${path}.${c}` : c, depth + 1); if (r.value) return r; }
    }
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object") { const r = walk(v, path ? `${path}.${k}` : k, depth + 1); if (r.value) return r; }
    }
    return { value: null, path: null };
  };
  return walk(root, "", 0);
}

function parseDateToYYYYMMDD(input: string): string | null {
  const s = input.trim();
  const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = s.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[1]}-${String(parseInt(slash[2], 10)).padStart(2, "0")}-${String(parseInt(slash[3], 10)).padStart(2, "0")}`;
  const month = s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2})(?:,)?\s+(\d{4})\b/);
  if (month) {
    const months: Record<string, string> = { jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03", apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07", aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10", nov: "11", november: "11", dec: "12", december: "12" };
    const mm = months[month[1].toLowerCase()];
    if (mm) return `${month[3]}-${mm}-${String(parseInt(month[2], 10)).padStart(2, "0")}`;
  }
  return null;
}

function normalizeTime(timeStr: string): string | null {
  if (!timeStr) return null;
  const input = timeStr.trim().toUpperCase().replace(/\s+/g, " ");
  const match24hWithSeconds = input.match(/^(\d{1,2}):(\d{2}):(\d{2})$/);
  if (match24hWithSeconds) {
    const h = parseInt(match24hWithSeconds[1], 10), m = parseInt(match24hWithSeconds[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    return null;
  }
  const match24h = input.match(/^(\d{1,2}):(\d{2})$/);
  if (match24h) {
    const h = parseInt(match24h[1], 10), m = parseInt(match24h[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
    return null;
  }
  const matchAmPm = input.match(/^(\d{1,2}):(\d{2})\s?(AM|PM)$/);
  if (matchAmPm) {
    let h = parseInt(matchAmPm[1], 10); const m = parseInt(matchAmPm[2], 10); const period = matchAmPm[3];
    if (h < 1 || h > 12 || m < 0 || m > 59) return null;
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
  }
  const matchAmPmShort = input.match(/^(\d{1,2})\s?(AM|PM)$/);
  if (matchAmPmShort) {
    let h = parseInt(matchAmPmShort[1], 10); const period = matchAmPmShort[2];
    if (h < 1 || h > 12) return null;
    if (period === "PM" && h !== 12) h += 12;
    if (period === "AM" && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:00`;
  }
  const compact = input.replace(/\s+/g, "");
  const matchCompact = compact.match(/^(\d{3,4})(AM|PM)$/);
  if (matchCompact) {
    const digits = matchCompact[1], period = matchCompact[2];
    const hRaw = digits.length === 3 ? digits.slice(0, 1) : digits.slice(0, 2);
    const mRaw = digits.slice(-2);
    const hNum = parseInt(hRaw, 10), mNum = parseInt(mRaw, 10);
    if (hNum >= 1 && hNum <= 12 && mNum >= 0 && mNum <= 59) return normalizeTime(`${hNum}:${mRaw} ${period}`);
  }
  return null;
}

function normalizePayload(raw: AnyRecord): { normalized: NormalizedPayload; mapping: Partial<Record<CanonicalField, string>> } {
  const strings = collectAllStringsDeep(raw);
  const btFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.booking_type);
  const dateFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.date);
  const stFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.start_time);
  const etFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.end_time);
  const tzFound = findByAliasesDeep(raw, FIELD_ALIAS_SETS.timezone);

  const mapping: Partial<Record<CanonicalField, string>> = {};
  const normalized: NormalizedPayload = {};

  if (btFound.value) {
    mapping.booking_type = btFound.path ?? "?";
    const btLow = btFound.value.toLowerCase();
    if (btLow.includes("hourly")) normalized.booking_type = "hourly";
    else if (btLow.includes("daily")) normalized.booking_type = "daily";
  }

  if (dateFound.value) {
    mapping.date = dateFound.path ?? "?";
    const dd = parseDateToYYYYMMDD(dateFound.value);
    if (dd) normalized.date = dd;
  }

  if (stFound.value) {
    mapping.start_time = stFound.path ?? "?";
    const nt = normalizeTime(stFound.value);
    if (nt) normalized.start_time = nt;
  }

  if (etFound.value) {
    mapping.end_time = etFound.path ?? "?";
    const nt = normalizeTime(etFound.value);
    if (nt) normalized.end_time = nt;
  }

  if (tzFound.value) {
    mapping.timezone = tzFound.path ?? "?";
    normalized.timezone = tzFound.value;
  }

  if (!normalized.timezone) normalized.timezone = DEFAULT_TIMEZONE;

  return { normalized, mapping };
}

// ============= NEW: QUERY PARAMS EXTRACTION =============

function extractFromQueryParams(url: string): AnyRecord {
  try {
    const urlObj = new URL(url);
    const params = urlObj.searchParams;
    const result: AnyRecord = {};
    
    for (const [key, value] of params.entries()) {
      result[key] = value;
    }
    
    return result;
  } catch {
    return {};
  }
}

// ============= NEW: HEADERS EXTRACTION =============

function extractFromHeaders(req: Request): AnyRecord {
  const result: AnyRecord = {};
  
  // Try to extract payload from common GHL header names
  const ghlPayloadHeader = req.headers.get('x-ghl-payload');
  if (ghlPayloadHeader) {
    try {
      const parsed = JSON.parse(ghlPayloadHeader);
      if (isPlainObject(parsed)) Object.assign(result, parsed);
    } catch { /* ignore */ }
  }
  
  const paramsHeader = req.headers.get('x-params');
  if (paramsHeader) {
    try {
      const parsed = JSON.parse(paramsHeader);
      if (isPlainObject(parsed)) Object.assign(result, parsed);
    } catch { /* ignore */ }
  }
  
  const variablesHeader = req.headers.get('x-variables');
  if (variablesHeader) {
    try {
      const parsed = JSON.parse(variablesHeader);
      if (isPlainObject(parsed)) Object.assign(result, parsed);
    } catch { /* ignore */ }
  }
  
  return result;
}

// ============= NEW: PAYLOAD EMPTY CHECK =============

function isPayloadEmpty(parsed: { body: AnyRecord; mode: string }): boolean {
  if (parsed.mode === "empty") return true;
  if (!isPlainObject(parsed.body)) return true;
  
  const keys = Object.keys(parsed.body);
  if (keys.length === 0) return true;
  
  // Check if only has metadata keys
  const meaningfulKeys = keys.filter(k => !k.startsWith('_'));
  if (meaningfulKeys.length === 0) return true;
  
  // Check if all collected keys are empty
  const allKeys = collectAllKeysDeep(parsed.body);
  const meaningfulDeepKeys = allKeys.filter(k => !k.startsWith('_'));
  return meaningfulDeepKeys.length === 0;
}

// ============= NEW: MISSING PAYLOAD RESPONSE =============

function buildMissingPayloadResponse(req: Request, rawText: string, parsed: { body: AnyRecord; mode: string; error?: string }, queryParams: AnyRecord) {
  const url = new URL(req.url);
  const queryKeys = Object.keys(queryParams);
  const topLevelKeys = isPlainObject(parsed.body) ? Object.keys(parsed.body).slice(0, 20) : [];
  
  return new Response(
    JSON.stringify({
      ok: false,
      available: null,
      error: "missing_payload",
      message: "Empty request body. Voice Agent did not send variables yet. Do not confirm availability.",
      assistant_instruction: "DO NOT CONFIRM AVAILABILITY. The system could not receive booking details. Ask the customer for booking type (hourly or daily), date, and times if hourly.",
      debug: {
        received: {
          has_raw_text: rawText.length > 0,
          raw_text_len: rawText.length,
          parse_mode: parsed.mode,
          parse_error: parsed.error || null,
          top_level_keys: topLevelKeys,
          query_param_keys: queryKeys,
          query_params: queryParams,
          content_type: req.headers.get('content-type'),
          content_length: req.headers.get('content-length'),
          method: req.method,
          path: url.pathname,
        },
        hint: [
          "Ensure Custom Action variables are mapped and the agent only calls the action AFTER collecting booking_type and date.",
          "If GHL sends variables via body, verify Content-Type application/json.",
          "If GHL sends variables via query params, fallback will work automatically.",
        ],
      },
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============= NEW: OK FALSE VALIDATION RESPONSE =============

function buildOkFalseResponse(data: AnyRecord) {
  return new Response(
    JSON.stringify({
      ok: false,
      available: null,  // NEVER true when ok:false
      assistant_instruction: "DO NOT CONFIRM AVAILABILITY. Ask for booking type + date (+ times if hourly).",
      ...data,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ============= NEW: ENHANCED EVENT TIME PARSING =============

/**
 * Extract event time window from GHL event object in MS
 * Handles multiple field names and formats
 */
function extractEventWindowMs(ev: GHLEvent): { startMs: number | null; endMs: number | null; status: string | null } {
  // Try different field names in order
  let startRaw: string | number | undefined;
  let endRaw: string | number | undefined;
  
  // Priority 1: Direct fields
  startRaw = startRaw || ev.startTime;
  endRaw = endRaw || ev.endTime;
  
  // Priority 2: Underscore fields
  startRaw = startRaw || ev.start_time;
  endRaw = endRaw || ev.end_time;
  
  // Priority 3: Short names
  startRaw = startRaw || ev.start;
  endRaw = endRaw || ev.end;
  
  // Priority 4: Date fields
  if (!startRaw && ev.startDate) startRaw = ev.startDate;
  if (!endRaw && ev.endDate) endRaw = ev.endDate;
  
  // Priority 5: Nested in event object
  if (!startRaw && ev.event?.startTime) startRaw = ev.event.startTime;
  if (!endRaw && ev.event?.endTime) endRaw = ev.event.endTime;
  
  // Priority 6: Nested in appointment object
  if (!startRaw && ev.appointment?.startTime) startRaw = ev.appointment.startTime;
  if (!endRaw && ev.appointment?.endTime) endRaw = ev.appointment.endTime;
  
  // Parse to MS
  const startMs = parseEventTimeToMs(startRaw);
  const endMs = parseEventTimeToMs(endRaw);
  
  // Extract status
  const status = ev.appointmentStatus || ev.status || null;
  
  return { startMs, endMs, status };
}

/**
 * Parse event time to milliseconds
 * Handles: epoch seconds (10 digits), epoch ms (13 digits), ISO strings
 */
function parseEventTimeToMs(val: string | number | undefined): number | null {
  if (val === undefined || val === null) return null;
  
  // Unwrap if it's an object with value/text/etc
  const unwrapped = unwrapValue(val);
  
  // If it's a number or numeric string
  if (typeof unwrapped === "number" || typeof unwrapped === "string") {
    const num = typeof unwrapped === "number" ? unwrapped : parseFloat(String(unwrapped));
    
    if (!isNaN(num)) {
      // If it's less than 1e12 (10-11 digits), treat as seconds
      if (num < 1e12) {
        return num * 1000;
      }
      // If it's >= 1e12 (13+ digits), treat as milliseconds
      return num;
    }
  }
  
  // If it's an ISO string
  if (typeof unwrapped === "string") {
    try {
      const parsed = Date.parse(unwrapped);
      if (!isNaN(parsed)) return parsed;
    } catch { /* ignore */ }
  }
  
  return null;
}

// ============= TIME UTILITIES =============

function hhmmToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function buildDateRangeForQuery(date: string, startTime: string | undefined, endTime: string | undefined, timezone: string): { start: string; end: string } | null {
  try {
    const [y, m, d] = date.split('-').map(Number);
    
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(':').map(Number);
      const [eh, em] = endTime.split(':').map(Number);
      
      const startLocal = new Date(y, m - 1, d, sh, sm, 0);
      const endLocal = new Date(y, m - 1, d, eh, em, 0);
      
      const startUTC = convertLocalToUTC(startLocal, timezone);
      const endUTC = convertLocalToUTC(endLocal, timezone);
      
      return {
        start: startUTC.toISOString(),
        end: endUTC.toISOString(),
      };
    } else {
      // Daily: entire day in local time
      const startLocal = new Date(y, m - 1, d, 0, 0, 0);
      const endLocal = new Date(y, m - 1, d, 23, 59, 59);
      
      const startUTC = convertLocalToUTC(startLocal, timezone);
      const endUTC = convertLocalToUTC(endLocal, timezone);
      
      return {
        start: startUTC.toISOString(),
        end: endUTC.toISOString(),
      };
    }
  } catch {
    return null;
  }
}

function convertLocalToUTC(localDate: Date, timezone: string): Date {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
    
    const parts = formatter.formatToParts(localDate);
    const partsMap: Record<string, string> = {};
    for (const part of parts) {
      if (part.type !== 'literal') partsMap[part.type] = part.value;
    }
    
    const utcMs = Date.UTC(
      parseInt(partsMap.year, 10),
      parseInt(partsMap.month, 10) - 1,
      parseInt(partsMap.day, 10),
      parseInt(partsMap.hour, 10),
      parseInt(partsMap.minute, 10),
      parseInt(partsMap.second, 10)
    );
    
    const offset = utcMs - localDate.getTime();
    return new Date(localDate.getTime() - offset);
  } catch {
    return localDate;
  }
}

// ============= GHL API =============

async function fetchGHLEvents(calendarId: string, startTime: string, endTime: string, locationId: string, ghlToken: string): Promise<{ events: GHLEvent[]; raw: unknown }> {
  const url = `${GHL_API_BASE}/calendars/events?calendarId=${encodeURIComponent(calendarId)}&startTime=${encodeURIComponent(startTime)}&endTime=${encodeURIComponent(endTime)}&locationId=${encodeURIComponent(locationId)}`;
  
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${ghlToken}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    },
  });
  
  if (!resp.ok) {
    throw new Error(`GHL API error: ${resp.status} ${resp.statusText}`);
  }
  
  const data = await resp.json();
  
  // Handle different response shapes
  let events: GHLEvent[] = [];
  if (Array.isArray(data)) {
    events = data;
  } else if (data && Array.isArray(data.events)) {
    events = data.events;
  } else if (data && Array.isArray(data.data)) {
    events = data.data;
  }
  
  return { events, raw: data };
}

async function fetchGHLBlockedSlots(calendarId: string, startDate: string, endDate: string, timezone: string, ghlToken: string): Promise<{ slots: unknown[]; raw: unknown }> {
  const url = `${GHL_API_BASE}/calendars/${encodeURIComponent(calendarId)}/blocked-slots?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&timezone=${encodeURIComponent(timezone)}`;
  
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${ghlToken}`,
      'Version': '2021-04-15',
      'Content-Type': 'application/json',
    },
  });
  
  if (!resp.ok) {
    console.warn(`Blocked slots fetch failed: ${resp.status}`);
    return { slots: [], raw: null };
  }
  
  const data = await resp.json();
  const slots = Array.isArray(data) ? data : (Array.isArray(data?.slots) ? data.slots : []);
  
  return { slots, raw: data };
}

// ============= GHL CONFIG WITH FALLBACKS =============

interface GhlConfig {
  token: string;
  locationId: string;
  calendarId: string;
  debug: {
    hasToken: boolean;
    hasLocationId: boolean;
    hasCalendarId: boolean;
    tokenSourceKey: string | null;
    locationSourceKey: string | null;
    calendarSourceKey: string | null;
    ghlEnvKeysPresent: string[];
  };
}

function getGhlConfig(): GhlConfig {
  // Token fallbacks
  const tokenKeys = ["GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_BACKEND_TOKEN", "GHL_TOKEN"];
  let token = "";
  let tokenSourceKey: string | null = null;
  
  for (const key of tokenKeys) {
    const val = (Deno.env.get(key) ?? "").trim();
    if (val.length > 0) {
      token = val;
      tokenSourceKey = key;
      break;
    }
  }
  
  // Location fallbacks
  const locationKeys = ["GHL_LOCATION_ID", "GHL_SUBACCOUNT_ID", "GHL_ACCOUNT_ID"];
  let locationId = "";
  let locationSourceKey: string | null = null;
  
  for (const key of locationKeys) {
    const val = (Deno.env.get(key) ?? "").trim();
    if (val.length > 0) {
      locationId = val;
      locationSourceKey = key;
      break;
    }
  }
  
  // Calendar fallback
  const calendarFromEnv = (Deno.env.get("GHL_CALENDAR_ID") ?? "").trim();
  const calendarId = calendarFromEnv || GHL_CALENDAR_ID;
  const calendarSourceKey = calendarFromEnv ? "GHL_CALENDAR_ID" : "hardcoded";
  
  // List all GHL_* keys present (without values)
  const ghlEnvKeysPresent: string[] = [];
  const allPossibleKeys = [
    ...tokenKeys, 
    ...locationKeys, 
    "GHL_CALENDAR_ID",
    "GHL_API_KEY",
    "GHL_API_TOKEN"
  ];
  
  for (const key of allPossibleKeys) {
    if (Deno.env.get(key) !== undefined && Deno.env.get(key) !== null) {
      ghlEnvKeysPresent.push(key);
    }
  }
  
  return {
    token,
    locationId,
    calendarId,
    debug: {
      hasToken: token.length > 0,
      hasLocationId: locationId.length > 0,
      hasCalendarId: calendarId.length > 0,
      tokenSourceKey,
      locationSourceKey,
      calendarSourceKey,
      ghlEnvKeysPresent
    }
  };
}

// ============= CONFLICT DETECTION =============

function filterConflictingEvents(events: GHLEvent[], windowStartMs: number, windowEndMs: number): { conflicts: GHLEvent[]; details: unknown[] } {
  const conflicts: GHLEvent[] = [];
  const details: unknown[] = [];
  
  for (const ev of events) {
    const { startMs, endMs, status } = extractEventWindowMs(ev);
    
    // Skip if we couldn't parse times
    if (startMs === null || endMs === null) {
      console.log(`[SKIP_EVENT] Could not parse times for event ${ev.id || 'unknown'}`);
      continue;
    }
    
    // Check for overlap: event_start < window_end AND event_end > window_start
    const hasOverlap = startMs < windowEndMs && endMs > windowStartMs;
    
    if (hasOverlap) {
      conflicts.push(ev);
      details.push({
        id: ev.id,
        title: ev.title,
        status,
        start_ms: startMs,
        end_ms: endMs,
        start_iso: new Date(startMs).toISOString(),
        end_iso: new Date(endMs).toISOString(),
      });
    }
  }
  
  return { conflicts, details };
}

// ============= LOGGING =============

function logBody(label: string, body: unknown) {
  try {
    const str = JSON.stringify(body);
    if (str.length <= 1500) {
      console.log(`[${label}]`, str);
    } else {
      console.log(`[${label}]`, str.substring(0, 1500) + `... (truncated, total ${str.length} chars)`);
    }
  } catch {
    console.log(`[${label}]`, String(body).substring(0, 500));
  }
}

// ============= SELF-TESTS =============

function runSelfTests(): { passed: boolean; results: { name: string; passed: boolean; details?: unknown }[] } {
  const results: { name: string; passed: boolean; details?: unknown }[] = [];
  
  const assert = (name: string, pass: boolean, details?: unknown) => {
    results.push({ name, passed: pass, details });
  };
  
  // Test 1: Parse epoch seconds
  {
    const secondsStr = "1736539200";
    const ms = parseEventTimeToMs(secondsStr);
    const pass = ms === 1736539200000;
    assert("parse_epoch_seconds_string", pass, { input: secondsStr, output: ms, expected: 1736539200000 });
  }
  
  // Test 2: Parse epoch seconds number
  {
    const secondsNum = 1736539200;
    const ms = parseEventTimeToMs(secondsNum);
    const pass = ms === 1736539200000;
    assert("parse_epoch_seconds_number", pass, { input: secondsNum, output: ms, expected: 1736539200000 });
  }
  
  // Test 3: Parse epoch ms
  {
    const msNum = 1736539200000;
    const ms = parseEventTimeToMs(msNum);
    const pass = ms === 1736539200000;
    assert("parse_epoch_ms", pass, { input: msNum, output: ms });
  }
  
  // Test 4: Parse ISO string
  {
    const iso = "2026-02-06T18:00:00-05:00";
    const ms = parseEventTimeToMs(iso);
    const pass = ms !== null && !isNaN(ms);
    assert("parse_iso_string", pass, { input: iso, output: ms });
  }
  
  // Test 5: Extract from wrapped value
  {
    const wrapped = { value: "1736539200" };
    const ms = parseEventTimeToMs(wrapped as any);
    const pass = ms === 1736539200000;
    assert("parse_wrapped_value", pass, { input: wrapped, output: ms });
  }
  
  // Test 6: Overlap detection
  {
    const windowStart = Date.parse("2026-02-06T18:00:00Z");
    const windowEnd = Date.parse("2026-02-06T22:00:00Z");
    
    const eventStart = Date.parse("2026-02-06T20:00:00Z");
    const eventEnd = Date.parse("2026-02-06T23:00:00Z");
    
    const hasOverlap = eventStart < windowEnd && eventEnd > windowStart;
    assert("overlap_detection", hasOverlap, { windowStart, windowEnd, eventStart, eventEnd });
  }
  
  // Test 7: Extract from query params
  {
    const url = "https://example.com/test?booking_type=hourly&date=2026-02-06&start_time=6:00 PM&end_time=10:00 PM";
    const params = extractFromQueryParams(url);
    const pass = params.booking_type === "hourly" && params.date === "2026-02-06";
    assert("extract_query_params", pass, { params });
  }

  // Test 8: getGhlConfig with GHL_PRIVATE_INTEGRATION_TOKEN
  {
    const originalGet = Deno.env.get;
    try {
      // Mock env
      Deno.env.get = (key: string) => {
        if (key === "GHL_PRIVATE_INTEGRATION_TOKEN") return "test_token_123";
        if (key === "GHL_LOCATION_ID") return "test_loc_456";
        return originalGet(key);
      };
      
      const cfg = getGhlConfig();
      const pass = cfg.debug.hasToken && cfg.debug.tokenSourceKey === "GHL_PRIVATE_INTEGRATION_TOKEN";
      assert("env_resolution_primary_token", pass, { tokenSource: cfg.debug.tokenSourceKey });
    } finally {
      Deno.env.get = originalGet;
    }
  }

  // Test 9: getGhlConfig fallback to GHL_BACKEND_TOKEN
  {
    const originalGet = Deno.env.get;
    try {
      Deno.env.get = (key: string) => {
        if (key === "GHL_BACKEND_TOKEN") return "backend_token_789";
        if (key === "GHL_LOCATION_ID") return "test_loc_456";
        return originalGet(key);
      };
      
      const cfg = getGhlConfig();
      const pass = cfg.debug.hasToken && cfg.debug.tokenSourceKey === "GHL_BACKEND_TOKEN";
      assert("env_resolution_fallback_token", pass, { tokenSource: cfg.debug.tokenSourceKey });
    } finally {
      Deno.env.get = originalGet;
    }
  }

  // Test 10: getGhlConfig fallback location
  {
    const originalGet = Deno.env.get;
    try {
      Deno.env.get = (key: string) => {
        if (key === "GHL_PRIVATE_INTEGRATION_TOKEN") return "test_token";
        if (key === "GHL_SUBACCOUNT_ID") return "subaccount_999";
        return originalGet(key);
      };
      
      const cfg = getGhlConfig();
      const pass = cfg.debug.hasLocationId && cfg.debug.locationSourceKey === "GHL_SUBACCOUNT_ID";
      assert("env_resolution_fallback_location", pass, { locationSource: cfg.debug.locationSourceKey });
    } finally {
      Deno.env.get = originalGet;
    }
  }

  return { passed: results.every(r => r.passed), results };
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Handle non-POST with 200 (not 405) to avoid GHL marking as failed
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ 
        ok: false, 
        available: null,
        error: "method_not_allowed",
        message: "Only POST requests are supported"
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Read and normalize env vars (TRIM whitespace)
  const voiceSecret = (Deno.env.get("VOICE_AGENT_WEBHOOK_SECRET") ?? "").trim();
  const cfg = getGhlConfig();
  const ghlToken = cfg.token;
  const locationId = cfg.locationId;
  const calendarIdEffective = cfg.calendarId;

  // Auth check
  const secretFromCustomHeader = req.headers.get('x-voice-agent-secret');
  const authHeader = req.headers.get('authorization');
  const secretFromBearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const secretFromApiKeyHeader = req.headers.get('x-api-key') ?? req.headers.get('x-api_key');
  const providedSecret = (secretFromCustomHeader?.trim()) || (secretFromApiKeyHeader?.trim()) || (secretFromBearer) || null;

  if (!providedSecret || voiceSecret.length === 0 || providedSecret !== voiceSecret) {
    console.log('[AUTH] Invalid or missing secret');
    return new Response(JSON.stringify({ 
      ok: false, 
      available: null, 
      error: "auth_failed", 
      message: "Invalid or missing authentication",
      assistant_instruction: "DO NOT CONFIRM AVAILABILITY"
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Self-test mode
  const selfTest = req.headers.get('x-self-test');
  if (selfTest === 'true') {
    console.log('[SELF-TEST] Running internal tests...');
    const testResults = runSelfTests();
    return new Response(JSON.stringify({ ok: true, self_test: testResults.passed ? 'PASS' : 'FAIL', results: testResults.results }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // ENV diagnostic mode (header OR query param)
  const url = new URL(req.url);
  const debugEnvHeader = req.headers.get('x-debug-env');
  const debugEnvQuery = url.searchParams.get('debug_env');
  const debugEnv = debugEnvHeader === 'true' || debugEnvQuery === '1';

  if (debugEnv) {
    return new Response(JSON.stringify({
      ok: false,
      available: null,
      error: "debug_env",
      debug: cfg.debug
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Parse body
  const rawText = await req.text().catch(() => "");
  const parsed = parseBodyText(rawText);
  
  // Log compact request summary
  const queryKeys = Array.from(url.searchParams.keys());
  const topBodyKeys = isPlainObject(parsed.body) ? Object.keys(parsed.body).slice(0, 10) : [];
  console.log(`[REQUEST] ${req.method} ${url.pathname} | hasBody:${rawText.length > 0} | parseMode:${parsed.mode} | queryKeys:[${queryKeys.join(',')}] | topBodyKeys:[${topBodyKeys.join(',')}]`);

  // ULTRA TOLERANT PARSING: Fallback to query params and headers
  const isEmpty = isPayloadEmpty(parsed);
  if (isEmpty) {
    console.log("[FALLBACK] Body is empty, trying query params...");
    const queryParams = extractFromQueryParams(req.url);
    
    if (Object.keys(queryParams).length > 0) {
      console.log(`[FALLBACK] Found ${Object.keys(queryParams).length} query params, using as body`);
      parsed.body = queryParams;
      parsed.mode = "query";
    } else {
      // Try headers as last resort
      const headerPayload = extractFromHeaders(req);
      if (Object.keys(headerPayload).length > 0) {
        console.log(`[FALLBACK] Found payload in headers, merging`);
        Object.assign(parsed.body, headerPayload);
      } else {
        // Truly empty - cannot proceed
        console.log("[MISSING_PAYLOAD] No body, no query params, no header payload");
        return buildMissingPayloadResponse(req, rawText, parsed, queryParams);
      }
    }
  }

  const receivedKeys = collectAllKeysDeep(parsed.body);
  const { normalized, mapping } = normalizePayload(parsed.body);

  console.log("[NORMALIZED]", JSON.stringify(normalized));

  // Validation - NEVER return available=true if validation fails
  const missingFields: string[] = [];
  if (!normalized.booking_type) missingFields.push("booking_type");
  if (!normalized.date) missingFields.push("date");
  if (normalized.booking_type === "hourly") {
    if (!normalized.start_time) missingFields.push("start_time");
    if (!normalized.end_time) missingFields.push("end_time");
    if (normalized.start_time && normalized.end_time) {
      const sMin = hhmmToMinutes(normalized.start_time), eMin = hhmmToMinutes(normalized.end_time);
      if (sMin == null || eMin == null || eMin <= sMin) missingFields.push("time_range (end_time must be after start_time)");
    }
  }

  if (missingFields.length > 0) {
    console.log("[VALIDATION] Failed:", missingFields);
    return buildOkFalseResponse({ 
      error: "validation_failed", 
      missing_fields: missingFields, 
      received_keys: receivedKeys.slice(0, 50),
      normalized, 
      mapping,
      parse_mode: parsed.mode,
      query_keys: queryKeys,
    });
  }

  // Config check (SEPARATE from auth)
  if (!cfg.debug.hasToken || !cfg.debug.hasLocationId) {
    console.error('[CONFIG] Missing GHL credentials:', cfg.debug);
    return buildOkFalseResponse({ 
      error: "config_error",
      message: "GHL API not configured",
      assistant_instruction: "DO NOT CONFIRM AVAILABILITY. Offer booking link or callback. System cannot read GHL credentials.",
      debug: cfg.debug
    });
  }

  console.log(`[ENV] hasToken=${cfg.debug.hasToken} tokenKey=${cfg.debug.tokenSourceKey} hasLocationId=${cfg.debug.hasLocationId} locationKey=${cfg.debug.locationSourceKey} calendarKey=${cfg.debug.calendarSourceKey} keys=[${cfg.debug.ghlEnvKeysPresent.join(',')}]`);

  // Build date range for query
  const dateRange = buildDateRangeForQuery(
    normalized.date!,
    normalized.start_time,
    normalized.end_time,
    normalized.timezone!
  );

  if (!dateRange) {
    return buildOkFalseResponse({ 
      error: "date_parse_error", 
      message: "Could not build date range" 
    });
  }

  const windowStartMs = Date.parse(dateRange.start);
  const windowEndMs = Date.parse(dateRange.end);

  console.log(`[QUERY_WINDOW] ${dateRange.start} to ${dateRange.end} (${windowStartMs} - ${windowEndMs})`);

  // Fetch events and blocked slots
  let events: GHLEvent[] = [];
  let blockedSlots: unknown[] = [];
  let eventsRaw: unknown = null;
  let blockedRaw: unknown = null;

  try {
    const eventsResult = await fetchGHLEvents(
      calendarIdEffective,
      dateRange.start,
      dateRange.end,
      locationId,
      ghlToken
    );
    events = eventsResult.events;
    eventsRaw = eventsResult.raw;
    
    console.log(`[GHL_EVENTS] Fetched ${events.length} events`);
  } catch (err) {
    console.error('[GHL_EVENTS] Fetch failed:', err);
    return buildOkFalseResponse({
      error: "ghl_fetch_error", 
      message: "Could not fetch calendar events", 
      detail: String(err) 
    });
  }

  try {
    const blockedResult = await fetchGHLBlockedSlots(
      calendarIdEffective,
      normalized.date!,
      normalized.date!,
      normalized.timezone!,
      ghlToken
    );
    blockedSlots = blockedResult.slots;
    blockedRaw = blockedResult.raw;
    
    console.log(`[GHL_BLOCKED] Fetched ${blockedSlots.length} blocked slots`);
  } catch (err) {
    console.warn('[GHL_BLOCKED] Fetch failed (non-fatal):', err);
  }

  // ANTI-FALSE-POSITIVE: If no events and no blocked slots, we can't verify availability
  if (events.length === 0 && blockedSlots.length === 0) {
    console.log("[UNVERIFIED] No events and no blocked slots returned - cannot confirm availability");
    return new Response(
      JSON.stringify({
        ok: false,
        available: null,
        error: "unverified_empty_calendar",
        message: "Could not verify availability - calendar returned no data",
        assistant_instruction: "DO NOT CONFIRM AVAILABILITY. The calendar appears empty which may indicate a sync issue. Ask the customer to call directly or try again.",
        debug: {
          checked_calendar_id: calendarIdEffective,
          window_start_ms: windowStartMs,
          window_end_ms: windowEndMs,
          window_start_iso: dateRange.start,
          window_end_iso: dateRange.end,
          events_count: 0,
          blocked_count: 0,
      normalized,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // Check for conflicts
  const { conflicts, details } = filterConflictingEvents(events, windowStartMs, windowEndMs);
  
  console.log(`[CONFLICTS] Found ${conflicts.length} conflicting events`);

  // Build sample events for debug
  const sampleEvents = details.slice(0, 3);

  // Determine availability
  const hasBlockedSlots = blockedSlots.length > 0;
  const hasConflicts = conflicts.length > 0;
  const available = !hasConflicts && !hasBlockedSlots;

  const response = {
    ok: true,
    available,
    reason: available
      ? "No conflicts found for requested time" 
      : hasConflicts 
        ? `Found ${conflicts.length} existing booking(s) during requested time` 
        : "Time slot is blocked",
    conflicts_count: conflicts.length,
    blocked_slots_count: blockedSlots.length,
    assistant_instruction: available 
      ? "This time slot IS AVAILABLE. You may proceed with the booking." 
      : "This time slot IS NOT AVAILABLE. Suggest alternative dates or times.",
    debug: {
      checked_calendar_id: calendarIdEffective,
      window_start_ms: windowStartMs,
      window_end_ms: windowEndMs,
      window_start_iso: dateRange.start,
      window_end_iso: dateRange.end,
      events_count: events.length,
      blocked_count: blockedSlots.length,
    sample_events: sampleEvents,
      parse_mode: parsed.mode,
      query_keys: queryKeys,
    normalized,
    },
  };

  console.log(`[RESULT] available=${available}, conflicts=${conflicts.length}, blocked=${blockedSlots.length}`);

  return new Response(
    JSON.stringify(response),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
});

/*
VERIFICACIÓN DE ENV VARS CON FALLBACKS:

1. Test modo debug (muestra qué env vars están presentes):

curl -sS -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability?debug_env=1" \
  -H "x-voice-agent-secret: oev_live_9fK3Qw7N2mX8VtR1pL6cH0sY4aJ5uE7gD3zB8nC1rT6vP2kM9xW5qS0hL7yU4cA2dF8jG1eH6iK3oP9rN5tV7wX0zY2" \
  -H "Content-Type: application/json" \
  -d "{}"

Esperado:
{
  "ok": false,
  "error": "debug_env",
  "debug": {
    "hasToken": true/false,
    "hasLocationId": true/false,
    "tokenSourceKey": "GHL_PRIVATE_INTEGRATION_TOKEN" o "GHL_BACKEND_TOKEN" o null,
    "locationSourceKey": "GHL_LOCATION_ID" o "GHL_SUBACCOUNT_ID" o null,
    "ghlEnvKeysPresent": ["GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_LOCATION_ID", ...]
  }
}

2. Test normal (daily booking):

curl -sS -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
  -H "x-voice-agent-secret: oev_live_9fK3Qw7N2mX8VtR1pL6cH0sY4aJ5uE7gD3zB8nC1rT6vP2kM9xW5qS0hL7yU4cA2dF8jG1eH6iK3oP9rN5tV7wX0zY2" \
  -H "Content-Type: application/json" \
  -d '{"booking_type":"daily","date":"2026-01-17","timezone":"America/New_York"}'

3. Test self-tests (incluye tests de env resolution):

curl -sS -X POST "https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability" \
  -H "x-voice-agent-secret: oev_live_9fK3Qw7N2mX8VtR1pL6cH0sY4aJ5uE7gD3zB8nC1rT6vP2kM9xW5qS0hL7yU4cA2dF8jG1eH6iK3oP9rN5tV7wX0zY2" \
  -H "x-self-test: true"

Diagnóstico en 20 segundos:
- Si debug muestra hasToken:false, revisa qué keys están en ghlEnvKeysPresent
- Si ghlEnvKeysPresent está vacío, los secrets no están configurados en Supabase
- Si ghlEnvKeysPresent tiene keys pero hasToken es false, hay un problema de nombres
*/
