import { describe, expect, it } from "vitest";
import { actorLabel } from "./BookingEditHistoryCard";

const ID = "6f1c2a7e-0000-4000-8000-00000000ab12";

describe("actorLabel (C-2)", () => {
  it("prefers the stored email", () => {
    expect(actorLabel({ actor_email: "office@example.com", actor_id: ID })).toBe("office@example.com");
  });

  it("names the current admin when only the id was stored", () => {
    expect(actorLabel({ actor_id: ID }, { id: ID, email: "me@example.com" })).toBe("me@example.com");
  });

  it("never prints a full raw id for another user", () => {
    const label = actorLabel({ actor_id: ID }, { id: "someone-else", email: "x@example.com" });
    expect(label).toBe("Admin ·ab12");
    expect(label).not.toContain(ID);
  });

  it("falls back to System with no actor", () => {
    expect(actorLabel({})).toBe("System");
  });
});
