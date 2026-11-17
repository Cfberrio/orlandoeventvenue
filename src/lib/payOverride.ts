// E-6 (86e40ach2): validation for the pay override form; the database
// (admin_set_assignment_pay) enforces the same rules.

export type PayMode = "computed" | "override" | "excluded";

export function validatePayOverride(input: { mode: PayMode; amount: string; reason: string }): string | null {
  if (input.mode === "computed") return null;
  if (!input.reason.trim()) return "Say why the pay is changed";
  if (input.mode === "override") {
    const n = Number(input.amount);
    if (input.amount.trim() === "" || !Number.isFinite(n) || n < 0) return "Enter the agreed amount";
    if (n > 10000) return "Amount must be $10,000 or less";
  }
  return null;
}

export function payModeOf(row: { pay_override_mode?: string | null } | null | undefined): PayMode {
  return row?.pay_override_mode === "override" || row?.pay_override_mode === "excluded" ? row.pay_override_mode : "computed";
}
