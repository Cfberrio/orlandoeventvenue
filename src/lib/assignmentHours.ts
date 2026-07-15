export type HoursSource = "override" | "package" | "booking";

export interface AssignmentHours {
  start: string | null;
  end: string | null;
  source: HoursSource;
}

export interface AssignmentHoursInput {
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  assignmentRole: string;
  packageName: string | null;
  packageStartTime: string | null;
  packageEndTime: string | null;
  bookingStartTime: string | null;
  bookingEndTime: string | null;
}

export function getAssignmentHours(input: AssignmentHoursInput): AssignmentHours {
  if (input.scheduledStartTime && input.scheduledEndTime) {
    return { start: input.scheduledStartTime, end: input.scheduledEndTime, source: "override" };
  }
  const hasPackage = !!input.packageName && input.packageName !== "none";
  if (input.assignmentRole === "Production" && hasPackage && input.packageStartTime && input.packageEndTime) {
    return { start: input.packageStartTime, end: input.packageEndTime, source: "package" };
  }
  return { start: input.bookingStartTime, end: input.bookingEndTime, source: "booking" };
}

// Compares "HH:MM" or "HH:MM:SS" lexicographically (zero-padded 24h → safe).
export function isValidTimeRange(start: string, end: string): boolean {
  if (!start || !end) return false;
  return end > start;
}
