// Pure guards for guest-facing messages (ClickUp 86e40ach2, second pass).
// No Deno/Supabase imports: vitest runs the same code the edge functions run.

import { policyAllows, type CommsPolicy } from "./guest-timeline.ts";

const DEAD_STATUSES = new Set(["cancelled", "declined"]);

/** True when the booking is cancelled or declined by status OR lifecycle. */
export function isBookingInactive(status: string | null | undefined, lifecycleStatus: string | null | undefined): boolean {
  return DEAD_STATUSES.has(String(status ?? "")) || DEAD_STATUSES.has(String(lifecycleStatus ?? ""));
}

/**
 * CM2-03: why the post-event "file your Guest Report" email must not go out,
 * or null when it may. OEV-Y4UP6Y (cancelled) got it; W6BDCN, F2EB76 and
 * 9SQGNT got it after they had already filed the report.
 */
export function guestFeedbackSkipReason(input: {
  status: string | null | undefined;
  lifecycle_status: string | null | undefined;
  reportSubmitted: boolean;
  policy?: CommsPolicy | null;
}): string | null {
  if (isBookingInactive(input.status, input.lifecycle_status)) return "booking_inactive";
  if (input.reportSubmitted) return "guest_report_already_submitted";
  if (!policyAllows(input.policy, "include_host_report")) return "policy_no_host_report";
  return null;
}
