/**
 * Validation for lifecycle writes coming from GHL workflows (ClickUp 86e3zjfq6).
 *
 * "GHL proposes, the DB validates": the GHL workflows stay the driver of the
 * forward lifecycle, but each request is checked against the same readiness
 * rule the database enforces (public.booking_readiness):
 *
 *   pending          -> confirmed          always
 *   confirmed        -> pre_event_ready    only when eligible (checklist +
 *                                          every selected staff accepted this
 *                                          event; external = staff-exempt),
 *                                          otherwise DEFERRED
 *   confirmed|pre_event_ready -> in_progress   only once the event has started,
 *                                          otherwise DEFERRED (the GHL workflow
 *                                          used to fire this on balance payment)
 *   in_progress      -> post_event
 *   post_event       -> closed_review_complete
 *   any unfinished   -> cancelled
 *
 * Anything else (backwards moves, skipping states) is IGNORED and logged.
 * "Deferred" is not an error: GHL gets a 200 and the workflow fires again on
 * the next sync, when sync-to-ghl reports pre_event_ready_eligible / event_started.
 *
 * Pure module: imported by the edge function and by vitest.
 */

export interface GhlLifecycleContext {
  /** booking_readiness().ready */
  eligible: boolean;
  /** booking_readiness().event_started */
  eventStarted: boolean;
}

export type GhlLifecycleDecision =
  | { kind: "apply"; lifecycle: string }
  | { kind: "defer"; reason: "readiness_unmet" | "before_event_start" }
  | { kind: "ignore"; reason: string };

const FORWARD: Record<string, readonly string[]> = {
  confirmed: ["pending"],
  pre_event_ready: ["confirmed"],
  in_progress: ["confirmed", "pre_event_ready"],
  post_event: ["in_progress"],
  closed_review_complete: ["post_event"],
  cancelled: ["pending", "confirmed", "pre_event_ready", "in_progress", "post_event"],
};

export function decideGhlLifecycleWrite(
  current: string | null | undefined,
  requested: string | null | undefined,
  ctx: GhlLifecycleContext,
): GhlLifecycleDecision | null {
  if (!requested) return null;

  const from = current || "pending";
  if (requested === from) return { kind: "ignore", reason: "unchanged" };

  const allowedFrom = FORWARD[requested];
  if (!allowedFrom) return { kind: "ignore", reason: `ghl_cannot_set_${requested}` };
  if (!allowedFrom.includes(from)) {
    return { kind: "ignore", reason: `ghl_cannot_move_${from}_to_${requested}` };
  }

  if (requested === "pre_event_ready" && !ctx.eligible) {
    return { kind: "defer", reason: "readiness_unmet" };
  }
  if (requested === "in_progress" && !ctx.eventStarted) {
    return { kind: "defer", reason: "before_event_start" };
  }

  return { kind: "apply", lifecycle: requested };
}
