import { describe, expect, it } from "vitest";
import { automationSucceeded, missingExternalSetupSteps } from "./externalSetup";

describe("missingExternalSetupSteps", () => {
  it("is empty when every marker exists", () => {
    expect(
      missingExternalSetupSteps({ email: "a@b.co" }, [
        "booking_automation_triggered",
        "external_ghl_synced",
        "external_confirmation_sent",
      ]),
    ).toEqual([]);
  });

  it("lists the steps whose marker is missing", () => {
    expect(missingExternalSetupSteps({ email: "a@b.co" }, ["booking_automation_triggered"])).toEqual([
      "ghl",
      "confirmation",
    ]);
  });

  it("does not owe the confirmation email when the booking has no email", () => {
    expect(missingExternalSetupSteps({ email: "" }, [])).toEqual(["automation", "ghl"]);
    expect(missingExternalSetupSteps({ email: null }, ["booking_automation_triggered", "external_ghl_synced"])).toEqual([]);
  });

  it("treats an automation run with a failed sub-step as missing", () => {
    const failed = {
      event_type: "booking_automation_triggered",
      metadata: { host_report_result: { success: false }, guest_feedback_result: { success: true } },
    };
    expect(missingExternalSetupSteps({ email: null }, [failed, "external_ghl_synced"])).toEqual(["automation"]);
    const ok = { event_type: "booking_automation_triggered", metadata: { host_report_result: { success: true } } };
    expect(missingExternalSetupSteps({ email: null }, [failed, ok, "external_ghl_synced"])).toEqual([]);
  });

  it("automationSucceeded tolerates missing metadata", () => {
    expect(automationSucceeded(null)).toBe(true);
    expect(automationSucceeded({ guest_feedback_result: { success: false } })).toBe(false);
  });
});
