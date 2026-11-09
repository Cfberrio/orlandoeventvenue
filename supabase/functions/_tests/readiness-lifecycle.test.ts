/**
 * Pre-event readiness & lifecycle ownership (ClickUp 86e3zjfq6).
 *
 * - decideGhlLifecycleWrite: pure guard used by ghl-update-booking-status.
 * - Source guards: the edge functions and the migration keep the contract
 *   (GHL can't set pre_event_ready/in_progress, event-start job accepts
 *   confirmed, auto-reject cron is gone, gate trigger exists).
 *
 * DB behaviour (promotion/demotion, multiple staff, other-event approval,
 * gate, in_progress) is covered by supabase/tests/readiness_gate_scenarios.sql,
 * which runs against the real database inside a rolled-back transaction.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decideGhlLifecycleWrite } from "../_shared/ghl-lifecycle-guard.ts";

const root = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(root, p), "utf8");

const OPEN = { eligible: true, eventStarted: true };
const CLOSED = { eligible: false, eventStarted: false };

describe("decideGhlLifecycleWrite (GHL proposes, DB validates)", () => {
  it("Mishaun path: GHL asks pre_event_ready on assignment while staff pending -> deferred", () => {
    expect(decideGhlLifecycleWrite("confirmed", "pre_event_ready", CLOSED)).toEqual({
      kind: "defer",
      reason: "readiness_unmet",
    });
  });

  it("GHL asks pre_event_ready after everyone accepted -> applied", () => {
    expect(decideGhlLifecycleWrite("confirmed", "pre_event_ready", { eligible: true, eventStarted: false })).toEqual({
      kind: "apply",
      lifecycle: "pre_event_ready",
    });
  });

  it("GHL asks in_progress on balance payment, weeks early -> deferred", () => {
    expect(decideGhlLifecycleWrite("pre_event_ready", "in_progress", { eligible: true, eventStarted: false })).toEqual({
      kind: "defer",
      reason: "before_event_start",
    });
  });

  it("GHL asks in_progress once the event started -> applied (even if staff pending)", () => {
    expect(decideGhlLifecycleWrite("confirmed", "in_progress", { eligible: false, eventStarted: true })).toEqual({
      kind: "apply",
      lifecycle: "in_progress",
    });
  });

  it("GHL still confirms pending bookings and can cancel unfinished ones", () => {
    expect(decideGhlLifecycleWrite("pending", "confirmed", CLOSED)).toEqual({ kind: "apply", lifecycle: "confirmed" });
    expect(decideGhlLifecycleWrite("pre_event_ready", "cancelled", CLOSED)).toEqual({ kind: "apply", lifecycle: "cancelled" });
  });

  it("never pulls a booking back to confirmed", () => {
    for (const cur of ["pre_event_ready", "in_progress", "post_event", "closed_review_complete", "cancelled"]) {
      expect(decideGhlLifecycleWrite(cur, "confirmed", OPEN)).toEqual({
        kind: "ignore",
        reason: `ghl_cannot_move_${cur}_to_confirmed`,
      });
    }
  });

  it("full matrix with the rule met: only forward one-step moves and cancellations apply", () => {
    const states = ["pending", "confirmed", "pre_event_ready", "in_progress", "post_event", "closed_review_complete", "cancelled"];
    const applied: string[] = [];
    for (const from of states) {
      for (const to of states) {
        const d = decideGhlLifecycleWrite(from, to, OPEN);
        if (d && d.kind === "apply") applied.push(`${from}->${to}`);
      }
    }
    expect(applied.sort()).toEqual(
      [
        "pending->confirmed",
        "confirmed->pre_event_ready",
        "confirmed->in_progress",
        "pre_event_ready->in_progress",
        "in_progress->post_event",
        "post_event->closed_review_complete",
        "pending->cancelled",
        "confirmed->cancelled",
        "pre_event_ready->cancelled",
        "in_progress->cancelled",
        "post_event->cancelled",
      ].sort(),
    );
  });

  it("with the rule unmet and before start, the gated moves defer instead of applying", () => {
    expect(decideGhlLifecycleWrite("confirmed", "pre_event_ready", CLOSED)?.kind).toBe("defer");
    expect(decideGhlLifecycleWrite("confirmed", "in_progress", CLOSED)?.kind).toBe("defer");
    expect(decideGhlLifecycleWrite("pre_event_ready", "in_progress", CLOSED)?.kind).toBe("defer");
  });

  it("no lifecycle requested -> no decision; same value -> unchanged", () => {
    expect(decideGhlLifecycleWrite("confirmed", null, OPEN)).toBeNull();
    expect(decideGhlLifecycleWrite("confirmed", "confirmed", OPEN)).toEqual({ kind: "ignore", reason: "unchanged" });
  });
});

describe("source guards", () => {
  it("ghl-update-booking-status validates GHL writes against booking_readiness", () => {
    const src = read("supabase/functions/ghl-update-booking-status/index.ts");
    expect(src).toContain("decideGhlLifecycleWrite(");
    expect(src).toContain('supabase.rpc("booking_readiness"');
    expect(src).toContain('"ghl_lifecycle_deferred"');
    // the DB gate refusing (23514) is re-evaluated, not surfaced as a 500
    expect(src).toContain('code === "23514"');
    // CAS on status too, and cancelled is terminal for GHL (no stale reactivation)
    expect(src).toContain('updateQuery.eq("status", from_status)');
    expect(src).toContain('const isCancelled = from_status === "cancelled" || from_lifecycle === "cancelled";');
    expect(src).not.toMatch(/updateData\.status = new_status/);
    expect(src).toContain("updateData.lifecycle_status = applyLifecycle");
    expect(src).not.toMatch(/updateData\.lifecycle_status\s*=\s*new_lifecycle_status/);
    // compare-and-set: a stale GHL request can't overwrite a concurrent move
    expect(src).toContain('updateQuery.eq("lifecycle_status", from_lifecycle)');
    expect(src).toContain("stale_lifecycle_changed_concurrently");
    // a dropped status change must be retried by GHL, never acknowledged
    expect(src).toContain("status: 503");
  });

  it("event-start job moves confirmed bookings too, conditionally", () => {
    const src = read("supabase/functions/process-scheduled-jobs/index.ts");
    expect(src).toMatch(/IN_PROGRESS_SOURCE_STATES = \["confirmed", "pre_event_ready"\]/);
    expect(src).toContain('.eq("lifecycle_status", booking.lifecycle_status)');
    expect(src).toMatch(/\.eq\("lifecycle_status", booking\.lifecycle_status\)\s*\/\/[^\n]*\n[^\n]*\n\s*\.neq\("status", "cancelled"\)/);
    // external bookings are staff-exempt end to end
    expect(src).toContain('const staffRequired = booking.booking_origin !== "external";');
    // cancelled / bar-only rows do not count as staff (mirrors the DB rule)
    expect(src).toMatch(/\.neq\("status", "cancelled"\)\s*\.neq\("assignment_type", "bar_service"\)\s*\.limit\(1\)/);
  });

  it("schedule-balance-payment schedules the event-start job for confirmed", () => {
    const src = read("supabase/functions/schedule-balance-payment/index.ts");
    expect(src).toContain('["confirmed", "pre_event_ready"].includes(booking.lifecycle_status)');
  });

  it("sync-to-ghl tells the workflow about acceptance and event start", () => {
    const src = read("supabase/functions/sync-to-ghl/index.ts");
    for (const f of ["pre_event_ready_eligible,", "staff_all_accepted,", "staff_pending_count,", "event_started,", "has_staff_assigned,"]) {
      expect(src).toContain(f);
    }
    // fail closed: eligibility defaults to "false"
    expect(src).toContain('let pre_event_ready_eligible = "false";');
  });

  it("migration removes auto-reject and installs the gate + recompute triggers", () => {
    const sql = read("supabase/migrations/20261109170000_booking_readiness_gate.sql");
    expect(sql).toContain("cron.unschedule('auto-reject-stale-staff-assignments')");
    expect(sql).not.toMatch(/auto_rejected\s*=\s*true/);
    expect(sql).toContain("BEFORE UPDATE OF lifecycle_status ON public.bookings");
    expect(sql).toContain("AFTER INSERT OR DELETE OR UPDATE OF response_status");
    expect(sql).toContain("FOR UPDATE;");
    // acceptance is per booking: the rule filters by the booking being evaluated
    expect(sql).toContain("WHERE a.booking_id = p_booking_id");
    // the DB never promotes on its own: GHL does, the gate validates
    expect(sql).not.toMatch(/v_to := 'pre_event_ready'/);
    // staff responses reach GHL
    expect(sql).toContain("'sync_reason', 'staff_response'");
  });

  it("admin checklist button no longer forces lifecycle_status", () => {
    const src = read("src/pages/admin/BookingDetail.tsx");
    expect(src).not.toMatch(/pre_event_ready: "true",\s*lifecycle_status: "pre_event_ready"/);
  });

  it("staff portal no longer threatens auto-rejection", () => {
    for (const p of ["src/pages/staff/StaffBookingDetail.tsx", "src/pages/staff/StaffBookingsList.tsx"]) {
      expect(read(p)).not.toContain("auto-rejected");
    }
  });
});
