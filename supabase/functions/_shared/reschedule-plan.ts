// Pure scheduling decisions used when a booking is rescheduled. Kept free of
// Deno/Supabase imports so vitest can exercise the exact code the edge
// functions run (supabase/functions/_tests/reschedule-plan.test.ts).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export const BALANCE_JOB_TYPES = [
  "balance_retry_1",
  "balance_retry_2",
  "balance_retry_3",
  "create_balance_payment_link",
] as const;

const RETRY_ORDER = ["balance_retry_1", "balance_retry_2", "balance_retry_3"] as const;
type RetryType = typeof RETRY_ORDER[number];

/**
 * Whole calendar days from `fromDate` to `toDate` (both YYYY-MM-DD).
 * Compares calendar dates, not elapsed time: dividing the gap between two
 * local midnights by 24h loses an hour across the spring DST change, so 16
 * days floored to 15 and triggered the short-notice balance path a day early.
 */
export function calendarDaysBetween(fromDate: string, toDate: string): number {
  const ordinal = (d: string) => {
    const [y, m, day] = d.slice(0, 10).split("-").map(Number);
    return Date.UTC(y, m - 1, day) / DAY_MS;
  };
  return ordinal(toDate) - ordinal(fromDate);
}

/** Short-notice threshold: balance is due 15 days before the event. */
export const BALANCE_DUE_DAYS = 15;
const RETRY_SPACING_MS = 48 * HOUR_MS;

export interface BalancePlanInput {
  /** Whole Orlando calendar days from today to the event date. */
  diffDays: number;
  /** A balance link already reached the guest (bookings.balance_payment_url is set). */
  linkAlreadySent: boolean;
  /**
   * Balance retry types that already ran (status completed). Everything else
   * in the chain is still owed — including retries the reschedule RPC
   * cancelled as past-due before this runs, which is why the plan is not
   * built from "what was pending".
   */
  completedTypes: string[];
  /** Event date at 09:00 Orlando, as UTC ms (the long-notice anchor). */
  eventAnchorMs: number;
  /** Event start as UTC ms; no balance retry is scheduled at or after it. */
  eventStartMs: number;
  nowMs: number;
}

export type BalancePlan =
  | { action: "long_notice"; jobs: { job_type: RetryType; run_at: string }[] }
  | { action: "short_notice_create_now"; jobs: { job_type: RetryType; run_at: string }[] }
  | { action: "short_notice_link_sent"; jobs: { job_type: RetryType; run_at: string }[] };

/**
 * Decides which balance jobs to (re)create after a reschedule.
 *
 * - More than 15 days out: the normal 3-retry chain anchored at T-15 09:00.
 * - 15 days or less and no link ever sent: create the link now + one retry in
 *   48h (same as a new short-notice booking).
 * - 15 days or less and a link was already sent: never send a new link right
 *   away. The retries that have not run yet are recreated, each at its normal
 *   anchor or 48h after the previous send, whichever is later, and never at
 *   or after the event start. This keeps a reschedule from firing
 *   balance_retry_1/2/3 back to back.
 */
export function planBalanceReschedule(input: BalancePlanInput): BalancePlan {
  const { diffDays, linkAlreadySent, completedTypes, eventAnchorMs, eventStartMs, nowMs } = input;
  const t15 = eventAnchorMs - BALANCE_DUE_DAYS * DAY_MS;
  const anchors: Record<RetryType, number> = {
    balance_retry_1: t15,
    balance_retry_2: t15 + RETRY_SPACING_MS,
    balance_retry_3: t15 + 2 * RETRY_SPACING_MS,
  };

  if (diffDays > BALANCE_DUE_DAYS) {
    return {
      action: "long_notice",
      jobs: RETRY_ORDER.map((job_type) => ({ job_type, run_at: new Date(anchors[job_type]).toISOString() })),
    };
  }

  if (!linkAlreadySent) {
    const retryAt = nowMs + RETRY_SPACING_MS;
    return {
      action: "short_notice_create_now",
      jobs: retryAt < eventStartMs
        ? [{ job_type: "balance_retry_2", run_at: new Date(retryAt).toISOString() }]
        : [],
    };
  }

  const remaining = RETRY_ORDER.filter((t) => !completedTypes.includes(t));
  const jobs: { job_type: RetryType; run_at: string }[] = [];
  let previousMs = nowMs;
  for (const job_type of remaining) {
    const runAtMs = Math.max(anchors[job_type], previousMs + RETRY_SPACING_MS);
    if (runAtMs >= eventStartMs) break;
    jobs.push({ job_type, run_at: new Date(runAtMs).toISOString() });
    previousMs = runAtMs;
  }
  return { action: "short_notice_link_sent", jobs };
}

/**
 * After a reschedule pushes the event more than 30 days out, no host-report
 * step applies yet, but the booking may still carry the step it reached for
 * the old date. The pre_start job would then find the step already set and
 * skip the GHL update, so the 30-day message for the new date never goes out.
 * Returns true when the stale step must be cleared.
 */
export function shouldClearHostReportStep(
  forceReschedule: boolean,
  immediateStep: string | null,
  currentStep: string | null | undefined,
): boolean {
  return forceReschedule && immediateStep === null && currentStep != null;
}
