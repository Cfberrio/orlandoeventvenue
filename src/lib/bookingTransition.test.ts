import { describe, expect, it } from "vitest";
import { transitionBooking } from "./bookingTransition";

const client = (result: { data: unknown; error: { message: string } | null }) => {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    rpc: (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return Promise.resolve(result);
    },
  };
};

describe("admin lifecycle transition (E-4)", () => {
  it("passes the move and reason through", async () => {
    const c = client({ data: { changed: true }, error: null });
    expect(await transitionBooking(c, "b1", "post_event", { reason: "fix", force: true })).toEqual({ ok: true, changed: true });
    expect(c.calls[0]).toEqual({ p_booking_id: "b1", p_to: "post_event", p_reason: "fix", p_force: true });
  });

  it("offers a correction when the move is outside the normal flow", async () => {
    const c = client({
      data: null,
      error: { message: 'cannot move from confirmed to post event: use "Correct status" with a reason if this fixes a mistake' },
    });
    const r = await transitionBooking(c, "b1", "post_event");
    expect(r.ok).toBe(false);
    expect(r.needsCorrection).toBe(true);
  });

  it("does not offer a correction for other errors (readiness gate)", async () => {
    const c = client({ data: null, error: { message: "Cannot move to Pre-Event Ready: waiting for staff" } });
    expect((await transitionBooking(c, "b1", "pre_event_ready")).needsCorrection).toBe(false);
  });
});
