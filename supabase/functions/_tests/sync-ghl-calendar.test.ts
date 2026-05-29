/**
 * Tests for sync-ghl-calendar edge function
 * 
 * Test 1: Timezone conversion EST vs EDT
 * Test 2: Daily booking calculation (00:00-23:59:59)
 * Test 3: Hourly booking calculation
 * Test 4: Payload parsing (multiple formats)
 * Test 5: Missing times validation
 */

// ==================== HELPER FUNCTIONS (duplicated from index.ts for testing) ====================

function getTimeZoneOffsetMillis(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const asUTC = Date.UTC(
    parseInt(map.year, 10),
    parseInt(map.month, 10) - 1,
    parseInt(map.day, 10),
    parseInt(map.hour, 10),
    parseInt(map.minute, 10),
    parseInt(map.second, 10)
  );
  return asUTC - date.getTime();
}

function zonedDateTimeToUtcMillis(
  dateStr: string,
  timeHHmm: string,
  timeZone: string
): number | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
  
  const tm = timeHHmm.match(/^(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!tm) return null;
  const h = parseInt(tm[1], 10), mi = parseInt(tm[2], 10), s = parseInt(tm[3] || "0", 10);
  
  const utcGuess = Date.UTC(y, mo - 1, d, h, mi, s);
  const offset = getTimeZoneOffsetMillis(new Date(utcGuess), timeZone);
  return utcGuess - offset;
}

function zonedDateTimeToUtcISOString(
  dateStr: string,
  timeStr: string,
  timeZone: string
): string | null {
  const ms = zonedDateTimeToUtcMillis(dateStr, timeStr, timeZone);
  if (ms === null) return null;
  return new Date(ms).toISOString();
}

interface BookingData {
  event_date: string;
  booking_type: string;
  start_time?: string | null;
  end_time?: string | null;
}

function calculateTimes(booking: BookingData): { startTime: string; endTime: string } | null {
  if (!booking.event_date) return null;

  let startTimeStr: string;
  let endTimeStr: string;

  if (booking.booking_type === "hourly") {
    if (!booking.start_time || !booking.end_time) {
      console.log("Hourly booking missing times, cannot calculate");
      return null;
    }
    startTimeStr = booking.start_time;
    endTimeStr = booking.end_time;
  } else if (booking.booking_type === "daily") {
    startTimeStr = "00:00:00";
    endTimeStr = "23:59:59";
  } else {
    console.log(`Unknown booking_type: ${booking.booking_type}, using daily fallback`);
    startTimeStr = "00:00:00";
    endTimeStr = "23:59:59";
  }

  const startISO = zonedDateTimeToUtcISOString(booking.event_date, startTimeStr, "America/New_York");
  const endISO = zonedDateTimeToUtcISOString(booking.event_date, endTimeStr, "America/New_York");
  
  if (!startISO || !endISO) return null;

  return { startTime: startISO, endTime: endISO };
}

function extractBookingId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const obj = body as Record<string, unknown>;
  
  if (typeof obj.booking_id === "string") return obj.booking_id;
  
  if (obj.record && typeof obj.record === "object") {
    const rec = obj.record as Record<string, unknown>;
    if (typeof rec.id === "string") return rec.id;
  }
  
  if (obj.new && typeof obj.new === "object") {
    const newRec = obj.new as Record<string, unknown>;
    if (typeof newRec.id === "string") return newRec.id;
  }
  
  if (obj.data && typeof obj.data === "object") {
    const data = obj.data as Record<string, unknown>;
    if (data.record && typeof data.record === "object") {
      const rec = data.record as Record<string, unknown>;
      if (typeof rec.id === "string") return rec.id;
    }
  }
  
  return null;
}

// ==================== TEST 1: Timezone Conversion (EST vs EDT) ====================

function testTimezoneConversion() {
  console.log('\n=== TEST 1: Timezone Conversion (EST vs EDT) ===');
  
  // January (EST, offset -5)
  const janISO = zonedDateTimeToUtcISOString("2025-01-15", "14:00:00", "America/New_York");
  const janExpected = "2025-01-15T19:00:00.000Z"; // 14:00 ET + 5 hours = 19:00 UTC
  
  // July (EDT, offset -4)
  const julISO = zonedDateTimeToUtcISOString("2025-07-15", "14:00:00", "America/New_York");
  const julExpected = "2025-07-15T18:00:00.000Z"; // 14:00 ET + 4 hours = 18:00 UTC
  
  const janPass = janISO === janExpected;
  const julPass = julISO === julExpected;
  
  console.log(`January (EST): ${janPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Input: 2025-01-15 14:00:00 ET`);
  console.log(`  Got: ${janISO}`);
  console.log(`  Expected: ${janExpected}`);
  
  console.log(`July (EDT): ${julPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Input: 2025-07-15 14:00:00 ET`);
  console.log(`  Got: ${julISO}`);
  console.log(`  Expected: ${julExpected}`);
  
  // Verify they differ by 1 hour (EST vs EDT)
  if (janISO && julISO) {
    const janMs = new Date(janISO).getTime();
    const julMs = new Date(julISO).getTime();
    const janHour = new Date(janISO).getUTCHours();
    const julHour = new Date(julISO).getUTCHours();
    const hourDiff = janHour - julHour;
    const diffPass = hourDiff === 1; // EST is 1 hour later than EDT in UTC
    console.log(`Hour difference (EST should be 1 hour later in UTC): ${diffPass ? 'PASS ✅' : 'FAIL ❌'}`);
    console.log(`  Jan UTC hour: ${janHour}, Jul UTC hour: ${julHour}, Diff: ${hourDiff}`);
    return janPass && julPass && diffPass;
  }
  
  return janPass && julPass;
}

// ==================== TEST 2: Daily Booking (00:00 - 23:59:59) ====================

function testDailyBooking() {
  console.log('\n=== TEST 2: Daily Booking (00:00-23:59:59) ===');
  
  const booking: BookingData = {
    event_date: "2025-02-10",
    booking_type: "daily",
  };
  
  const times = calculateTimes(booking);
  
  if (!times) {
    console.log('FAIL ❌: calculateTimes returned null');
    return false;
  }
  
  // Verify startTime is 00:00:00 ET → UTC
  // Feb 10 is EST, so 00:00:00 ET = 05:00:00 UTC
  const startExpected = "2025-02-10T05:00:00.000Z";
  // 23:59:59 ET = 04:59:59 UTC next day
  const endExpected = "2025-02-11T04:59:59.000Z";
  
  const startPass = times.startTime === startExpected;
  const endPass = times.endTime === endExpected;
  
  console.log(`Start time: ${startPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Got: ${times.startTime}`);
  console.log(`  Expected: ${startExpected}`);
  
  console.log(`End time: ${endPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Got: ${times.endTime}`);
  console.log(`  Expected: ${endExpected}`);
  
  // Verify ends with "Z" (UTC)
  const startUTCPass = times.startTime.endsWith("Z");
  const endUTCPass = times.endTime.endsWith("Z");
  console.log(`Start ends with Z: ${startUTCPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`End ends with Z: ${endUTCPass ? 'PASS ✅' : 'FAIL ❌'}`);
  
  return startPass && endPass && startUTCPass && endUTCPass;
}

// ==================== TEST 3: Hourly Booking ====================

function testHourlyBooking() {
  console.log('\n=== TEST 3: Hourly Booking ===');
  
  const booking: BookingData = {
    event_date: "2025-03-20",
    booking_type: "hourly",
    start_time: "18:00:00",
    end_time: "22:00:00",
  };
  
  const times = calculateTimes(booking);
  
  if (!times) {
    console.log('FAIL ❌: calculateTimes returned null');
    return false;
  }
  
  // March 20 is EDT, so 18:00:00 ET = 22:00:00 UTC
  const startExpected = "2025-03-20T22:00:00.000Z";
  const endExpected = "2025-03-21T02:00:00.000Z"; // 22:00 ET = 02:00 UTC next day
  
  const startPass = times.startTime === startExpected;
  const endPass = times.endTime === endExpected;
  
  console.log(`Start time (18:00 ET): ${startPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Got: ${times.startTime}`);
  console.log(`  Expected: ${startExpected}`);
  
  console.log(`End time (22:00 ET): ${endPass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Got: ${times.endTime}`);
  console.log(`  Expected: ${endExpected}`);
  
  return startPass && endPass;
}

// ==================== TEST 4: Payload Parsing ====================

function testExtractBookingId() {
  console.log('\n=== TEST 4: Payload Parsing (extractBookingId) ===');
  
  const test1 = extractBookingId({ booking_id: "abc-123" });
  const test2 = extractBookingId({ record: { id: "def-456" } });
  const test3 = extractBookingId({ new: { id: "ghi-789" } });
  const test4 = extractBookingId({ data: { record: { id: "jkl-012" } } });
  const test5 = extractBookingId({});
  const test6 = extractBookingId(null);
  
  const pass1 = test1 === "abc-123";
  const pass2 = test2 === "def-456";
  const pass3 = test3 === "ghi-789";
  const pass4 = test4 === "jkl-012";
  const pass5 = test5 === null;
  const pass6 = test6 === null;
  
  console.log(`{ booking_id: "..." }: ${pass1 ? 'PASS ✅' : 'FAIL ❌'} (got: ${test1})`);
  console.log(`{ record: { id: "..." } }: ${pass2 ? 'PASS ✅' : 'FAIL ❌'} (got: ${test2})`);
  console.log(`{ new: { id: "..." } }: ${pass3 ? 'PASS ✅' : 'FAIL ❌'} (got: ${test3})`);
  console.log(`{ data: { record: { id: "..." } } }: ${pass4 ? 'PASS ✅' : 'FAIL ❌'} (got: ${test4})`);
  console.log(`{}: ${pass5 ? 'PASS ✅' : 'FAIL ❌'} (got: ${test5})`);
  console.log(`null: ${pass6 ? 'PASS ✅' : 'FAIL ❌'} (got: ${test6})`);
  
  return pass1 && pass2 && pass3 && pass4 && pass5 && pass6;
}

// ==================== TEST 5: Missing Times Validation ====================

function testMissingTimes() {
  console.log('\n=== TEST 5: Missing Times Validation ===');
  
  const booking: BookingData = {
    event_date: "2025-02-10",
    booking_type: "hourly",
    start_time: null,
    end_time: null,
  };
  
  const times = calculateTimes(booking);
  
  const pass = times === null;
  console.log(`Hourly without times returns null: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Got: ${times}`);
  
  return pass;
}

// ==================== RUN TESTS ====================

console.log('========================================');
console.log('sync-ghl-calendar Unit Tests');
console.log('========================================');

const test1Pass = testTimezoneConversion();
const test2Pass = testDailyBooking();
const test3Pass = testHourlyBooking();
const test4Pass = testExtractBookingId();
const test5Pass = testMissingTimes();

console.log('\n========================================');
console.log('SUMMARY');
console.log('========================================');
console.log(`Test 1 (Timezone Conversion): ${test1Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 2 (Daily Booking): ${test2Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 3 (Hourly Booking): ${test3Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 4 (Payload Parsing): ${test4Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 5 (Missing Times): ${test5Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Overall: ${test1Pass && test2Pass && test3Pass && test4Pass && test5Pass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);

console.log('\n========================================');
console.log('NOTES');
console.log('========================================');
console.log('- Daily bookings block entire day (00:00-23:59:59 ET)');
console.log('- All times converted to UTC ISO format (ends with "Z")');
console.log('- EST offset: -5 hours, EDT offset: -4 hours');
console.log('- Hourly bookings without times return null (no appointment created)');
console.log('- Payload parsing supports multiple webhook formats');
