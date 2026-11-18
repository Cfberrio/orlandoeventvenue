import { describe, expect, it } from "vitest";
import { staffSaveErrorMessage } from "./staffForm";

describe("staffSaveErrorMessage (C-9)", () => {
  it("explains a duplicate email", () => {
    expect(staffSaveErrorMessage({ code: "23505", message: "duplicate key value violates unique constraint \"staff_members_email_unique\"" }))
      .toMatch(/already used by another staff member/);
  });

  it("passes other errors through", () => {
    expect(staffSaveErrorMessage(new Error("boom"))).toBe("boom");
    expect(staffSaveErrorMessage({ message: "pg says no" })).toBe("pg says no");
  });
});
