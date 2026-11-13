import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

// ClickUp 86e40ach2 — M-23..M-27 + Luis D7: guarded lifecycle moves, events close.
const read = (p: string) => readFileSync(p, "utf-8");
const SQL = read("supabase/migrations/20261113170000_phase1b_status.sql");
const CRON = read("supabase/functions/check-post-event-transition/index.ts");
const JOBS = read("supabase/functions/process-scheduled-jobs/index.ts");
const DETAIL = read("src/pages/admin/BookingDetail.tsx");

describe("transition_booking", () => {
  it("locks, refuses cancelled bookings and cancel targets, compare-and-sets", () => {
    expect(SQL).toMatch(/cancel through cancel-booking, not transition_booking/);
    expect(SQL).toMatch(/FROM public\.bookings WHERE id = p_booking_id FOR UPDATE;/);
    expect(SQL).toMatch(/'reason', 'booking_cancelled'/);
    expect(SQL).toMatch(/NOT \(v_b\.lifecycle_status = ANY \(p_expected_from\)\)/);
    expect(SQL).toMatch(/_lifecycle_transition_allowed\(v_b\.lifecycle_status, p_to\)/);
  });
  it("only allows forward steps (no jump back from post_event)", () => {
    expect(SQL).toMatch(/\('in_progress', 'post_event'\)/);
    expect(SQL).not.toMatch(/\('post_event', 'in_progress'\)/);
  });
  it("is service-role only; the office uses admin_close_event", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.transition_booking\(uuid, text, text\[\], text, text\) FROM PUBLIC, anon, authenticated;/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.admin_close_event\(uuid, text\) TO authenticated, service_role;/);
  });
});

describe("lifecycle cron (D7)", () => {
  it("moves started events regardless of payment, except unpaid leads and the pre-11/12 backlog", () => {
    expect(SQL).toMatch(/b\.payment_status NOT IN \('pending'::payment_status, 'failed'::payment_status, 'refunded'::payment_status\)/);
    expect(SQL).toMatch(/b\.event_date >= date '2026-11-12'/);
    expect(SQL).toMatch(/public\._booking_event_start_at\(b\.id\) <= now\(\)/);
  });
  it("closes 24h after the end without the guest report", () => {
    expect(SQL).toMatch(/public\._booking_event_end_at\(b\.id\) \+ interval '24 hours' <= now\(\)/);
    expect(CRON).not.toMatch(/booking_host_reports/);
    expect(CRON).toMatch(/rpc\('transition_booking'/);
    expect(CRON).toMatch(/p_expected_from: \[m\.from_lifecycle\]/);
  });
});

describe("process-scheduled-jobs", () => {
  it("claims each job atomically before running it (M-26)", () => {
    expect(JOBS).toMatch(/\.update\(\{ status: "processing", attempts: job\.attempts \+ 1/);
    expect(JOBS).toMatch(/\.eq\("status", job\.status\)\s+\.eq\("attempts", job\.attempts\)/);
    expect(JOBS).toMatch(/claimed_by_another_run/);
  });
  it("releases unfinished claims and retries dead ones after the lease", () => {
    expect(JOBS).toMatch(/\.update\(\{ status: "pending", updated_at: new Date\(\)\.toISOString\(\) \}\)\s+\.eq\("id", job\.id\)\s+\.eq\("status", "processing"\);/);
    expect(JOBS).toMatch(/status\.eq\.processing,updated_at\.lt\./);
    expect(JOBS).toMatch(/for \(const _job of \[job\]\) \{/);
  });
  it("stops creating the post-event job and the UTC-parsed cleaning reminder (M-27)", () => {
    expect(JOBS).not.toMatch(/job_type: "set_lifecycle_post_event",\s+booking_id: job\.booking_id/);
    expect(JOBS).not.toMatch(/toLocaleString\("en-US", \{ timeZone: "America\/New_York" \}\)/);
    expect(SQL).toMatch(/public\._booking_event_end_at\(NEW\.id\) \+ interval '24 hours', 'pending'/);
  });
  it("exhausted jobs are marked failed instead of sitting pending", () => {
    expect(JOBS).toMatch(/last_error: "max_attempts_reached"/);
    expect(SQL).toMatch(/WHERE status = 'pending' AND attempts >= 3;/);
  });
});

describe("admin", () => {
  it("shows the auto-close time and a Close event button", () => {
    expect(DETAIL).toMatch(/<EventCloseCard booking=\{booking\} \/>/);
  });
});
