/**
 * Tests for voice-check-availability edge function
 * 
 * Test 1: Daily range conversion to epoch millis
 * Test 2: Mock test - events > 0 → occupied true; events = [] → occupied false
 * Test 3: parseEventTimeToMs (seconds vs milliseconds)
 * Test 4: Empty body handling (GHL Voice Agent scenario)
 * Test 5: Query params fallback (when body is empty)
 * 
 * NOTE: GHL Voice Agent sometimes calls custom actions with empty payload.
 * The function must handle this gracefully and never confirm availability
 * when payload is missing (ok:false, available:null).
 */

// ==================== TEST 1: Daily Range Conversion ====================

function toEpochMillis(dateStr: string, timeStr: string): number {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hours, minutes, 0, 0));
  const easternOffset = 5 * 60 * 60 * 1000;
  return date.getTime() + easternOffset;
}

function getDailyRange(dateStr: string): { startMs: number; endMs: number } {
  const startMs = toEpochMillis(dateStr, '00:00');
  const endMs = toEpochMillis(dateStr, '23:59') + (59 * 1000) + 999;
  return { startMs, endMs };
}

function testDailyRangeConversion() {
  console.log('\n=== TEST 1: Daily Range Conversion ===');
  
  const testDate = '2025-01-20';
  const range = getDailyRange(testDate);
  
  // Verify the range spans ~24 hours
  const durationMs = range.endMs - range.startMs;
  const durationHours = durationMs / (1000 * 60 * 60);
  
  console.log(`Date: ${testDate}`);
  console.log(`Start (ms): ${range.startMs}`);
  console.log(`End (ms): ${range.endMs}`);
  console.log(`Duration: ${durationHours.toFixed(2)} hours`);
  
  // Should be approximately 24 hours (23:59:59.999 - 00:00:00)
  const isValid = durationHours >= 23.99 && durationHours < 24.01;
  
  console.log(`Result: ${isValid ? 'PASS ✅' : 'FAIL ❌'}`);
  return isValid;
}

// ==================== TEST 2: Mock Occupied Logic ====================

function checkOccupied(events: unknown[]): boolean {
  return events.length > 0;
}

function testOccupiedLogic() {
  console.log('\n=== TEST 2: Occupied Logic ===');
  
  // Test case: events array with items → occupied
  const eventsWithConflicts = [
    { id: '1', title: 'Birthday Party', startTime: '2025-01-20T14:00:00' },
    { id: '2', title: 'Corporate Event', startTime: '2025-01-20T18:00:00' },
  ];
  
  const result1 = checkOccupied(eventsWithConflicts);
  const pass1 = result1 === true;
  console.log(`Events with conflicts (${eventsWithConflicts.length} items): occupied=${result1} → ${pass1 ? 'PASS ✅' : 'FAIL ❌'}`);
  
  // Test case: empty events array → not occupied
  const noEvents: unknown[] = [];
  const result2 = checkOccupied(noEvents);
  const pass2 = result2 === false;
  console.log(`No events (0 items): occupied=${result2} → ${pass2 ? 'PASS ✅' : 'FAIL ❌'}`);
  
  return pass1 && pass2;
}

// ==================== TEST 3: parseEventTimeToMs ====================

function parseEventTimeToMs(val: unknown): number | null {
  if (typeof val === "number") {
    return val < 1e12 ? val * 1000 : val;
  }
  if (typeof val === "string") {
    if (/^\d+$/.test(val)) {
      const num = parseInt(val, 10);
      return num < 1e12 ? num * 1000 : num;
    }
    const ms = Date.parse(val);
    return isNaN(ms) ? null : ms;
  }
  return null;
}

function testParseEventTime() {
  console.log('\n=== TEST 3: parseEventTimeToMs (seconds vs ms) ===');
  
  const tests = [
    { input: 1730000000, expected: 1730000000000, label: "number seconds" },
    { input: "1730000000", expected: 1730000000000, label: "string seconds" },
    { input: 1730000000000, expected: 1730000000000, label: "number ms" },
    { input: "2024-10-27T12:00:00Z", expected: Date.parse("2024-10-27T12:00:00Z"), label: "ISO string" },
  ];
  
  let allPass = true;
  for (const t of tests) {
    const result = parseEventTimeToMs(t.input);
    const pass = result === t.expected;
    if (!pass) allPass = false;
    console.log(`${t.label}: ${pass ? 'PASS ✅' : 'FAIL ❌'} (got ${result}, expected ${t.expected})`);
  }
  
  return allPass;
}

// ==================== TEST 4: Empty Body Handling ====================

type AnyRecord = Record<string, unknown>;

function isPayloadEmpty(parsed: { body: AnyRecord; mode: string }): boolean {
  if (parsed.mode === "empty") return true;
  
  if (parsed.mode === "json") {
    const topKeys = Object.keys(parsed.body);
    if (topKeys.length === 0) return true;
    
    const usefulKeys = topKeys.filter(k => !k.startsWith('_'));
    if (usefulKeys.length === 0) return true;
  }
  
  return false;
}

function testEmptyBodyHandling() {
  console.log('\n=== TEST 4: Empty Body Handling ===');
  
  // Test empty mode
  const emptyParsed = { body: {}, mode: "empty" };
  const isEmpty1 = isPayloadEmpty(emptyParsed);
  const pass1 = isEmpty1 === true;
  console.log(`Empty mode detected: ${pass1 ? 'PASS ✅' : 'FAIL ❌'} (result: ${isEmpty1})`);
  
  // Test JSON mode with only internal keys
  const internalKeysParsed = { body: { _raw: "test", _value: 123 }, mode: "json" };
  const isEmpty2 = isPayloadEmpty(internalKeysParsed);
  const pass2 = isEmpty2 === true;
  console.log(`JSON with internal keys only: ${pass2 ? 'PASS ✅' : 'FAIL ❌'} (result: ${isEmpty2})`);
  
  // Test JSON mode with actual data (should NOT be empty)
  const validParsed = { body: { booking_type: "hourly", date: "2026-02-06" }, mode: "json" };
  const isEmpty3 = isPayloadEmpty(validParsed);
  const pass3 = isEmpty3 === false;
  console.log(`JSON with valid data (not empty): ${pass3 ? 'PASS ✅' : 'FAIL ❌'} (result: ${isEmpty3})`);
  
  return pass1 && pass2 && pass3;
}

// ==================== TEST 5: Query Params Fallback ====================

function extractFromQueryParams(url: string): AnyRecord {
  const urlObj = new URL(url);
  const params = urlObj.searchParams;
  
  const result: AnyRecord = {};
  
  const bt = params.get('booking_type') || params.get('bookingType') || params.get('Booking Type');
  if (bt) result.booking_type = bt;
  
  const date = params.get('date') || params.get('Date');
  if (date) result.date = date;
  
  const st = params.get('start_time') || params.get('startTime') || params.get('Start Time');
  if (st) result.start_time = st;
  
  const et = params.get('end_time') || params.get('endTime') || params.get('End Time');
  if (et) result.end_time = et;
  
  const tz = params.get('timezone') || params.get('tz') || params.get('Timezone');
  if (tz) result.timezone = tz;
  
  return result;
}

function testQueryParamsFallback() {
  console.log('\n=== TEST 5: Query Params Fallback ===');
  
  // Test standard format
  const testUrl1 = "https://example.com?booking_type=hourly&date=2026-02-06&start_time=18:00&end_time=22:00";
  const extracted1 = extractFromQueryParams(testUrl1);
  
  const pass1 = extracted1.booking_type === "hourly";
  const pass2 = extracted1.date === "2026-02-06";
  const pass3 = extracted1.start_time === "18:00";
  
  console.log(`Booking type extracted: ${pass1 ? 'PASS ✅' : 'FAIL ❌'} (${extracted1.booking_type})`);
  console.log(`Date extracted: ${pass2 ? 'PASS ✅' : 'FAIL ❌'} (${extracted1.date})`);
  console.log(`Start time extracted: ${pass3 ? 'PASS ✅' : 'FAIL ❌'} (${extracted1.start_time})`);
  
  // Test aliases
  const testUrl2 = "https://example.com?bookingType=daily&Date=2026-02-06&tz=America%2FNew_York";
  const extracted2 = extractFromQueryParams(testUrl2);
  
  const pass4 = extracted2.booking_type === "daily";
  const pass5 = extracted2.date === "2026-02-06";
  const pass6 = extracted2.timezone === "America/New_York";
  
  console.log(`Booking type alias: ${pass4 ? 'PASS ✅' : 'FAIL ❌'} (${extracted2.booking_type})`);
  console.log(`Date alias: ${pass5 ? 'PASS ✅' : 'FAIL ❌'} (${extracted2.date})`);
  console.log(`Timezone alias: ${pass6 ? 'PASS ✅' : 'FAIL ❌'} (${extracted2.timezone})`);
  
  return pass1 && pass2 && pass3 && pass4 && pass5 && pass6;
}

// ==================== RUN TESTS ====================

console.log('========================================');
console.log('voice-check-availability Unit Tests');
console.log('========================================');

const test1Pass = testDailyRangeConversion();
const test2Pass = testOccupiedLogic();
const test3Pass = testParseEventTime();
const test4Pass = testEmptyBodyHandling();
const test5Pass = testQueryParamsFallback();

console.log('\n========================================');
console.log('SUMMARY');
console.log('========================================');
console.log(`Test 1 (Daily Range): ${test1Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 2 (Occupied Logic): ${test2Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 3 (Parse Event Time): ${test3Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 4 (Empty Body Handling): ${test4Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 5 (Query Params Fallback): ${test5Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Overall: ${test1Pass && test2Pass && test3Pass && test4Pass && test5Pass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);

// ==================== cURL EXAMPLES ====================

console.log('\n========================================');
console.log('cURL Examples for Testing');
console.log('========================================');

console.log(`
# Daily booking check
curl -X POST \\
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability' \\
  -H 'Content-Type: application/json' \\
  -H 'x-voice-agent-secret: YOUR_VOICE_AGENT_WEBHOOK_SECRET' \\
  -d '{
    "booking_type": "daily",
    "date": "2025-01-25",
    "timezone": "America/New_York"
  }'

# Hourly booking check
curl -X POST \\
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/voice-check-availability' \\
  -H 'Content-Type: application/json' \\
  -H 'x-voice-agent-secret: YOUR_VOICE_AGENT_WEBHOOK_SECRET' \\
  -d '{
    "booking_type": "hourly",
    "date": "2025-01-25",
    "start_time": "14:00",
    "end_time": "18:00",
    "timezone": "America/New_York"
  }'
`);
