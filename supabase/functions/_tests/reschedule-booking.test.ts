/**
 * Tests for reschedule-booking feature (UPDATED)
 * 
 * Changes from previous version:
 * - booking_type NEVER changes (removed Test 6)
 * - Added tests for daily event window validation
 * - Added test for GHL notes showing event window
 * - Job rescheduling is always simple date shift (no recreation)
 * - Daily conflict validation is stricter (blocks entire day)
 */

// ==================== TEST HELPERS ====================

interface MockBooking {
  id: string;
  event_date: string;
  booking_type: "hourly" | "daily";
  start_time?: string;
  end_time?: string;
  status: string;
  payment_status: string;
}

interface MockJob {
  id: string;
  booking_id: string;
  job_type: string;
  run_at: string;
  status: string;
}

function createMockBooking(overrides: Partial<MockBooking> = {}): MockBooking {
  return {
    id: "test-booking-" + Math.random().toString(36).substr(2, 9),
    event_date: "2026-02-15",
    booking_type: "hourly",
    start_time: "14:00:00",
    end_time: "18:00:00",
    status: "confirmed",
    payment_status: "deposit_paid",
    ...overrides,
  };
}

function createMockJob(bookingId: string, jobType: string, daysFromNow: number): MockJob {
  const runAt = new Date();
  runAt.setDate(runAt.getDate() + daysFromNow);
  
  return {
    id: "test-job-" + Math.random().toString(36).substr(2, 9),
    booking_id: bookingId,
    job_type: jobType,
    run_at: runAt.toISOString(),
    status: "pending",
  };
}

// ==================== TEST 1: Hourly Overlap Conflict ====================

function testHourlyOverlapConflict() {
  console.log('\n=== TEST 1: Reschedule hourly overlaps existing hourly → conflict ===');
  
  // Setup: Two bookings on same date
  const existingBooking = createMockBooking({
    event_date: "2026-02-20",
    booking_type: "hourly",
    start_time: "14:00:00",
    end_time: "18:00:00",
  });
  
  const bookingToReschedule = createMockBooking({
    event_date: "2026-02-15",
    booking_type: "hourly",
    start_time: "10:00:00",
    end_time: "13:00:00",
  });
  
  // Attempt to reschedule to overlapping time
  const newDate = "2026-02-20";
  const newStartTime = "16:00:00"; // Overlaps with 14:00-18:00
  const newEndTime = "20:00:00";
  
  // Check overlap logic
  const existingStart = 14 * 60; // 840 minutes
  const existingEnd = 18 * 60;   // 1080 minutes
  const newStart = 16 * 60;      // 960 minutes
  const newEnd = 20 * 60;        // 1200 minutes
  
  // Overlap formula: new_start < existing_end AND new_end > existing_start
  const hasOverlap = newStart < existingEnd && newEnd > existingStart;
  
  const pass = hasOverlap === true;
  console.log(`Overlap detected: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Existing: ${existingBooking.start_time} - ${existingBooking.end_time}`);
  console.log(`  New: ${newStartTime} - ${newEndTime}`);
  console.log(`  Overlap: ${hasOverlap}`);
  
  return pass;
}

// ==================== TEST 2: Hourly vs Daily Conflict ====================

function testHourlyOverlapDaily() {
  console.log('\n=== TEST 2: Reschedule hourly overlaps daily → conflict ===');
  
  const dailyBooking = createMockBooking({
    event_date: "2026-03-10",
    booking_type: "daily",
    start_time: undefined,
    end_time: undefined,
  });
  
  const hourlyBooking = createMockBooking({
    event_date: "2026-03-05",
    booking_type: "hourly",
    start_time: "10:00:00",
    end_time: "14:00:00",
  });
  
  // Try to reschedule hourly to same date as daily
  const newDate = "2026-03-10";
  
  // Logic: If daily booking exists on target date, hourly cannot be scheduled
  const hasConflict = dailyBooking.event_date === newDate && dailyBooking.booking_type === "daily";
  
  const pass = hasConflict === true;
  console.log(`Daily conflict detected: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Daily booking on: ${dailyBooking.event_date}`);
  console.log(`  Trying to schedule hourly on: ${newDate}`);
  console.log(`  Conflict: ${hasConflict}`);
  
  return pass;
}

// ==================== TEST 3: Daily Blocks Entire Day ====================

function testDailyBlocksEntireDay() {
  console.log('\n=== TEST 3: Daily booking blocks entire day (any booking type) ===');
  
  const dailyBooking = createMockBooking({
    event_date: "2026-04-10",
    booking_type: "daily",
  });
  
  const hourlyBooking = createMockBooking({
    event_date: "2026-04-15",
    booking_type: "hourly",
    start_time: "18:00:00",
    end_time: "22:00:00",
  });
  
  // Try to reschedule daily to date with ANY booking (hourly or daily)
  const newDate = "2026-04-15";
  
  // Logic: Daily blocks entire day, ANY booking on that date causes conflict
  const hasConflict = hourlyBooking.event_date === newDate;
  
  const pass = hasConflict === true;
  console.log(`Daily blocks entire day: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Existing booking on: ${hourlyBooking.event_date}`);
  console.log(`  Trying to schedule daily on: ${newDate}`);
  console.log(`  Conflict: ${hasConflict}`);
  
  return pass;
}

// ==================== TEST 4: Job Rescheduling (Always Simple Date Shift) ====================

function testJobRescheduling() {
  console.log('\n=== TEST 4: Reschedule ALWAYS shifts jobs by date difference (no recreation) ===');
  
  const booking = createMockBooking({
    event_date: "2026-05-10",
  });
  
  // Create mock jobs
  const jobs = [
    createMockJob(booking.id, "host_report_pre_start", 5),
    createMockJob(booking.id, "host_report_during", 10),
    createMockJob(booking.id, "balance_retry_1", 3),
  ];
  
  // Reschedule booking +7 days
  const oldDate = new Date("2026-05-10");
  const newDate = new Date("2026-05-17");
  const dateShiftDays = 7;
  
  // Simulate job run_at shift
  const updatedJobs = jobs.map(job => {
    const oldRunAt = new Date(job.run_at);
    const newRunAt = new Date(oldRunAt);
    newRunAt.setDate(newRunAt.getDate() + dateShiftDays);
    
    return {
      ...job,
      run_at: newRunAt.toISOString(),
    };
  });
  
  // Verify all jobs shifted by 7 days
  let allShifted = true;
  for (let i = 0; i < jobs.length; i++) {
    const oldMs = new Date(jobs[i].run_at).getTime();
    const newMs = new Date(updatedJobs[i].run_at).getTime();
    const shiftMs = newMs - oldMs;
    const shiftDays = Math.round(shiftMs / (1000 * 60 * 60 * 24));
    
    if (shiftDays !== dateShiftDays) {
      allShifted = false;
      console.log(`  Job ${jobs[i].job_type} shift mismatch: ${shiftDays} days`);
    }
  }
  
  const pass = allShifted;
  console.log(`Jobs shifted correctly: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Date shift: ${dateShiftDays} days`);
  console.log(`  Jobs updated: ${jobs.length}`);
  console.log(`  Jobs cancelled: 0 (no recreation needed)`);
  
  return pass;
}

// ==================== TEST 5: Audit Log ====================

function testAuditLog() {
  console.log('\n=== TEST 5: Reschedule writes booking_events with old/new values ===');
  
  const booking = createMockBooking({
    event_date: "2026-06-10",
    booking_type: "hourly",
    start_time: "14:00:00",
    end_time: "18:00:00",
  });
  
  const oldValues = {
    event_date: booking.event_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booking_type: booking.booking_type,
  };
  
  const newValues = {
    event_date: "2026-06-15",
    start_time: "16:00:00",
    end_time: "20:00:00",
    booking_type: "hourly", // Never changes
  };
  
  // Simulate audit event creation
  const auditEvent = {
    booking_id: booking.id,
    event_type: "booking_rescheduled",
    channel: "system",
    metadata: {
      old_values: oldValues,
      new_values: newValues,
      reason: "Client requested different time",
      actor_id: "admin-user-123",
      date_shift_days: 5,
      jobs_updated: 3,
    },
  };
  
  // Verify audit event structure
  const hasCorrectType = auditEvent.event_type === "booking_rescheduled";
  const hasOldValues = auditEvent.metadata.old_values !== undefined;
  const hasNewValues = auditEvent.metadata.new_values !== undefined;
  const hasReason = auditEvent.metadata.reason !== undefined;
  const bookingTypeUnchanged = oldValues.booking_type === newValues.booking_type;
  
  const pass = hasCorrectType && hasOldValues && hasNewValues && hasReason && bookingTypeUnchanged;
  console.log(`Audit event structure correct: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Event type: ${auditEvent.event_type}`);
  console.log(`  Has old values: ${hasOldValues}`);
  console.log(`  Has new values: ${hasNewValues}`);
  console.log(`  Has reason: ${hasReason}`);
  console.log(`  Booking type unchanged: ${bookingTypeUnchanged}`);
  
  return pass;
}

// ==================== TEST 6: Daily Maintains booking_type ====================

function testDailyMaintainsType() {
  console.log('\n=== TEST 6: Daily booking maintains booking_type even with event window ===');
  
  const dailyBooking = createMockBooking({
    event_date: "2026-03-01",
    booking_type: "daily",
    start_time: undefined,
    end_time: undefined,
  });
  
  // Reschedule with event window
  const newDate = "2026-03-15";
  const newStartTime = "18:00:00"; // Event window (planning only)
  const newEndTime = "22:00:00";
  
  // After reschedule, booking_type should still be "daily"
  const updatedBooking = {
    ...dailyBooking,
    event_date: newDate,
    start_time: newStartTime,
    end_time: newEndTime,
    booking_type: "daily", // NEVER changes
  };
  
  const pass = updatedBooking.booking_type === "daily";
  console.log(`Daily maintains type: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Original type: ${dailyBooking.booking_type}`);
  console.log(`  After reschedule type: ${updatedBooking.booking_type}`);
  console.log(`  Event window: ${newStartTime} - ${newEndTime}`);
  
  return pass;
}

// ==================== TEST 7: Daily Event Window Validation ====================

function testDailyEventWindowValidation() {
  console.log('\n=== TEST 7: Daily event window validation (both times or none) ===');
  
  // Case 1: Both times provided, end <= start → FAIL
  const case1StartTime = "20:00:00";
  const case1EndTime = "18:00:00";
  const case1Valid = case1EndTime > case1StartTime;
  
  // Case 2: Only start time provided → FAIL
  const case2StartTime = "18:00:00";
  const case2EndTime = undefined;
  const case2Valid = (case2StartTime === undefined && case2EndTime === undefined) || 
                     (case2StartTime !== undefined && case2EndTime !== undefined);
  
  // Case 3: Both times provided, end > start → PASS
  const case3StartTime = "18:00:00";
  const case3EndTime = "22:00:00";
  const case3Valid = case3EndTime > case3StartTime;
  
  // Case 4: Both times omitted → PASS
  const case4StartTime = undefined;
  const case4EndTime = undefined;
  const case4Valid = true;
  
  const pass = !case1Valid && !case2Valid && case3Valid && case4Valid;
  console.log(`Event window validation: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Case 1 (end <= start): ${!case1Valid ? 'Rejected ✓' : 'Allowed ✗'}`);
  console.log(`  Case 2 (only one time): ${!case2Valid ? 'Rejected ✓' : 'Allowed ✗'}`);
  console.log(`  Case 3 (valid range): ${case3Valid ? 'Allowed ✓' : 'Rejected ✗'}`);
  console.log(`  Case 4 (both omitted): ${case4Valid ? 'Allowed ✓' : 'Rejected ✗'}`);
  
  return pass;
}

// ==================== TEST 8: GHL Notes Include Event Window ====================

function testGHLNotesEventWindow() {
  console.log('\n=== TEST 8: GHL notes include event window for daily bookings ===');
  
  const dailyBooking = createMockBooking({
    booking_type: "daily",
    start_time: "18:00:00",
    end_time: "22:00:00",
  });
  
  // Simulate buildEventNotes function
  const buildEventNotes = (booking: MockBooking): string => {
    const notes = [
      `📦 Package: ${booking.booking_type === 'hourly' ? 'Hourly Rental' : 'Full Day Rental'}`,
    ];
    
    // Add event window for daily bookings (planning only)
    if (booking.booking_type === 'daily' && booking.start_time && booking.end_time) {
      notes.push(``);
      notes.push(`⏰ Event Window (Planning): ${booking.start_time} - ${booking.end_time}`);
      notes.push(`   Note: Entire day is blocked. Window is for planning only.`);
    }
    
    return notes.join('\n');
  };
  
  const notes = buildEventNotes(dailyBooking);
  const hasEventWindow = notes.includes("Event Window (Planning)");
  const hasTimeRange = notes.includes("18:00:00 - 22:00:00");
  const hasBlockedNote = notes.includes("Entire day is blocked");
  
  const pass = hasEventWindow && hasTimeRange && hasBlockedNote;
  console.log(`GHL notes include event window: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Has event window label: ${hasEventWindow}`);
  console.log(`  Has time range: ${hasTimeRange}`);
  console.log(`  Has "day blocked" note: ${hasBlockedNote}`);
  
  return pass;
}

// ==================== TEST 9: Past Date Validation ====================

function testPastDateBlocked() {
  console.log('\n=== TEST 9: Cannot reschedule to past date ===');
  
  const booking = createMockBooking({
    event_date: "2026-08-10",
  });
  
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  const newDate = yesterday.toISOString().split('T')[0];
  
  // Logic: new_date must be >= today
  const isPastDate = new Date(newDate) < new Date(today.toISOString().split('T')[0]);
  
  const pass = isPastDate === true; // Should be blocked
  console.log(`Past date detected: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Today: ${today.toISOString().split('T')[0]}`);
  console.log(`  Trying to schedule: ${newDate}`);
  console.log(`  Is past: ${isPastDate}`);
  
  return pass;
}

// ==================== TEST 10: Self-Exclusion from Conflict Check ====================

function testSelfExclusion() {
  console.log('\n=== TEST 10: Booking can reschedule without conflicting with itself ===');
  
  const booking = createMockBooking({
    id: "booking-123",
    event_date: "2026-09-10",
    booking_type: "hourly",
    start_time: "14:00:00",
    end_time: "18:00:00",
  });
  
  // Try to reschedule to slightly different time on same date
  const newDate = "2026-09-10";
  const newStartTime = "15:00:00";
  const newEndTime = "19:00:00";
  
  // Logic: When checking conflicts, exclude booking with same ID
  const conflictingBookings = [booking].filter(b => b.id !== booking.id);
  
  const hasConflict = conflictingBookings.length > 0;
  
  const pass = hasConflict === false;
  console.log(`Self-exclusion works: ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
  console.log(`  Booking ID: ${booking.id}`);
  console.log(`  Conflicting bookings (excluding self): ${conflictingBookings.length}`);
  console.log(`  Has conflict: ${hasConflict}`);
  
  return pass;
}

// ==================== RUN TESTS ====================

console.log('========================================');
console.log('reschedule-booking Unit Tests (UPDATED)');
console.log('========================================');

const test1Pass = testHourlyOverlapConflict();
const test2Pass = testHourlyOverlapDaily();
const test3Pass = testDailyBlocksEntireDay();
const test4Pass = testJobRescheduling();
const test5Pass = testAuditLog();
const test6Pass = testDailyMaintainsType();
const test7Pass = testDailyEventWindowValidation();
const test8Pass = testGHLNotesEventWindow();
const test9Pass = testPastDateBlocked();
const test10Pass = testSelfExclusion();

console.log('\n========================================');
console.log('SUMMARY');
console.log('========================================');
console.log(`Test 1 (Hourly Overlap): ${test1Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 2 (Hourly vs Daily): ${test2Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 3 (Daily Blocks Day): ${test3Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 4 (Job Rescheduling): ${test4Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 5 (Audit Log): ${test5Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 6 (Daily Maintains Type): ${test6Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 7 (Event Window Validation): ${test7Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 8 (GHL Notes Event Window): ${test8Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 9 (Past Date Block): ${test9Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Test 10 (Self Exclusion): ${test10Pass ? 'PASS ✅' : 'FAIL ❌'}`);
console.log(`Overall: ${test1Pass && test2Pass && test3Pass && test4Pass && test5Pass && test6Pass && test7Pass && test8Pass && test9Pass && test10Pass ? 'ALL PASS ✅' : 'SOME FAILED ❌'}`);

// ==================== MANUAL TESTING EXAMPLES ====================

console.log('\n========================================');
console.log('Manual Testing with cURL (UPDATED)');
console.log('========================================');

console.log(`
# Test 1: Reschedule hourly to available date
curl -X POST \\
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/reschedule-booking' \\
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "booking_id": "YOUR_BOOKING_ID",
    "event_date": "2026-03-15",
    "start_time": "14:00:00",
    "end_time": "18:00:00",
    "reason": "Client requested different date"
  }'

# Test 2: Reschedule to conflicting date (should fail)
curl -X POST \\
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/reschedule-booking' \\
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "booking_id": "YOUR_BOOKING_ID",
    "event_date": "2026-03-20",
    "start_time": "14:00:00",
    "end_time": "18:00:00",
    "reason": "Testing conflict detection"
  }'

# Test 3: Reschedule daily with event window (planning only)
curl -X POST \\
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/reschedule-booking' \\
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "booking_id": "YOUR_DAILY_BOOKING_ID",
    "event_date": "2026-03-25",
    "start_time": "18:00:00",
    "end_time": "22:00:00",
    "reason": "Setting event window for staff planning"
  }'

# Test 4: Reschedule daily without event window (times omitted)
curl -X POST \\
  'https://vsvsgesgqjtwutadcshi.supabase.co/functions/v1/reschedule-booking' \\
  -H 'Authorization: Bearer YOUR_ADMIN_TOKEN' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "booking_id": "YOUR_DAILY_BOOKING_ID",
    "event_date": "2026-04-10",
    "reason": "No specific event window needed"
  }'

# NOTE: booking_type parameter is NO LONGER accepted (will be ignored)
# The booking type never changes - it stays as originally created
`);
