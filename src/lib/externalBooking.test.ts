import { describe, it, expect } from "vitest";
import { buildExternalFullName } from "./externalBooking";
import { generateReservationNumber } from "@/hooks/useCreateBooking";

describe("buildExternalFullName", () => {
  it("puts the real client name first so GHL firstName is the client's name", () => {
    const full = buildExternalFullName("Carla Rivera");
    expect(full).toBe("Carla Rivera - External");
    // GHL derives firstName from the first space-separated token
    expect(full.split(" ")[0]).toBe("Carla");
  });

  it("keeps the External marker for admin/calendar identification", () => {
    expect(buildExternalFullName("Carla Rivera")).toContain("- External");
  });

  it("trims whitespace from the client name", () => {
    expect(buildExternalFullName("  Carla Rivera ")).toBe("Carla Rivera - External");
  });
});

describe("generateReservationNumber (shared with external bookings)", () => {
  it("generates OEV-XXXXXX format without confusing characters", () => {
    const num = generateReservationNumber();
    expect(num).toMatch(/^OEV-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
});
