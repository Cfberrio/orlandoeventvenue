import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-voice-agent-secret, x-self-test, x-api-key',
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
  startTime?: string; // ISO or ms
  endTime?: string;   // ISO or ms
  appointmentStatus?: string;
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
    const candidates = s.match(/\b\d{1,2}(?::\d{2})?\s?(?:AM|PM)\b|\b\d{1,2}:\d{2}\b/gi);
    if (!candidates) continue;
    for (const c of candidates) { const nt = normalizeTime(c); if (nt) times.push(nt); }
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
  const dateCandidate = dateFound.value ?? strings.map(parseDateToYYYYMMDD).find((d): d is string => !!d);
  const inferredTimes = inferTimes(strings);
  const startRaw = stFound.value ?? (inferredTimes.length >= 1 ? inferredTimes[0] : null);
  const endRaw = etFound.value ?? (inferredTimes.length >= 2 ? inferredTimes[inferredTimes.length - 1] : null);
  const timezoneRaw = tzFound.value ?? DEFAULT_TIMEZONE;

  const btLower = bookingTypeRaw ? bookingTypeRaw.toLowerCase() : undefined;
  const booking_type: NormalizedPayload["booking_type"] = btLower === "hourly" || btLower === "daily" ? btLower : undefined;
  const date = dateCandidate ?? undefined;
  const start_time = startRaw ? ((/^\d{2}:\d{2}$/.test(startRaw) ? startRaw : normalizeTime(startRaw)) ?? undefined) : undefined;
  const end_time = endRaw ? ((/^\d{2}:\d{2}$/.test(endRaw) ? endRaw : normalizeTime(endRaw)) ?? undefined) : undefined;
  const timezone = (timezoneRaw && String(timezoneRaw).trim()) ? String(timezoneRaw).trim() : DEFAULT_TIMEZONE;

  return { normalized: { booking_type, date, start_time, end_time, timezone }, mapping };
}

function examplesPayload() {
  return {
    hourly: { booking_type: "hourly", Date: "2026-02-06", start_time: "6:00 PM", end_time: "10:00 PM", timezone: "America/New_York" },
    daily: { booking_type: "daily", Date: "2026-02-06", timezone: "America/New_York" },
  };
}

function buildOkFalseResponse(params: { error: string; missing_fields: string[]; receivedBodyShape: AnyRecord; receivedKeys: string[]; normalized: NormalizedPayload; mapping?: AnyRecord; debug?: AnyRecord }): Response {
  return new Response(JSON.stringify({
    ok: false,
    available: null,
    error: params.error,
    missing_fields: params.missing_fields,
    debug: { receivedBodyShape: params.receivedBodyShape, receivedKeys: params.receivedKeys, normalized: params.normalized, mapping: params.mapping ?? null, examples: examplesPayload(), ...params.debug },
  }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

function hhmmToMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{2}):(\d{2})$/);
  if (!m) return null;
  const h = parseInt(m[1], 10), min = parseInt(m[2], 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function getTimeZoneOffsetMillis(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUTC = Date.UTC(parseInt(map.year, 10), parseInt(map.month, 10) - 1, parseInt(map.day, 10), parseInt(map.hour, 10), parseInt(map.minute, 10), parseInt(map.second, 10));
  return asUTC - date.getTime();
}

function zonedDateTimeToUtcMillis(dateStr: string, timeHHmm: string, timeZone: string): number | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  const tm = timeHHmm.match(/^(\d{2}):(\d{2})$/);
  if (!tm) return null;
  const h = parseInt(tm[1], 10), mi = parseInt(tm[2], 10);
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const offset = getTimeZoneOffsetMillis(new Date(utcGuess), timeZone);
  return utcGuess - offset;
}

function getDailyRange(date: string, timeZone: string): { startMs: number; endMs: number } | null {
  const startMs = zonedDateTimeToUtcMillis(date, "00:00", timeZone);
  // Use 23:59:59.999 to cover the full day
  const endMsBase = zonedDateTimeToUtcMillis(date, "23:59", timeZone);
  if (startMs == null || endMsBase == null) return null;
  return { startMs, endMs: endMsBase + 59999 }; // add 59.999 seconds
}

function getHourlyRange(date: string, startHHmm: string, endHHmm: string, timeZone: string): { startMs: number; endMs: number } | null {
  const startMinutes = hhmmToMinutes(startHHmm), endMinutes = hhmmToMinutes(endHHmm);
  if (startMinutes == null || endMinutes == null || endMinutes <= startMinutes) return null;
  const startMs = zonedDateTimeToUtcMillis(date, startHHmm, timeZone);
  const endMs = zonedDateTimeToUtcMillis(date, endHHmm, timeZone);
  if (startMs == null || endMs == null) return null;
  return { startMs, endMs };
}

// ============= GHL API CALLS =============

// Parse event time (could be ISO string, epoch seconds, or epoch millis)
function parseEventTimeToMs(val: unknown): number | null {
  if (typeof val === "number") {
    // If < 1e12 (10 digits) → seconds, convert to ms
    // If >= 1e12 (13 digits) → already ms
    // 1e12 = 1,000,000,000,000 ms = Sept 9, 2001
    return val < 1e12 ? val * 1000 : val;
  }
  if (typeof val === "string") {
    // If it's all digits, treat as epoch (seconds or ms)
    if (/^\d+$/.test(val)) {
      const num = parseInt(val, 10);
      return num < 1e12 ? num * 1000 : num;
    }
    // Otherwise parse as ISO
    const ms = Date.parse(val);
    return isNaN(ms) ? null : ms;
  }
  return null;
}

// Fetch /calendars/events (REAL bookings/appointments)
async function getCalendarEvents(locationId: string, startMs: number, endMs: number, ghlToken: string): Promise<{ events: GHLEvent[]; rawResponse?: unknown; error?: string }> {
  const url = new URL(`${GHL_API_BASE}/calendars/events`);
  url.searchParams.set('locationId', locationId);
  url.searchParams.set('calendarId', GHL_CALENDAR_ID);
  url.searchParams.set('startTime', String(startMs));
  url.searchParams.set('endTime', String(endMs));

  console.log(`[GHL] GET /calendars/events: ${url.toString()}`);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${ghlToken}`, 'Version': '2021-04-15', 'Content-Type': 'application/json' },
    });

    const responseText = await response.text();
    console.log(`[GHL] /calendars/events status=${response.status} body=${responseText.substring(0, 600)}`);

    if (!response.ok) {
      return { events: [], rawResponse: responseText, error: `GHL /calendars/events error: ${response.status}` };
    }

    let data: unknown;
    try { data = JSON.parse(responseText); } catch { return { events: [], rawResponse: responseText, error: "Invalid JSON from /calendars/events" }; }

    // GHL returns { events: [...] }
    const arr = (data as AnyRecord)?.events;
    if (!Array.isArray(arr)) {
      // If no events array but has traceId => treat as empty but valid
      if ((data as AnyRecord)?.traceId) {
        console.log("[GHL] /calendars/events returned traceId only (empty)");
        return { events: [], rawResponse: data };
      }
      return { events: [], rawResponse: data, error: "Unexpected shape from /calendars/events" };
    }

    return { events: arr as GHLEvent[], rawResponse: data };
  } catch (err) {
    console.error('[GHL] Fetch /calendars/events error:', err);
    return { events: [], error: String(err) };
  }
}

// Fetch /calendars/blocked-slots (manual blocks)
async function getBlockedSlots(locationId: string, startMs: number, endMs: number, ghlToken: string): Promise<{ events: GHLEvent[]; rawResponse?: unknown; error?: string }> {
  const url = new URL(`${GHL_API_BASE}/calendars/blocked-slots`);
  url.searchParams.set('locationId', locationId);
  url.searchParams.set('calendarId', GHL_CALENDAR_ID);
  url.searchParams.set('startTime', String(startMs));
  url.searchParams.set('endTime', String(endMs));

  console.log(`[GHL] GET /calendars/blocked-slots: ${url.toString()}`);

  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${ghlToken}`, 'Version': '2021-04-15', 'Content-Type': 'application/json' },
    });

    const responseText = await response.text();
    console.log(`[GHL] /calendars/blocked-slots status=${response.status} body=${responseText.substring(0, 600)}`);

    if (!response.ok) {
      return { events: [], rawResponse: responseText, error: `GHL /blocked-slots error: ${response.status}` };
    }

    let data: unknown;
    try { data = JSON.parse(responseText); } catch { return { events: [], rawResponse: responseText, error: "Invalid JSON from /blocked-slots" }; }

    const arr = (data as AnyRecord)?.events ?? (data as AnyRecord)?.blockedSlots;
    if (!Array.isArray(arr)) {
      if ((data as AnyRecord)?.traceId) return { events: [], rawResponse: data };
      return { events: [], rawResponse: data, error: "Unexpected shape from /blocked-slots" };
    }

    return { events: arr as GHLEvent[], rawResponse: data };
  } catch (err) {
    console.error('[GHL] Fetch /blocked-slots error:', err);
    return { events: [], error: String(err) };
  }
}

// Check overlap: eventStart < windowEnd && eventEnd > windowStart
function hasOverlap(eventStartMs: number, eventEndMs: number, windowStartMs: number, windowEndMs: number): boolean {
  return eventStartMs < windowEndMs && eventEndMs > windowStartMs;
}

// Filter events that overlap with the requested window and are not cancelled
function filterConflictingEvents(events: GHLEvent[], windowStartMs: number, windowEndMs: number): GHLEvent[] {
  const conflicts: GHLEvent[] = [];
  for (const ev of events) {
    // Skip cancelled
    if (ev.appointmentStatus?.toLowerCase() === "cancelled") continue;

    const evStartMs = parseEventTimeToMs(ev.startTime);
    const evEndMs = parseEventTimeToMs(ev.endTime);
    if (evStartMs == null || evEndMs == null) continue;

    if (hasOverlap(evStartMs, evEndMs, windowStartMs, windowEndMs)) {
      conflicts.push(ev);
    }
  }
  return conflicts;
}

function logBody(label: string, body: AnyRecord): void {
  const safe = JSON.parse(JSON.stringify(body));
  const redactKeys = (obj: AnyRecord) => {
    for (const key of Object.keys(obj)) {
      if (/secret|token|key|password|auth/i.test(key)) obj[key] = '[REDACTED]';
      else if (obj[key] && typeof obj[key] === 'object') redactKeys(obj[key] as AnyRecord);
    }
  };
  redactKeys(safe);
  console.log(`[${label}]`, JSON.stringify(safe));
}

// ============= SELF-TEST (overlap logic only, no GHL calls) =============

function runSelfTests(): { passed: boolean; results: Array<{ test: string; passed: boolean; details: string }> } {
  const results: Array<{ test: string; passed: boolean; details: string }> = [];
  const assert = (test: string, passed: boolean, details: unknown) => {
    results.push({ test, passed, details: typeof details === "string" ? details : JSON.stringify(details) });
  };

  // Test 1: hasOverlap - overlapping
  {
    const pass = hasOverlap(1000, 2000, 1500, 2500);
    assert("overlap_partial", pass, "event 1000-2000 vs window 1500-2500 should overlap");
  }

  // Test 2: hasOverlap - no overlap
  {
    const pass = !hasOverlap(1000, 2000, 3000, 4000);
    assert("no_overlap", pass, "event 1000-2000 vs window 3000-4000 should NOT overlap");
  }

  // Test 3: hasOverlap - event contains window
  {
    const pass = hasOverlap(1000, 5000, 2000, 3000);
    assert("overlap_contains", pass, "event 1000-5000 vs window 2000-3000 should overlap");
  }

  // Test 4: Daily payload normalization
  {
    const payload = { Date: "2026-02-06", booking_type: "daily", timezone: "America/New_York" };
    const { normalized } = normalizePayload(payload);
    assert("daily_normalization", normalized.booking_type === "daily" && normalized.date === "2026-02-06", normalized);
  }

  // Test 5: Hourly payload normalization with AM/PM
  {
    const payload = { booking_type: "hourly", Date: "2026-02-06", start_time: "6:00 PM", end_time: "10:00 PM", timezone: "America/New_York" };
    const { normalized } = normalizePayload(payload);
    assert("hourly_normalization_ampm", normalized.booking_type === "hourly" && normalized.date === "2026-02-06" && normalized.start_time === "18:00" && normalized.end_time === "22:00", normalized);
  }

  // Test 6: Time format variations
  {
    const tests = [
      { input: "6:00 PM", expected: "18:00" },
      { input: "6PM", expected: "18:00" },
      { input: "18:00", expected: "18:00" },
      { input: "12:30 AM", expected: "00:30" },
    ];
    let allPass = true;
    const details: string[] = [];
    for (const t of tests) {
      const result = normalizeTime(t.input);
      if (result !== t.expected) { allPass = false; details.push(`FAIL: ${t.input} -> ${result}`); }
      else details.push(`OK: ${t.input} -> ${result}`);
    }
    assert("time_formats", allPass, details.join("; "));
  }

  // Test 7: filterConflictingEvents (mock)
  {
    const mockEvents: GHLEvent[] = [
      { id: "1", startTime: "1000", endTime: "2000" },
      { id: "2", startTime: "3000", endTime: "4000" },
      { id: "3", startTime: "1500", endTime: "2500", appointmentStatus: "cancelled" },
    ];
    const conflicts = filterConflictingEvents(mockEvents, 1500, 2500);
    // Should only include event 1 (overlaps) and event 2 (no overlap), event 3 is cancelled
    // event 1: 1000-2000 overlaps 1500-2500 => YES
    // event 2: 3000-4000 vs 1500-2500 => NO (3000 >= 2500)
    const pass = conflicts.length === 1 && conflicts[0].id === "1";
    assert("filter_conflicts_mock", pass, { found: conflicts.map(e => e.id), expected: ["1"] });
  }

  // Test 8: parseEventTimeToMs - seconds to ms (string)
  {
    const result = parseEventTimeToMs("1730000000");
    const expected = 1730000000000;
    const pass = result === expected;
    assert("parse_seconds_to_ms_string", pass, `parseEventTimeToMs("1730000000") => ${result}, expected ${expected}`);
  }

  // Test 9: parseEventTimeToMs - seconds to ms (number)
  {
    const result = parseEventTimeToMs(1730000000);
    const expected = 1730000000000;
    const pass = result === expected;
    assert("parse_seconds_to_ms_number", pass, `parseEventTimeToMs(1730000000) => ${result}, expected ${expected}`);
  }

  // Test 10: parseEventTimeToMs - already ms (unchanged)
  {
    const result = parseEventTimeToMs(1730000000000);
    const expected = 1730000000000;
    const pass = result === expected;
    assert("parse_ms_unchanged", pass, `parseEventTimeToMs(1730000000000) => ${result}, expected ${expected}`);
  }

  // Test 11: Real overlap scenario (18:00-22:00 event vs 18:00-22:00 window)
  {
    const eventStart = 1730664000000; // Nov 3, 2024 18:00 ET
    const eventEnd = 1730678400000;   // Nov 3, 2024 22:00 ET
    const windowStart = 1730664000000;
    const windowEnd = 1730678400000;
    const pass = hasOverlap(eventStart, eventEnd, windowStart, windowEnd);
    assert("overlap_exact_match", pass, "18:00-22:00 event vs 18:00-22:00 window should detect conflict");
  }

  return { passed: results.every(r => r.passed), results };
}

// ============= MAIN HANDLER =============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Auth check (accept multiple header formats)
  const expectedSecret = Deno.env.get('VOICE_AGENT_WEBHOOK_SECRET');
  const secretFromCustomHeader = req.headers.get('x-voice-agent-secret');
  const authHeader = req.headers.get('authorization');
  const secretFromBearer = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const secretFromApiKeyHeader = req.headers.get('x-api-key') ?? req.headers.get('x-api_key');
  const providedSecret = (secretFromCustomHeader?.trim()) || (secretFromApiKeyHeader?.trim()) || (secretFromBearer) || null;

  if (!providedSecret || !expectedSecret || providedSecret !== expectedSecret) {
    console.log('[AUTH] Invalid or missing secret');
    // Return 200 with ok:false so GHL can save the action
    return new Response(JSON.stringify({ ok: false, available: null, error: "auth_failed", message: "Invalid or missing authentication" }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Self-test mode
  const selfTest = req.headers.get('x-self-test');
  if (selfTest === 'true') {
    console.log('[SELF-TEST] Running internal tests...');
    const testResults = runSelfTests();
    return new Response(JSON.stringify({ ok: true, self_test: testResults.passed ? 'PASS' : 'FAIL', results: testResults.results }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  // Parse body
  const rawText = await req.text().catch(() => "");
  console.log("[RAW_TEXT]", rawText.substring(0, 800));

  const parsed = parseBodyText(rawText);
  console.log(`[BODY_PARSE] mode=${parsed.mode}${parsed.error ? ` error=${parsed.error}` : ""}`);
  logBody("PARSED_BODY", parsed.body);

  const receivedKeys = collectAllKeysDeep(parsed.body);
  console.log("[RECEIVED_KEYS]", receivedKeys.slice(0, 120).join(", "));

  const { normalized, mapping } = normalizePayload(parsed.body);
  console.log("[NORMALIZED]", JSON.stringify({ normalized, mapping }));

  const receivedBodyShape: AnyRecord = { parse_mode: parsed.mode, parse_error: parsed.error ?? null, top_level_keys: isPlainObject(parsed.body) ? Object.keys(parsed.body).slice(0, 80) : [], body: parsed.body };

  // Validation
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
    return buildOkFalseResponse({ error: "validation_failed", missing_fields: missingFields, receivedBodyShape, receivedKeys, normalized, mapping: mapping as AnyRecord });
  }

  // Get GHL config
  const ghlToken = Deno.env.get("GHL_PRIVATE_INTEGRATION_TOKEN");
  const locationId = Deno.env.get("GHL_LOCATION_ID");

  if (!ghlToken || !locationId) {
    console.error("[CONFIG] Missing GHL_PRIVATE_INTEGRATION_TOKEN or GHL_LOCATION_ID");
    return buildOkFalseResponse({ error: "config_missing", missing_fields: [], receivedBodyShape: { ...receivedBodyShape, config: { hasToken: !!ghlToken, hasLocationId: !!locationId } }, receivedKeys, normalized, mapping: mapping as AnyRecord });
  }

  const tz = normalized.timezone || DEFAULT_TIMEZONE;

  // Calculate time range
  let startMs: number, endMs: number;

  if (normalized.booking_type === "daily") {
    const range = getDailyRange(normalized.date!, tz);
    if (!range) return buildOkFalseResponse({ error: "validation_failed", missing_fields: ["date (could not compute day range)"], receivedBodyShape, receivedKeys, normalized, mapping: mapping as AnyRecord });
    startMs = range.startMs;
    endMs = range.endMs;
  } else {
    const range = getHourlyRange(normalized.date!, normalized.start_time!, normalized.end_time!, tz);
    if (!range) return buildOkFalseResponse({ error: "validation_failed", missing_fields: ["time_range"], receivedBodyShape, receivedKeys, normalized, mapping: mapping as AnyRecord });
    startMs = range.startMs;
    endMs = range.endMs;
  }

  console.log(`[CHECK] type=${normalized.booking_type} date=${normalized.date} tz=${tz} windowMs=${startMs}..${endMs}`);

  // Query BOTH endpoints
  const [eventsResult, blockedResult] = await Promise.all([
    getCalendarEvents(locationId, startMs, endMs, ghlToken),
    getBlockedSlots(locationId, startMs, endMs, ghlToken),
  ]);

  // Check for upstream errors - NEVER say available=true if we can't verify
  const hasEventsError = !!eventsResult.error;
  const hasBlockedError = !!blockedResult.error;

  if (hasEventsError && hasBlockedError) {
    console.error("[UPSTREAM] Both GHL calls failed");
    return buildOkFalseResponse({
      error: "upstream_unverified",
      missing_fields: [],
      receivedBodyShape: { ...receivedBodyShape, events_error: eventsResult.error, blocked_error: blockedResult.error },
      receivedKeys,
      normalized,
      mapping: mapping as AnyRecord,
      debug: { events_raw: eventsResult.rawResponse, blocked_raw: blockedResult.rawResponse },
    });
  }

  // Even if blocked-slots fails, if events succeeded we can still check
  // But if events failed, we CANNOT trust the result
  if (hasEventsError) {
    console.error("[UPSTREAM] /calendars/events failed, cannot verify availability");
    return buildOkFalseResponse({
      error: "upstream_unverified",
      missing_fields: [],
      receivedBodyShape: { ...receivedBodyShape, events_error: eventsResult.error },
      receivedKeys,
      normalized,
      mapping: mapping as AnyRecord,
      debug: { events_raw: eventsResult.rawResponse, blocked_events_count: blockedResult.events.length },
    });
  }

  // Merge events from both sources
  const allEvents: GHLEvent[] = [...eventsResult.events, ...blockedResult.events];
  console.log(`[EVENTS] events_count=${eventsResult.events.length} blocked_count=${blockedResult.events.length} total=${allEvents.length}`);

  // Defensive logs (no secrets)
  console.log(`[DEBUG] window_start_ms=${startMs} window_end_ms=${endMs}`);
  console.log(`[DEBUG] events_count=${eventsResult.events.length} blocked_count=${blockedResult.events.length}`);

  // Log 2 sample events with original and normalized times
  if (allEvents.length > 0) {
    const samples = allEvents.slice(0, 2).map(ev => ({
      id: ev.id,
      startTime_original: ev.startTime,
      endTime_original: ev.endTime,
      startTime_ms: parseEventTimeToMs(ev.startTime),
      endTime_ms: parseEventTimeToMs(ev.endTime),
    }));
    console.log(`[DEBUG] sample_events=`, JSON.stringify(samples));
  }

  // ANTI-FALSE-POSITIVE: If calendar returned zero events, cannot verify availability
  if (eventsResult.events.length === 0 && blockedResult.events.length === 0) {
    console.warn("[ANTI-FALSE-POSITIVE] Calendar returned zero events - cannot verify availability");
    return buildOkFalseResponse({
      error: "unverified_empty_calendar",
      missing_fields: [],
      receivedBodyShape: { ...receivedBodyShape, warning: "Calendar returned no events - availability unverified" },
      receivedKeys,
      normalized,
      mapping: mapping as AnyRecord,
      debug: { 
        events_count: 0, 
        blocked_count: 0,
        window_start_ms: startMs,
        window_end_ms: endMs 
      },
    });
  }

  // Find conflicts
  const conflicts = filterConflictingEvents(allEvents, startMs, endMs);
  console.log(`[CONFLICTS] found=${conflicts.length}`);

  const available = conflicts.length === 0;

  // Build sample events for debug (include original + converted timestamps)
  const sampleEvents = conflicts.slice(0, 2).map(ev => ({
    id: ev.id ?? null,
    title: ev.title ?? null,
    startTime_original: ev.startTime ?? null,
    endTime_original: ev.endTime ?? null,
    startTime_ms: parseEventTimeToMs(ev.startTime),
    endTime_ms: parseEventTimeToMs(ev.endTime),
  }));

  const response = {
    ok: true,
    available,
    reason: available
      ? "No conflicts found - time slot is available"
      : `Found ${conflicts.length} conflict(s) in the requested window`,
    checked_calendar_id: GHL_CALENDAR_ID,
    window_start_ms: startMs,
    window_end_ms: endMs,
    timezone: tz,
    events_count: eventsResult.events.length,
    blocked_count: blockedResult.events.length,
    conflicts_count: conflicts.length,
    sample_events: sampleEvents,
    normalized,
    debug: { mapping },
  };

  console.log(`[RESULT] ok=true available=${available} conflicts=${conflicts.length}`);

  return new Response(JSON.stringify(response), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
