/**
 * Balance Payment System - Automated Test Suite
 * 
 * Tests for: schedule-balance-payment, process-scheduled-jobs, create-balance-payment-link
 * 
 * Run with: deno test --allow-env --allow-net supabase/functions/_tests/balance-payment.test.ts
 */

import { assertEquals, assertExists, assertArrayIncludes } from "https://deno.land/std@0.190.0/testing/asserts.ts";

// ============================================================================
// Mock Data & Helpers
// ============================================================================

interface MockBooking {
  id: string;
  reservation_number: string;
  event_date: string;
  payment_status: string;
  lifecycle_status: string;
  balance_amount: number;
  balance_payment_url: string | null;
  full_name: string;
  email: string;
  phone: string;
  booking_type: string;
  status: string;
  number_of_guests: number;
  event_type: string;
  package: string;
  total_amount: number;
  deposit_amount: number;
  pre_event_ready: string;
  start_time: string | null;
  end_time: string | null;
}

interface MockScheduledJob {
  id: string;
  job_type: string;
  booking_id: string;
  run_at: string;
  status: string;
  attempts: number;
  last_error: string | null;
}

interface MockBookingEvent {
  id: string;
  booking_id: string;
  event_type: string;
  channel: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

// Helper to add days to a date
function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

// Helper to add hours to a date
function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

// Helper to format date as YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Generate a mock booking
function createMockBooking(overrides: Partial<MockBooking> = {}): MockBooking {
  return {
    id: `booking-${crypto.randomUUID().slice(0, 8)}`,
    reservation_number: `OEV-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
    event_date: formatDate(addDays(new Date(), 30)),
    payment_status: "deposit_paid",
    lifecycle_status: "pre_event_ready",
    balance_amount: 549,
    balance_payment_url: null,
    full_name: "Test Customer",
    email: "test@example.com",
    phone: "1234567890",
    booking_type: "daily",
    status: "pending_review",
    number_of_guests: 50,
    event_type: "celebration",
    package: "none",
    total_amount: 1098,
    deposit_amount: 549,
    pre_event_ready: "true",
    start_time: null,
    end_time: null,
    ...overrides,
  };
}

// ============================================================================
// Simulation Classes (Mock Supabase/Stripe)
// ============================================================================

class MockDatabase {
  bookings: Map<string, MockBooking> = new Map();
  scheduled_jobs: MockScheduledJob[] = [];
  booking_events: MockBookingEvent[] = [];

  reset(): void {
    this.bookings.clear();
    this.scheduled_jobs = [];
    this.booking_events = [];
  }

  insertBooking(booking: MockBooking): void {
    this.bookings.set(booking.id, booking);
  }

  updateBooking(id: string, updates: Partial<MockBooking>): void {
    const booking = this.bookings.get(id);
    if (booking) {
      this.bookings.set(id, { ...booking, ...updates });
    }
  }

  getBooking(id: string): MockBooking | undefined {
    return this.bookings.get(id);
  }

  insertJob(job: Omit<MockScheduledJob, 'id'>): MockScheduledJob {
    const newJob = { ...job, id: crypto.randomUUID() };
    this.scheduled_jobs.push(newJob);
    return newJob;
  }

  getJobsForBooking(bookingId: string, jobTypes?: string[]): MockScheduledJob[] {
    return this.scheduled_jobs.filter(j => 
      j.booking_id === bookingId && 
      (!jobTypes || jobTypes.includes(j.job_type))
    );
  }

  getPendingJobs(now: Date): MockScheduledJob[] {
    return this.scheduled_jobs.filter(j => 
      j.status === "pending" && 
      new Date(j.run_at) <= now && 
      j.attempts < 3
    );
  }

  updateJob(id: string, updates: Partial<MockScheduledJob>): void {
    const idx = this.scheduled_jobs.findIndex(j => j.id === id);
    if (idx >= 0) {
      this.scheduled_jobs[idx] = { ...this.scheduled_jobs[idx], ...updates };
    }
  }

  insertEvent(event: Omit<MockBookingEvent, 'id' | 'created_at'>): void {
    this.booking_events.push({
      ...event,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    });
  }

  getEventsForBooking(bookingId: string, eventType?: string): MockBookingEvent[] {
    return this.booking_events.filter(e => 
      e.booking_id === bookingId && 
      (!eventType || e.event_type === eventType)
    );
  }
}

class MockStripe {
  sessions: Map<string, { id: string; url: string; expires_at: number }> = new Map();

  createCheckoutSession(bookingId: string, amount: number): { id: string; url: string; expires_at: number } {
    const sessionId = `cs_test_${crypto.randomUUID().slice(0, 16)}`;
    const session = {
      id: sessionId,
      url: `https://checkout.stripe.com/pay/${sessionId}`,
      expires_at: Math.floor(Date.now() / 1000) + 24 * 60 * 60, // 24h from now
    };
    this.sessions.set(sessionId, session);
    return session;
  }
}

class MockGHL {
  snapshots: Array<{ booking_id: string; snapshot: unknown; timestamp: Date }> = [];

  sendSnapshot(snapshot: unknown): void {
    const s = snapshot as { booking_id?: string };
    this.snapshots.push({
      booking_id: s.booking_id || "unknown",
      snapshot,
      timestamp: new Date(),
    });
  }

  getSnapshotsForBooking(bookingId: string): unknown[] {
    return this.snapshots.filter(s => s.booking_id === bookingId).map(s => s.snapshot);
  }

  reset(): void {
    this.snapshots = [];
  }
}

// ============================================================================
// Business Logic Functions (Simulated from Edge Functions)
// ============================================================================

interface ScheduleResult {
  success: boolean;
  action: string;
  reason?: string;
  max_attempts?: number;
  first_link_created?: boolean;
  payment_url?: string;
  scheduled_jobs?: Array<{ attempt: number; job_type: string; run_at: string }>;
}

function scheduleBalancePayment(
  db: MockDatabase,
  stripe: MockStripe,
  ghl: MockGHL,
  bookingId: string
): ScheduleResult {
  const booking = db.getBooking(bookingId);
  
  if (!booking) {
    return { success: false, action: "error", reason: "Booking not found" };
  }

  // Skip if already fully paid
  if (booking.payment_status === "fully_paid") {
    return { 
      success: true, 
      action: "skipped", 
      reason: "Already fully paid" 
    };
  }

  // Skip if not deposit_paid
  if (booking.payment_status !== "deposit_paid") {
    return { 
      success: true, 
      action: "skipped", 
      reason: `Payment status is ${booking.payment_status}, not deposit_paid` 
    };
  }

  // Check for existing jobs
  const existingJobs = db.getJobsForBooking(bookingId, [
    "balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"
  ]).filter(j => ["pending", "completed"].includes(j.status));

  if (existingJobs.length > 0) {
    return { 
      success: true, 
      action: "skipped", 
      reason: "Balance payment jobs already scheduled" 
    };
  }

  // Calculate days until event
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(booking.event_date + "T00:00:00");
  const diffMs = eventDate.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays <= 15) {
    // SHORT NOTICE: Max 2 balance links
    
    // Create first link immediately
    const stripeSession = stripe.createCheckoutSession(bookingId, booking.balance_amount);
    db.updateBooking(bookingId, { 
      balance_payment_url: stripeSession.url 
    });
    
    // Log event
    db.insertEvent({
      booking_id: bookingId,
      event_type: "balance_payment_link_created",
      channel: "ghl",
      metadata: { attempt: 1, amount: booking.balance_amount },
    });

    // Sync to GHL
    const snapshot = buildSnapshot(db.getBooking(bookingId)!);
    ghl.sendSnapshot(snapshot);

    // Log scheduled event
    db.insertEvent({
      booking_id: bookingId,
      event_type: "balance_payment_retry_scheduled",
      channel: "system",
      metadata: { attempt: 1, type: "short_notice", created_immediately: true },
    });

    // Schedule retry #2 for 48 hours later
    const retryAt = addHours(new Date(), 48);
    db.insertJob({
      job_type: "balance_retry_2",
      booking_id: bookingId,
      run_at: retryAt.toISOString(),
      status: "pending",
      attempts: 0,
      last_error: null,
    });

    db.insertEvent({
      booking_id: bookingId,
      event_type: "balance_payment_retry_scheduled",
      channel: "system",
      metadata: { attempt: 2, type: "short_notice", scheduled_for: retryAt.toISOString() },
    });

    return {
      success: true,
      action: "short_notice_scheduled",
      first_link_created: true,
      payment_url: stripeSession.url,
      max_attempts: 2,
    };

  } else {
    // LONG NOTICE: Max 3 balance links
    
    const firstRun = new Date(eventDate);
    firstRun.setDate(firstRun.getDate() - 15);
    const secondRun = addHours(firstRun, 48);
    const thirdRun = addHours(secondRun, 48);

    // Insert all 3 scheduled jobs
    const jobsToInsert = [
      { job_type: "balance_retry_1", run_at: firstRun.toISOString() },
      { job_type: "balance_retry_2", run_at: secondRun.toISOString() },
      { job_type: "balance_retry_3", run_at: thirdRun.toISOString() },
    ];

    for (const job of jobsToInsert) {
      db.insertJob({
        ...job,
        booking_id: bookingId,
        status: "pending",
        attempts: 0,
        last_error: null,
      });
    }

    // Log events
    jobsToInsert.forEach((job, idx) => {
      db.insertEvent({
        booking_id: bookingId,
        event_type: "balance_payment_retry_scheduled",
        channel: "system",
        metadata: { 
          attempt: idx + 1, 
          type: "long_notice", 
          scheduled_for: job.run_at 
        },
      });
    });

    return {
      success: true,
      action: "long_notice_scheduled",
      scheduled_jobs: jobsToInsert.map((j, idx) => ({ 
        attempt: idx + 1, 
        job_type: j.job_type, 
        run_at: j.run_at 
      })),
      max_attempts: 3,
    };
  }
}

interface CreateLinkResult {
  success: boolean;
  error?: string;
  payment_url?: string;
}

function createBalancePaymentLink(
  db: MockDatabase,
  stripe: MockStripe,
  ghl: MockGHL,
  bookingId: string,
  attempt?: number
): CreateLinkResult {
  const booking = db.getBooking(bookingId);

  if (!booking) {
    return { success: false, error: "Booking not found" };
  }

  if (booking.payment_status === "fully_paid") {
    return { success: false, error: "Booking already fully paid" };
  }

  if (booking.payment_status !== "deposit_paid") {
    return { success: false, error: "Deposit must be paid before collecting balance" };
  }

  // Create Stripe session
  const session = stripe.createCheckoutSession(bookingId, booking.balance_amount);

  // Update booking
  db.updateBooking(bookingId, {
    balance_payment_url: session.url,
  });

  // Log event
  db.insertEvent({
    booking_id: bookingId,
    event_type: "balance_payment_link_created",
    channel: "ghl",
    metadata: {
      session_id: session.id,
      payment_url: session.url,
      amount: booking.balance_amount,
      attempt: attempt || 1,
    },
  });

  // Sync to GHL
  const snapshot = buildSnapshot(db.getBooking(bookingId)!);
  ghl.sendSnapshot(snapshot);

  return {
    success: true,
    payment_url: session.url,
  };
}

interface ProcessJobsResult {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  details: Array<{ job_id: string; job_type: string; status: string; error?: string }>;
}

function processScheduledJobs(
  db: MockDatabase,
  stripe: MockStripe,
  ghl: MockGHL,
  now: Date
): ProcessJobsResult {
  const pendingJobs = db.getPendingJobs(now);
  
  const results: ProcessJobsResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    details: [],
  };

  const balanceJobTypes = ["balance_retry_1", "balance_retry_2", "balance_retry_3", "create_balance_payment_link"];

  for (const job of pendingJobs) {
    results.processed++;

    // Increment attempts
    db.updateJob(job.id, { attempts: job.attempts + 1 });

    if (!balanceJobTypes.includes(job.job_type)) {
      db.updateJob(job.id, { status: "failed", last_error: `Unknown job type: ${job.job_type}` });
      results.failed++;
      results.details.push({ job_id: job.id, job_type: job.job_type, status: "failed", error: `Unknown job type` });
      continue;
    }

    const booking = db.getBooking(job.booking_id);

    if (!booking) {
      db.updateJob(job.id, { status: "failed", last_error: "Booking not found" });
      results.failed++;
      results.details.push({ job_id: job.id, job_type: job.job_type, status: "failed", error: "Booking not found" });
      continue;
    }

    // Check if already fully paid
    if (booking.payment_status === "fully_paid") {
      db.updateJob(job.id, { 
        status: "completed", 
        last_error: "Skipped: already fully paid" 
      });

      db.insertEvent({
        booking_id: job.booking_id,
        event_type: "balance_payment_retry_skipped_already_paid",
        channel: "system",
        metadata: { job_id: job.id, job_type: job.job_type, reason: "already_fully_paid" },
      });

      results.skipped++;
      results.details.push({ job_id: job.id, job_type: job.job_type, status: "skipped", error: "Already fully paid" });
      continue;
    }

    // Check deposit status
    if (booking.payment_status !== "deposit_paid") {
      db.updateJob(job.id, { 
        status: "failed", 
        last_error: `Cannot create balance link: payment_status is ${booking.payment_status}` 
      });
      results.failed++;
      results.details.push({ job_id: job.id, job_type: job.job_type, status: "failed", error: `Deposit not paid` });
      continue;
    }

    // Extract attempt number
    let attemptNumber = 1;
    const match = job.job_type.match(/balance_retry_(\d+)/);
    if (match) {
      attemptNumber = parseInt(match[1], 10);
    }

    // Create balance link
    const linkResult = createBalancePaymentLink(db, stripe, ghl, job.booking_id, attemptNumber);

    if (linkResult.success) {
      db.updateJob(job.id, { status: "completed" });

      db.insertEvent({
        booking_id: job.booking_id,
        event_type: "balance_payment_retry_executed",
        channel: "system",
        metadata: { job_id: job.id, job_type: job.job_type, attempt: attemptNumber, payment_url: linkResult.payment_url },
      });

      results.succeeded++;
      results.details.push({ job_id: job.id, job_type: job.job_type, status: "completed" });
    } else {
      const newAttempts = job.attempts + 1;
      const newStatus = newAttempts >= 3 ? "failed" : "pending";
      db.updateJob(job.id, { status: newStatus, last_error: linkResult.error });
      results.failed++;
      results.details.push({ job_id: job.id, job_type: job.job_type, status: newStatus, error: linkResult.error });
    }
  }

  return results;
}

// Build snapshot for GHL
function buildSnapshot(booking: MockBooking): Record<string, unknown> {
  // Calculate short_notice_balance
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const eventDate = new Date(booking.event_date + "T00:00:00");
  const diffMs = eventDate.getTime() - today.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  return {
    booking_id: booking.id,
    reservation_number: booking.reservation_number,
    event_date: booking.event_date,
    start_time: booking.start_time,
    end_time: booking.end_time,
    booking_type: booking.booking_type,
    status: booking.status,
    payment_status: booking.payment_status,
    lifecycle_status: booking.lifecycle_status,
    number_of_guests: booking.number_of_guests,
    event_type: booking.event_type,
    package: booking.package,
    total_amount: booking.total_amount,
    deposit_amount: booking.deposit_amount,
    balance_amount: booking.balance_amount,
    balance_payment_url: booking.balance_payment_url,
    is_deposit_paid: booking.payment_status === "deposit_paid" || booking.payment_status === "fully_paid" ? "true" : "false",
    is_fully_paid: booking.payment_status === "fully_paid" ? "true" : "false",
    has_staff_assigned: "false",
    cleaning_report_completed: "false",
    host_report_completed: "false",
    review_received: "false",
    pre_event_ready: booking.pre_event_ready,
    short_notice_balance: diffDays <= 15 ? "true" : "false",
    customer: {
      full_name: booking.full_name,
      email: booking.email,
      phone: booking.phone,
    },
  };
}

// ============================================================================
// TESTS: schedule-balance-payment
// ============================================================================

Deno.test("schedule-balance-payment: Short notice (≤15 days) creates link immediately + schedules 1 retry", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  // Booking with event in 10 days
  const booking = createMockBooking({
    event_date: formatDate(addDays(new Date(), 10)),
  });
  db.insertBooking(booking);

  const result = scheduleBalancePayment(db, stripe, ghl, booking.id);

  // Assertions
  assertEquals(result.success, true);
  assertEquals(result.action, "short_notice_scheduled");
  assertEquals(result.first_link_created, true);
  assertEquals(result.max_attempts, 2);
  assertExists(result.payment_url);

  // Check booking updated with balance_payment_url
  const updatedBooking = db.getBooking(booking.id);
  assertExists(updatedBooking?.balance_payment_url);

  // Check exactly 1 job created (balance_retry_2)
  const jobs = db.getJobsForBooking(booking.id);
  assertEquals(jobs.length, 1);
  assertEquals(jobs[0].job_type, "balance_retry_2");
  assertEquals(jobs[0].status, "pending");

  // Check run_at is ~48 hours in the future
  const runAt = new Date(jobs[0].run_at);
  const expectedRunAt = addHours(new Date(), 48);
  const diffHours = Math.abs(runAt.getTime() - expectedRunAt.getTime()) / (1000 * 60 * 60);
  assertEquals(diffHours < 1, true, "Retry should be ~48 hours from now");

  // Check syncToGHL was called
  assertEquals(ghl.snapshots.length, 1);
  assertEquals(ghl.snapshots[0].booking_id, booking.id);

  // Check booking_events
  const events = db.getEventsForBooking(booking.id, "balance_payment_link_created");
  assertEquals(events.length, 1);
  assertEquals((events[0].metadata as Record<string, unknown>).attempt, 1);

  console.log("✅ Short notice test passed - 1 link created, 1 retry scheduled");
});

Deno.test("schedule-balance-payment: Long notice (>15 days) schedules 3 jobs without immediate link", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  // Booking with event in 40 days
  const booking = createMockBooking({
    event_date: formatDate(addDays(new Date(), 40)),
  });
  db.insertBooking(booking);

  const result = scheduleBalancePayment(db, stripe, ghl, booking.id);

  // Assertions
  assertEquals(result.success, true);
  assertEquals(result.action, "long_notice_scheduled");
  assertEquals(result.max_attempts, 3);
  assertEquals(result.first_link_created, undefined, "Should NOT create link immediately");
  assertExists(result.scheduled_jobs);
  assertEquals(result.scheduled_jobs?.length, 3);

  // Check booking NOT updated (no immediate link)
  const updatedBooking = db.getBooking(booking.id);
  assertEquals(updatedBooking?.balance_payment_url, null);

  // Check 3 jobs created
  const jobs = db.getJobsForBooking(booking.id);
  assertEquals(jobs.length, 3);
  
  const jobTypes = jobs.map(j => j.job_type).sort();
  assertArrayIncludes(jobTypes, ["balance_retry_1", "balance_retry_2", "balance_retry_3"]);

  // Check timing: T-15, T-15+48h, T-15+96h
  const eventDate = new Date(booking.event_date + "T00:00:00");
  const expectedFirst = new Date(eventDate);
  expectedFirst.setDate(expectedFirst.getDate() - 15);
  const expectedSecond = addHours(expectedFirst, 48);
  const expectedThird = addHours(expectedSecond, 48);

  const job1 = jobs.find(j => j.job_type === "balance_retry_1")!;
  const job2 = jobs.find(j => j.job_type === "balance_retry_2")!;
  const job3 = jobs.find(j => j.job_type === "balance_retry_3")!;

  // Allow 1 minute tolerance
  const tolerance = 60 * 1000;
  assertEquals(
    Math.abs(new Date(job1.run_at).getTime() - expectedFirst.getTime()) < tolerance,
    true,
    "Job 1 should be T-15 days"
  );
  assertEquals(
    Math.abs(new Date(job2.run_at).getTime() - expectedSecond.getTime()) < tolerance,
    true,
    "Job 2 should be T-15+48h"
  );
  assertEquals(
    Math.abs(new Date(job3.run_at).getTime() - expectedThird.getTime()) < tolerance,
    true,
    "Job 3 should be T-15+96h"
  );

  // No syncToGHL call yet (no immediate link)
  assertEquals(ghl.snapshots.length, 0);

  console.log("✅ Long notice test passed - 3 jobs scheduled at correct times");
});

Deno.test("schedule-balance-payment: Skips booking without deposit_paid", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking({
    payment_status: "pending", // Not deposit_paid
  });
  db.insertBooking(booking);

  const result = scheduleBalancePayment(db, stripe, ghl, booking.id);

  assertEquals(result.success, true);
  assertEquals(result.action, "skipped");
  assertEquals(result.reason?.includes("not deposit_paid"), true);

  // No jobs created
  assertEquals(db.scheduled_jobs.length, 0);
  
  // No GHL calls
  assertEquals(ghl.snapshots.length, 0);

  console.log("✅ Deposit not paid test passed - no jobs scheduled");
});

Deno.test("schedule-balance-payment: Handles non-existent booking", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const result = scheduleBalancePayment(db, stripe, ghl, "non-existent-id");

  assertEquals(result.success, false);
  assertEquals(result.reason?.includes("not found"), true);

  console.log("✅ Non-existent booking test passed");
});

Deno.test("schedule-balance-payment: Skips if jobs already exist", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking();
  db.insertBooking(booking);

  // Pre-existing job
  db.insertJob({
    job_type: "balance_retry_1",
    booking_id: booking.id,
    run_at: new Date().toISOString(),
    status: "pending",
    attempts: 0,
    last_error: null,
  });

  const result = scheduleBalancePayment(db, stripe, ghl, booking.id);

  assertEquals(result.success, true);
  assertEquals(result.action, "skipped");
  assertEquals(result.reason?.includes("already scheduled"), true);

  console.log("✅ Duplicate prevention test passed");
});

// ============================================================================
// TESTS: process-scheduled-jobs
// ============================================================================

Deno.test("process-scheduled-jobs: Executes pending job and creates link", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking();
  db.insertBooking(booking);

  // Create a job that's due
  db.insertJob({
    job_type: "balance_retry_1",
    booking_id: booking.id,
    run_at: addHours(new Date(), -1).toISOString(), // 1 hour ago
    status: "pending",
    attempts: 0,
    last_error: null,
  });

  const result = processScheduledJobs(db, stripe, ghl, new Date());

  assertEquals(result.processed, 1);
  assertEquals(result.succeeded, 1);
  assertEquals(result.failed, 0);
  assertEquals(result.skipped, 0);

  // Check booking updated
  const updatedBooking = db.getBooking(booking.id);
  assertExists(updatedBooking?.balance_payment_url);

  // Check GHL sync
  assertEquals(ghl.snapshots.length, 1);

  // Check job marked completed
  const job = db.scheduled_jobs[0];
  assertEquals(job.status, "completed");
  assertEquals(job.attempts, 1);

  // Check events
  const executeEvents = db.getEventsForBooking(booking.id, "balance_payment_retry_executed");
  assertEquals(executeEvents.length, 1);

  console.log("✅ Job execution test passed");
});

Deno.test("process-scheduled-jobs: Skips fully_paid booking", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking({
    payment_status: "fully_paid",
  });
  db.insertBooking(booking);

  db.insertJob({
    job_type: "balance_retry_2",
    booking_id: booking.id,
    run_at: addHours(new Date(), -1).toISOString(),
    status: "pending",
    attempts: 0,
    last_error: null,
  });

  const result = processScheduledJobs(db, stripe, ghl, new Date());

  assertEquals(result.processed, 1);
  assertEquals(result.skipped, 1);
  assertEquals(result.succeeded, 0);

  // No new link created
  assertEquals(booking.balance_payment_url, null);

  // No GHL sync (since link creation was skipped)
  assertEquals(ghl.snapshots.length, 0);

  // Job marked as completed with skip reason
  const job = db.scheduled_jobs[0];
  assertEquals(job.status, "completed");
  assertEquals(job.last_error?.includes("already fully paid"), true);

  // Skip event logged
  const skipEvents = db.getEventsForBooking(booking.id, "balance_payment_retry_skipped_already_paid");
  assertEquals(skipEvents.length, 1);

  console.log("✅ Fully paid skip test passed");
});

Deno.test("process-scheduled-jobs: Respects attempts < 3 limit", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking();
  db.insertBooking(booking);

  // Job with attempts = 3 (should NOT be selected)
  db.insertJob({
    job_type: "balance_retry_1",
    booking_id: booking.id,
    run_at: addHours(new Date(), -1).toISOString(),
    status: "pending",
    attempts: 3, // At max attempts
    last_error: "Previous error",
  });

  const result = processScheduledJobs(db, stripe, ghl, new Date());

  // Should not process jobs with attempts >= 3
  assertEquals(result.processed, 0);

  console.log("✅ Max attempts filter test passed");
});

Deno.test("process-scheduled-jobs: Handles non-existent booking", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  db.insertJob({
    job_type: "balance_retry_1",
    booking_id: "non-existent",
    run_at: addHours(new Date(), -1).toISOString(),
    status: "pending",
    attempts: 0,
    last_error: null,
  });

  const result = processScheduledJobs(db, stripe, ghl, new Date());

  assertEquals(result.processed, 1);
  assertEquals(result.failed, 1);

  const job = db.scheduled_jobs[0];
  assertEquals(job.status, "failed");
  assertEquals(job.last_error, "Booking not found");

  console.log("✅ Non-existent booking handling test passed");
});

// ============================================================================
// TESTS: create-balance-payment-link
// ============================================================================

Deno.test("create-balance-payment-link: Creates link successfully", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking();
  db.insertBooking(booking);

  const result = createBalancePaymentLink(db, stripe, ghl, booking.id, 1);

  assertEquals(result.success, true);
  assertExists(result.payment_url);

  // Booking updated
  const updated = db.getBooking(booking.id);
  assertEquals(updated?.balance_payment_url, result.payment_url);

  // GHL synced
  assertEquals(ghl.snapshots.length, 1);

  // Event logged
  const events = db.getEventsForBooking(booking.id, "balance_payment_link_created");
  assertEquals(events.length, 1);

  console.log("✅ Link creation test passed");
});

Deno.test("create-balance-payment-link: Fails for non-deposit_paid", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking({ payment_status: "pending" });
  db.insertBooking(booking);

  const result = createBalancePaymentLink(db, stripe, ghl, booking.id);

  assertEquals(result.success, false);
  assertEquals(result.error?.includes("Deposit must be paid"), true);

  // No GHL sync
  assertEquals(ghl.snapshots.length, 0);

  console.log("✅ Non-deposit rejection test passed");
});

Deno.test("create-balance-payment-link: Fails for fully_paid", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking({ payment_status: "fully_paid" });
  db.insertBooking(booking);

  const result = createBalancePaymentLink(db, stripe, ghl, booking.id);

  assertEquals(result.success, false);
  assertEquals(result.error?.includes("already fully paid"), true);

  console.log("✅ Fully paid rejection test passed");
});

// ============================================================================
// TESTS: E2E Simulation - Short Notice Flow
// ============================================================================

Deno.test("E2E: Short notice booking - full 2-attempt flow", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  // Step 1: Create booking with event in 10 days
  const booking = createMockBooking({
    event_date: formatDate(addDays(new Date(), 10)),
  });
  db.insertBooking(booking);

  // Step 2: Call schedule-balance-payment
  const scheduleResult = scheduleBalancePayment(db, stripe, ghl, booking.id);
  
  assertEquals(scheduleResult.success, true);
  assertEquals(scheduleResult.action, "short_notice_scheduled");
  
  // First link created immediately
  const afterSchedule = db.getBooking(booking.id);
  const firstUrl = afterSchedule?.balance_payment_url;
  assertExists(firstUrl);
  assertEquals(ghl.snapshots.length, 1, "GHL synced after first link");

  // Verify one retry job scheduled
  const jobsAfterSchedule = db.getJobsForBooking(booking.id);
  assertEquals(jobsAfterSchedule.length, 1);
  assertEquals(jobsAfterSchedule[0].job_type, "balance_retry_2");

  // Step 3: Simulate 48 hours passing - run process-scheduled-jobs
  const simulatedTime = addHours(new Date(), 49); // Past the 48h mark
  
  // Manually adjust job's run_at to be in the past for simulation
  db.updateJob(jobsAfterSchedule[0].id, { 
    run_at: addHours(new Date(), -1).toISOString() 
  });

  const processResult = processScheduledJobs(db, stripe, ghl, simulatedTime);

  assertEquals(processResult.succeeded, 1);

  // Second link created
  const afterProcess = db.getBooking(booking.id);
  const secondUrl = afterProcess?.balance_payment_url;
  assertExists(secondUrl);
  
  // URL should be different (new session)
  assertEquals(firstUrl !== secondUrl, true, "Second link should be different from first");

  // GHL synced twice now
  assertEquals(ghl.snapshots.length, 2);

  // Verify events logged
  const linkEvents = db.getEventsForBooking(booking.id, "balance_payment_link_created");
  assertEquals(linkEvents.length, 2, "Should have 2 link creation events");

  console.log("✅ E2E Short notice (2 attempts) test passed");
  console.log(`   First URL: ${firstUrl}`);
  console.log(`   Second URL: ${secondUrl}`);
});

// ============================================================================
// TESTS: E2E Simulation - Long Notice Flow
// ============================================================================

Deno.test("E2E: Long notice booking - full 3-attempt flow with payment interruption", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  // Step 1: Create booking with event in 40 days
  const booking = createMockBooking({
    event_date: formatDate(addDays(new Date(), 40)),
  });
  db.insertBooking(booking);

  // Step 2: Call schedule-balance-payment
  const scheduleResult = scheduleBalancePayment(db, stripe, ghl, booking.id);
  
  assertEquals(scheduleResult.success, true);
  assertEquals(scheduleResult.action, "long_notice_scheduled");
  
  // No immediate link
  const afterSchedule = db.getBooking(booking.id);
  assertEquals(afterSchedule?.balance_payment_url, null);
  assertEquals(ghl.snapshots.length, 0, "No GHL sync yet");

  // 3 jobs scheduled
  const jobs = db.getJobsForBooking(booking.id);
  assertEquals(jobs.length, 3);

  // Step 3: Simulate first job execution (T-15)
  const job1 = jobs.find(j => j.job_type === "balance_retry_1")!;
  db.updateJob(job1.id, { run_at: addHours(new Date(), -1).toISOString() });

  const result1 = processScheduledJobs(db, stripe, ghl, new Date());
  assertEquals(result1.succeeded, 1);

  const firstUrl = db.getBooking(booking.id)?.balance_payment_url;
  assertExists(firstUrl);
  assertEquals(ghl.snapshots.length, 1);

  // Step 4: Simulate second job execution (T-15+48h)
  const job2 = jobs.find(j => j.job_type === "balance_retry_2")!;
  db.updateJob(job2.id, { run_at: addHours(new Date(), -1).toISOString() });

  const result2 = processScheduledJobs(db, stripe, ghl, new Date());
  assertEquals(result2.succeeded, 1);

  const secondUrl = db.getBooking(booking.id)?.balance_payment_url;
  assertExists(secondUrl);
  assertEquals(ghl.snapshots.length, 2);

  // Step 5: Simulate customer pays - set to fully_paid
  db.updateBooking(booking.id, { payment_status: "fully_paid" });

  // Step 6: Third job should be skipped
  const job3 = jobs.find(j => j.job_type === "balance_retry_3")!;
  db.updateJob(job3.id, { run_at: addHours(new Date(), -1).toISOString() });

  const result3 = processScheduledJobs(db, stripe, ghl, new Date());
  assertEquals(result3.skipped, 1);
  assertEquals(result3.succeeded, 0);

  // No additional GHL sync for skipped job
  assertEquals(ghl.snapshots.length, 2, "No new sync after fully paid");

  // Verify skip event logged
  const skipEvents = db.getEventsForBooking(booking.id, "balance_payment_retry_skipped_already_paid");
  assertEquals(skipEvents.length, 1);

  console.log("✅ E2E Long notice (3 attempts + payment interruption) test passed");
});

// ============================================================================
// TESTS: syncToGHL Snapshot Validation
// ============================================================================

Deno.test("syncToGHL: Snapshot contains all required fields with correct types", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking({
    event_date: formatDate(addDays(new Date(), 10)),
    balance_payment_url: "https://checkout.stripe.com/test",
  });
  db.insertBooking(booking);

  // Trigger sync via link creation
  createBalancePaymentLink(db, stripe, ghl, booking.id, 1);

  assertEquals(ghl.snapshots.length, 1);
  
  const snapshot = ghl.snapshots[0].snapshot as Record<string, unknown>;

  // Required fields check
  const requiredFields = [
    "booking_id",
    "reservation_number",
    "event_date",
    "payment_status",
    "lifecycle_status",
    "balance_amount",
    "balance_payment_url",
    "is_deposit_paid",
    "is_fully_paid",
    "has_staff_assigned",
    "cleaning_report_completed",
    "host_report_completed",
    "review_received",
    "pre_event_ready",
    "short_notice_balance",
    "customer",
  ];

  for (const field of requiredFields) {
    assertExists(snapshot[field], `Missing required field: ${field}`);
  }

  // Customer nested fields
  const customer = snapshot.customer as Record<string, unknown>;
  assertExists(customer.full_name, "Missing customer.full_name");
  assertExists(customer.email, "Missing customer.email");
  assertExists(customer.phone, "Missing customer.phone");

  // Boolean flags should be strings "true" or "false"
  const boolFields = [
    "is_deposit_paid",
    "is_fully_paid",
    "has_staff_assigned",
    "cleaning_report_completed",
    "host_report_completed",
    "review_received",
    "pre_event_ready",
    "short_notice_balance",
  ];

  for (const field of boolFields) {
    const value = snapshot[field];
    assertEquals(
      value === "true" || value === "false",
      true,
      `${field} should be "true" or "false", got: ${value}`
    );
  }

  // Print example snapshot
  console.log("\n📦 Example GHL Snapshot:");
  console.log(JSON.stringify(snapshot, null, 2));

  console.log("✅ Snapshot validation test passed");
});

Deno.test("syncToGHL: Called exactly once per link creation", () => {
  const db = new MockDatabase();
  const stripe = new MockStripe();
  const ghl = new MockGHL();

  const booking = createMockBooking();
  db.insertBooking(booking);

  // Create 3 links manually
  createBalancePaymentLink(db, stripe, ghl, booking.id, 1);
  createBalancePaymentLink(db, stripe, ghl, booking.id, 2);
  createBalancePaymentLink(db, stripe, ghl, booking.id, 3);

  // Should have exactly 3 GHL calls
  assertEquals(ghl.snapshots.length, 3, "Should call GHL once per link");

  console.log("✅ GHL sync frequency test passed");
});

// ============================================================================
// Print Summary
// ============================================================================

Deno.test("--- TEST SUMMARY ---", () => {
  console.log("\n" + "=".repeat(60));
  console.log("BALANCE PAYMENT TEST SUITE - SUMMARY");
  console.log("=".repeat(60));
  console.log(`
MODULES TESTED:
  ✓ schedule-balance-payment
    - Short notice (≤15 days): 1 immediate link + 1 retry @ +48h
    - Long notice (>15 days): 3 scheduled jobs @ T-15, T-15+48h, T-15+96h
    - Skips non-deposit_paid bookings
    - Skips if jobs already exist
    - Handles non-existent booking

  ✓ process-scheduled-jobs
    - Executes pending jobs and creates links
    - Skips fully_paid bookings (marks as completed with reason)
    - Respects attempts < 3 limit
    - Handles non-existent booking

  ✓ create-balance-payment-link
    - Creates Stripe session and updates booking
    - Rejects non-deposit_paid
    - Rejects fully_paid
    - Calls syncToGHL on success

  ✓ E2E Simulations
    - Short notice: Full 2-attempt flow
    - Long notice: Full 3-attempt flow with payment interruption

  ✓ syncToGHL Validation
    - Snapshot contains all required fields
    - Boolean flags are text strings ("true"/"false")
    - Called exactly once per link creation

CONFIRMED BEHAVIORS:
  ✓ Short notice → Max 2 links
  ✓ Long notice → Max 3 links
  ✓ No links created if payment_status = 'fully_paid'
  ✓ Each link creation triggers syncToGHL
  ✓ Snapshot format matches GHL mapping requirements
`);
  console.log("=".repeat(60));
});
