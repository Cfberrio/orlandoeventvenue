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

// Compares "HH:MM" or "HH:MM:SS" times; normalizes precision so mixed formats compare correctly.
export function isValidTimeRange(start: string, end: string): boolean {
  if (!start || !end) return false;
  const norm = (t: string) => (t.length === 5 ? `${t}:00` : t);
  return norm(end) > norm(start);
}
