import { describe, expect, it } from "vitest";
import { describeReadiness, readinessToastText } from "./bookingReadiness";
import type { BookingReadiness } from "@/hooks/useAdminData";

// Shapes mirror what public.booking_readiness() returns (ClickUp 86e3zjfq6).
const base = (over: Partial<BookingReadiness>): BookingReadiness => ({
  ready: false,
  checklist_complete: true,
  staff_exempt: false,
  staff_total: 0,
  staff_accepted: 0,
  lifecycle_status: "confirmed",
  unmet: [],
  ...over,
});

describe("describeReadiness", () => {
  it("Mishaun repro: checklist complete + no staff is NOT shown as ready", () => {
    const view = describeReadiness(
      "confirmed",
      base({ unmet: [{ code: "no_staff", message: "No staff assigned" }] }),
    );
    expect(view.badge).toBe("not_ready");
    expect(view.label).not.toMatch(/Ready for Event|✅/);
    expect(view.checklistLabel).toBe("Confirmation checklist: complete");
    expect(view.unmet.map((u) => u.code)).toEqual(["no_staff"]);
    expect(view.showMarkChecklist).toBe(false);
  });

  it("assigned staff with pending response: not ready, waiting on staff", () => {
    const view = describeReadiness(
      "confirmed",
      base({
        staff_total: 2,
        staff_accepted: 1,
        unmet: [{ code: "staff_pending", message: "Waiting for staff to accept: Marielysa Castellano (Custodial)" }],
      }),
    );
    expect(view.badge).toBe("not_ready");
    expect(view.waitingOnStaff).toBe(true);
    expect(view.staffLabel).toBe("Staff accepted: 1/2");
  });

  it("all staff accepted + checklist complete: ready", () => {
    const view = describeReadiness(
      "pre_event_ready",
      base({ ready: true, staff_total: 2, staff_accepted: 2, lifecycle_status: "pre_event_ready" }),
    );
    expect(view.badge).toBe("ready");
    expect(view.label).toBe("✅ Pre-Event Ready");
    expect(view.unmet).toEqual([]);
  });

  it("rule met but GHL has not moved it yet: explicit waiting state, not 'ready'", () => {
    const view = describeReadiness(
      "confirmed",
      base({ ready: true, staff_total: 1, staff_accepted: 1, lifecycle_status: "confirmed" }),
    );
    expect(view.badge).toBe("not_ready");
    expect(view.waitingOnGhl).toBe(true);
    expect(view.label).toMatch(/Requirements met/);
    expect(readinessToastText(base({ ready: true, lifecycle_status: "confirmed" }))).toMatch(/few seconds/);
  });

  it("incomplete checklist offers the checklist action, not a lifecycle jump", () => {
    const view = describeReadiness(
      "confirmed",
      base({
        checklist_complete: false,
        unmet: [{ code: "checklist_incomplete", message: "Confirmation checklist is not complete" }],
      }),
    );
    expect(view.showMarkChecklist).toBe(true);
    expect(view.checklistLabel).toBe("Confirmation checklist: incomplete");
  });

  it("pending (unpaid) bookings never offer the checklist action", () => {
    const view = describeReadiness("pending", base({ checklist_complete: false }));
    expect(view.showMarkChecklist).toBe(false);
  });

  it("external bookings say staff acceptance is not required", () => {
    const view = describeReadiness("pre_event_ready", base({ ready: true, staff_exempt: true }));
    expect(view.staffLabel).toMatch(/not required/);
  });

  it("in_progress and later states are not judged by pre-event rules", () => {
    for (const lc of ["in_progress", "post_event", "closed_review_complete", "cancelled"]) {
      const view = describeReadiness(lc, base({ unmet: [{ code: "staff_pending", message: "x" }] }));
      expect(view.badge).toBe("past");
      expect(view.unmet).toEqual([]);
    }
  });

  it("readiness still loading is explicit, never 'ready'", () => {
    expect(describeReadiness("confirmed", null).badge).toBe("unknown");
  });
});

describe("readinessToastText", () => {
  it("says what is missing", () => {
    expect(
      readinessToastText(base({ unmet: [{ code: "staff_pending", message: "Waiting for staff to accept: A (Custodial)" }] })),
    ).toBe("Not Pre-Event Ready yet: Waiting for staff to accept: A (Custodial)");
  });
  it("confirms when the DB promoted the booking", () => {
    expect(readinessToastText(base({ ready: true, lifecycle_status: "pre_event_ready" }))).toBe(
      "Booking is Pre-Event Ready.",
    );
  });
});
