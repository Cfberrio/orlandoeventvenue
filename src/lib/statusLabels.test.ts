import { describe, expect, it } from "vitest";
import {
  bookingTypeLabel,
  cleaningTypeLabel,
  humanizeCode,
  lifecycleLabel,
  paymentStatusLabel,
  workStatusLabel,
} from "./statusLabels";

describe("statusLabels", () => {
  it("maps known lifecycle codes", () => {
    expect(lifecycleLabel("pre_event_ready")).toBe("Ready for Event");
    expect(lifecycleLabel("closed_review_complete")).toBe("Closed");
    expect(lifecycleLabel("cancelled")).toBe("Cancelled");
  });

  it("maps payment, booking type, cleaning type and work status", () => {
    expect(paymentStatusLabel("fully_paid")).toBe("Paid");
    expect(paymentStatusLabel("deposit_paid")).toBe("Deposit Paid");
    expect(bookingTypeLabel("hourly")).toBe("Hourly");
    expect(cleaningTypeLabel("touch_up")).toBe("Touch-up");
    expect(workStatusLabel("in_progress")).toBe("In Progress");
  });

  it("never prints a raw underscore code for unknown values", () => {
    expect(lifecycleLabel("some_new_state")).toBe("Some New State");
    expect(humanizeCode("misc")).toBe("Misc");
  });

  it("returns a dash for empty values", () => {
    expect(lifecycleLabel(null)).toBe("—");
    expect(paymentStatusLabel("")).toBe("—");
  });
});
