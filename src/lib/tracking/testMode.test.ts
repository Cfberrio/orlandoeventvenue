import { beforeEach, describe, expect, it } from "vitest";
import { captureTestEventCode, getTestEventCode } from "./testMode";

describe("Meta test mode (session-scoped)", () => {
  beforeEach(() => window.sessionStorage.clear());

  it("is off for normal traffic", () => {
    captureTestEventCode("?utm_source=facebook&fbclid=abc");
    expect(getTestEventCode()).toBeNull();
  });

  it("stores a Meta-shaped code for this tab", () => {
    captureTestEventCode("?oev_test_event_code=TEST12345");
    expect(getTestEventCode()).toBe("TEST12345");
    // Later navigations without the param keep the session in test mode.
    captureTestEventCode("?type=hourly");
    expect(getTestEventCode()).toBe("TEST12345");
  });

  it("rejects malformed codes and turns off on request", () => {
    captureTestEventCode("?oev_test_event_code=<script>");
    expect(getTestEventCode()).toBeNull();
    captureTestEventCode("?oev_test_event_code=TEST12345");
    captureTestEventCode("?oev_test_event_code=off");
    expect(getTestEventCode()).toBeNull();
  });
});
