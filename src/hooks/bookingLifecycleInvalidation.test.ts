import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { invalidateBookingLifecycle } from "./useAdminData";

// Regression for the "only appears after opening another booking" bug
// (ClickUp 86e3zjfq6): staff-assignment mutations used to invalidate only
// ["booking-staff-assignments", id], so the grouped Bookings list and the
// booking itself kept the old lifecycle until some unrelated navigation.
describe("invalidateBookingLifecycle", () => {
  it("marks booking, list, readiness, staff and events stale together", () => {
    const qc = new QueryClient();
    const id = "b-1";
    const keys = [
      ["booking", id],
      ["bookings", { lifecycleStatus: undefined }],
      ["booking-readiness", id],
      ["booking-staff-assignments", id],
      ["booking-events", id],
    ];
    for (const k of keys) qc.setQueryData(k, { cached: true });
    const unrelated = ["booking", "other"];
    qc.setQueryData(unrelated, { cached: true });

    invalidateBookingLifecycle(qc, id);

    for (const k of keys) {
      expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
    }
    expect(qc.getQueryState(unrelated)?.isInvalidated).toBe(false);
  });
});
