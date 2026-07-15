import { describe, it, expect } from "vitest";
import { gsap, ScrollTrigger, SplitText, prefersReducedMotion } from "./gsap";

describe("lib/gsap", () => {
  it("registers ScrollTrigger and SplitText on the gsap core", () => {
    expect(gsap.core.globals().ScrollTrigger).toBe(ScrollTrigger);
    // gsap 3.15 registers SplitText under its internal class name "_SplitText"
    // (named class expression), so assert registration via the real key.
    expect(gsap.core.globals()._SplitText).toBe(SplitText);
  });

  it("prefersReducedMotion reflects matchMedia (mocked to false in setup)", () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
