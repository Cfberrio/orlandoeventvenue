import { describe, it, expect } from "vitest";
import { validateProductionTimes } from "./productionValidation";

describe("validateProductionTimes", () => {
  it("returns null when no package is selected", () => {
    expect(validateProductionTimes("none", "", "", null)).toBeNull();
  });

  it("requires both times when a package is selected", () => {
    expect(validateProductionTimes("basic", "", "12:00", null)).toEqual({
      title: "Missing Information",
      description: "Please specify both start and end times for production",
    });
    expect(validateProductionTimes("basic", "10:00", "", null)).toEqual({
      title: "Missing Information",
      description: "Please specify both start and end times for production",
    });
  });

  it("rejects end time equal to or before start time", () => {
    expect(validateProductionTimes("led", "12:00", "12:00", null)).toEqual({
      title: "Invalid Time Range",
      description: "End time must be after start time",
    });
    expect(validateProductionTimes("led", "14:00", "12:00", null)).toEqual({
      title: "Invalid Time Range",
      description: "End time must be after start time",
    });
  });

  // Core of the task: admins can configure sub-4-hour production.
  it("allows a 2-hour production duration (no 4-hour minimum)", () => {
    expect(validateProductionTimes("basic", "10:00", "12:00", null)).toBeNull();
  });

  it("allows a 1-hour production duration", () => {
    expect(validateProductionTimes("workshop", "10:00", "11:00", null)).toBeNull();
  });

  it("allows a 30-minute production duration", () => {
    expect(validateProductionTimes("led", "10:00", "10:30", null)).toBeNull();
  });

  it("still allows durations of 4 hours or more", () => {
    expect(validateProductionTimes("basic", "10:00", "16:00", null)).toBeNull();
  });

  it("keeps the within-booking-window rule for hourly bookings", () => {
    const booking = {
      booking_type: "hourly",
      start_time: "10:00:00",
      end_time: "14:00:00",
    };
    // Sub-4h but inside the window → valid.
    expect(validateProductionTimes("basic", "11:00", "13:00", booking)).toBeNull();
    // Outside the window → rejected.
    expect(validateProductionTimes("basic", "09:00", "13:00", booking)).toEqual({
      title: "Invalid Time Range",
      description: "Production hours must be within booking time (10:00 - 14:00)",
    });
    expect(validateProductionTimes("basic", "11:00", "15:00", booking)).toEqual({
      title: "Invalid Time Range",
      description: "Production hours must be within booking time (10:00 - 14:00)",
    });
  });

  it("does not apply the booking-window rule to non-hourly bookings", () => {
    const booking = {
      booking_type: "daily",
      start_time: "10:00:00",
      end_time: "14:00:00",
    };
    expect(validateProductionTimes("basic", "08:00", "09:00", booking)).toBeNull();
  });
});
