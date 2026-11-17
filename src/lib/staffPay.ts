// E-5 (86e40ach2): pay type and rate on the Staff form.
//
// Mirrors populate_staff_payroll_items:
// - hourly: hours x hourly_rate (the DB falls back to $50 when the rate is empty,
//   so the form requires an explicit rate instead of relying on that).
// - per_assignment: Bar Vendor gets hourly_rate as a flat fee per event;
//   Assistant gets $80; Custodial is paid by cleaning type ($40/$80/$150).
// - none: no payroll lines are ever generated.

export type PayrollType = "none" | "hourly" | "per_assignment";

export const PAYROLL_TYPES: { value: PayrollType; label: string }[] = [
  { value: "hourly", label: "Hourly" },
  { value: "per_assignment", label: "Per event" },
  { value: "none", label: "Not paid through payroll" },
];

/** Whether the rate field applies, and what it means, for this pay type + role. */
export function rateField(payrollType: PayrollType, role: string): { label: string } | null {
  if (payrollType === "hourly") return { label: "Hourly rate ($ per hour) *" };
  if (payrollType === "per_assignment" && role === "Bar Vendor") return { label: "Flat fee per event ($) *" };
  return null;
}

/** Plain-language explanation of what payroll will generate. */
export function payExplanation(payrollType: PayrollType, role: string, rate: number | null): string {
  if (payrollType === "none") return "No payroll lines are created for this person.";
  if (payrollType === "hourly") {
    return rate && rate > 0
      ? `Paid $${rate.toFixed(2)} per hour worked on each event.`
      : "Enter the hourly rate.";
  }
  if (role === "Bar Vendor") {
    return rate && rate > 0 ? `Paid a flat $${rate.toFixed(2)} per event.` : "Enter the flat fee per event.";
  }
  if (role === "Assistant") return "Paid a flat $80 per event.";
  if (role === "Custodial") return "Paid by cleaning type: touch-up $40, regular $80, deep $150 (+ celebration surcharge).";
  return "This role has no per-event rate: payroll will create no lines. Use Hourly instead.";
}

export interface StaffPayInput {
  payrollType: PayrollType;
  role: string;
  rate: string;
}

/** Returns an error message, or null when the pay settings are valid. */
export function validateStaffPay(input: StaffPayInput): string | null {
  const field = rateField(input.payrollType, input.role);
  if (!field) return null;
  const n = Number(input.rate);
  if (input.rate.trim() === "" || !Number.isFinite(n) || n <= 0) {
    return input.payrollType === "hourly" ? "Enter an hourly rate above $0" : "Enter a flat fee above $0";
  }
  if (n > 1000) return "Rate looks too high; check the amount";
  return null;
}

/** Values to store: the rate is kept only where payroll reads it. */
export function staffPayValues(input: StaffPayInput): { payroll_type: PayrollType; hourly_rate: number | null } {
  const field = rateField(input.payrollType, input.role);
  return {
    payroll_type: input.payrollType,
    hourly_rate: field ? Math.round(Number(input.rate) * 100) / 100 : null,
  };
}
