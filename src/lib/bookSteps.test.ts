import { describe, expect, it } from "vitest";
import { canJumpToStep } from "./bookSteps";

describe("canJumpToStep (UI2-15)", () => {
  it("allows going back to completed steps", () => {
    expect(canJumpToStep(1, 5)).toBe(true);
    expect(canJumpToStep(4, 5)).toBe(true);
  });

  it("blocks the current step and every later one", () => {
    expect(canJumpToStep(5, 5)).toBe(false);
    expect(canJumpToStep(6, 1)).toBe(false);
    expect(canJumpToStep(6, 5)).toBe(false);
  });

  it("rejects out-of-range targets", () => {
    expect(canJumpToStep(0, 3)).toBe(false);
    expect(canJumpToStep(1.5, 3)).toBe(false);
  });
});
