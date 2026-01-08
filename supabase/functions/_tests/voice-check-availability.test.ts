/**
 * Tests for voice-check-availability edge function
 * 
 * Test 1: Daily range conversion to epoch millis
 * Test 2: Mock test - events > 0 → occupied true; events = [] → occupied false
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

// ==================== RUN TESTS ====================

console.log('========================================');
console.log('voice-check-availability Unit Tests');
console.log('========================================');

const test1Pass = testDailyRangeConversion();
const test2Pass = testOccupiedLogic();
const test3Pass = testParseEventTime();

console.log('\n========================================');
console.log('SUMMARY');
console.log('========================================');
console.log(`Test 1 (Daily Range): ${test1Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 2 (Occupied Logic): ${test2Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 3 (Parse Event Time): ${test3Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Overall: ${test1Pass && test2Pass && test3Pass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);

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
