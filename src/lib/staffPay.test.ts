import { describe, expect, it } from "vitest";
import { payExplanation, rateField, staffPayValues, validateStaffPay } from "./staffPay";

describe("staff pay (E-5)", () => {
  it("asks for a rate only where payroll reads it", () => {
    expect(rateField("hourly", "Production")).not.toBeNull();
    expect(rateField("per_assignment", "Bar Vendor")).not.toBeNull();
    expect(rateField("per_assignment", "Assistant")).toBeNull();
    expect(rateField("none", "Production")).toBeNull();
  });

  it("requires a positive rate for hourly and bar vendor flat fee", () => {
    expect(validateStaffPay({ payrollType: "hourly", role: "Production", rate: "" })).toMatch(/hourly rate/);
    expect(validateStaffPay({ payrollType: "hourly", role: "Production", rate: "0" })).toMatch(/hourly rate/);
    expect(validateStaffPay({ payrollType: "per_assignment", role: "Bar Vendor", rate: "abc" })).toMatch(/flat fee/);
    expect(validateStaffPay({ payrollType: "hourly", role: "Production", rate: "5000" })).toMatch(/too high/);
    expect(validateStaffPay({ payrollType: "hourly", role: "Production", rate: "50" })).toBeNull();
    expect(validateStaffPay({ payrollType: "per_assignment", role: "Custodial", rate: "" })).toBeNull();
  });

  it("stores the rate only when it is used", () => {
    expect(staffPayValues({ payrollType: "hourly", role: "Production", rate: "52.499" })).toEqual({
      payroll_type: "hourly",
      hourly_rate: 52.5,
    });
    expect(staffPayValues({ payrollType: "per_assignment", role: "Assistant", rate: "99" })).toEqual({
      payroll_type: "per_assignment",
      hourly_rate: null,
    });
  });

  it("explains what payroll will generate", () => {
    expect(payExplanation("none", "Production", null)).toMatch(/No payroll/);
    expect(payExplanation("per_assignment", "Assistant", null)).toMatch(/\$80/);
    expect(payExplanation("per_assignment", "Production", null)).toMatch(/no lines/);
    expect(payExplanation("hourly", "Production", 50)).toMatch(/\$50.00 per hour/);
  });
});
