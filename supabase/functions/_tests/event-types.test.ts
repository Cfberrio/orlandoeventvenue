import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { eventTypeLabel } from "../_shared/event-types";

describe("shared event type labels", () => {
  it("keeps the frontend and edge-function copies byte-identical", () => {
    const frontend = readFileSync(resolve(process.cwd(), "src/lib/eventTypes.ts"));
    const edge = readFileSync(resolve(process.cwd(), "supabase/functions/_shared/event-types.ts"));

    expect(frontend.equals(edge)).toBe(true);
  });

  it("uses the configured celebration-of-life label", () => {
    expect(eventTypeLabel("celebration-of-life")).toBe("Celebration of Life / Memorial Reception");
  });

  it("uses custom text for other event types", () => {
    expect(eventTypeLabel("other", "Graduation brunch")).toBe("Graduation brunch");
  });

  it("matches other case-insensitively and falls back when custom text is absent", () => {
    expect(eventTypeLabel("Other", null)).toBe("Other");
  });

  it("preserves a title-cased legacy free value", () => {
    expect(eventTypeLabel("Corporate Event")).toBe("Corporate Event");
  });

  it("capitalizes a legacy single-word value", () => {
    expect(eventTypeLabel("celebration")).toBe("Celebration");
  });

  it("uses Event for a missing event type", () => {
    expect(eventTypeLabel(null)).toBe("Event");
  });

  it("truncates custom other text to 60 characters", () => {
    expect(eventTypeLabel("other", "x".repeat(70))).toBe("x".repeat(60));
  });
});
