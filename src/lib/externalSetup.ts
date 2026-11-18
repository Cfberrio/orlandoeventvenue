// External bookings run their post-create steps from the admin's browser
// (automation, GHL snapshot, E01 email). If the tab closes midway, a step is
// silently lost. Each step leaves a booking_events marker, so a missing marker
// means "retry this step". ClickUp 86e40ach2 (Phase 2 follow-up, GHL retry).

export type ExternalSetupStep = "automation" | "ghl" | "confirmation";

export const EXTERNAL_SETUP_MARKERS: Record<ExternalSetupStep, string> = {
  automation: "booking_automation_triggered",
  ghl: "external_ghl_synced",
  confirmation: "external_confirmation_sent",
};

/** Bookings created before this were never marked; don't alert on them. */
export const EXTERNAL_SETUP_TRACKED_SINCE = "2026-11-18T00:00:00Z";

export const EXTERNAL_SETUP_LABELS: Record<ExternalSetupStep, string> = {
  automation: "Automation (reminders)",
  ghl: "GHL sync",
  confirmation: "Confirmation email",
};

/** Steps the Retry button may re-run on its own. E01 emails the guest, so it
 * only goes out from its own explicit button. */
export const AUTO_RETRY_STEPS: ExternalSetupStep[] = ["automation", "ghl"];

export interface SetupEvent {
  event_type: string;
  metadata?: unknown;
}

type StepResult = { success?: boolean } | null | undefined;

/** trigger-booking-automation logs its marker even when a sub-step failed;
 * the per-step results are in the metadata. */
export function automationSucceeded(metadata: unknown): boolean {
  const m = (metadata ?? {}) as { host_report_result?: StepResult; guest_feedback_result?: StepResult };
  return m.host_report_result?.success !== false && m.guest_feedback_result?.success !== false;
}

export function missingExternalSetupSteps(
  booking: { email?: string | null },
  events: Iterable<SetupEvent | string>,
): ExternalSetupStep[] {
  const list = Array.from(events, (e) => (typeof e === "string" ? { event_type: e } : e));
  const has = (step: ExternalSetupStep) => list.some((e) => e.event_type === EXTERNAL_SETUP_MARKERS[step]);
  const missing: ExternalSetupStep[] = [];
  const automationOk = list.some(
    (e) => e.event_type === EXTERNAL_SETUP_MARKERS.automation && automationSucceeded(e.metadata),
  );
  if (!automationOk) missing.push("automation");
  if (!has("ghl")) missing.push("ghl");
  // E01 can't be sent without an email, so it is not owed.
  if (booking.email?.trim() && !has("confirmation")) missing.push("confirmation");
  return missing;
}
