import { describe, it, expect } from "vitest";
import { getAssignmentHours, isValidTimeRange } from "./assignmentHours";

const baseInput = {
  scheduledStartTime: null as string | null,
  scheduledEndTime: null as string | null,
  assignmentRole: "Assistant",
  packageName: "none" as string | null,
  packageStartTime: null as string | null,
  packageEndTime: null as string | null,
  bookingStartTime: "17:00:00" as string | null,
  bookingEndTime: "22:00:00" as string | null,
};

describe("getAssignmentHours", () => {
  it("prefers a per-person override when both scheduled times are set", () => {
    expect(getAssignmentHours({ ...baseInput, scheduledStartTime: "14:00:00", scheduledEndTime: "20:00:00" }))
      .toEqual({ start: "14:00:00", end: "20:00:00", source: "override" });
  });

  it("uses package hours for Production with a real package when no override", () => {
    expect(getAssignmentHours({
      ...baseInput, assignmentRole: "Production", packageName: "gold",
      packageStartTime: "15:00:00", packageEndTime: "19:00:00",
    })).toEqual({ start: "15:00:00", end: "19:00:00", source: "package" });
  });

  it("falls back to booking event hours otherwise", () => {
    expect(getAssignmentHours(baseInput)).toEqual({ start: "17:00:00", end: "22:00:00", source: "booking" });
  });

  it("ignores a half-set override (only start) and falls through", () => {
    expect(getAssignmentHours({ ...baseInput, scheduledStartTime: "14:00:00" }).source).toBe("booking");
  });

  it("ignores package hours when the role is not Production", () => {
    expect(getAssignmentHours({
      ...baseInput, assignmentRole: "Assistant", packageName: "gold",
      packageStartTime: "15:00:00", packageEndTime: "19:00:00",
    })).toEqual({ start: "17:00:00", end: "22:00:00", source: "booking" });
  });
});

describe("isValidTimeRange", () => {
  it("is true when end is after start", () => {
    expect(isValidTimeRange("14:00", "18:00")).toBe(true);
  });
  it("is false when end equals or precedes start", () => {
    expect(isValidTimeRange("18:00", "18:00")).toBe(false);
    expect(isValidTimeRange("19:00", "18:00")).toBe(false);
  });
  it("treats the same instant in mixed HH:MM / HH:MM:SS format as invalid (zero-length)", () => {
    expect(isValidTimeRange("09:05", "09:05:00")).toBe(false);
    expect(isValidTimeRange("09:05:00", "09:05")).toBe(false);
  });
  it("accepts a valid range across mixed formats", () => {
    expect(isValidTimeRange("09:05", "10:00:00")).toBe(true);
  });
});
