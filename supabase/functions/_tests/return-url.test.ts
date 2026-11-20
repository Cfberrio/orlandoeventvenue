import { describe, expect, it } from "vitest";
import { safeReturnUrl } from "../_shared/return-url.ts";

describe("safeReturnUrl (Stripe deposit success/cancel base)", () => {
  it("keeps our own site and drops query/hash", () => {
    expect(safeReturnUrl("https://orlandoeventvenue.org/booking-confirmation")).toBe(
      "https://orlandoeventvenue.org/booking-confirmation",
    );
    expect(safeReturnUrl("https://www.orlandoeventvenue.org/booking-confirmation?x=1#y")).toBe(
      "https://www.orlandoeventvenue.org/booking-confirmation",
    );
    expect(safeReturnUrl("https://orlandoeventvenue.lovable.app/booking-confirmation")).toBe(
      "https://orlandoeventvenue.lovable.app/booking-confirmation",
    );
  });

  it("keeps this project's Lovable previews", () => {
    for (const host of [
      "id-preview--9838d610-03f9-4469-a8f3-362588d13d76.lovable.app",
      "9838d610-03f9-4469-a8f3-362588d13d76.lovableproject.com",
    ]) {
      expect(safeReturnUrl(`https://${host}/booking-confirmation`)).toBe(`https://${host}/booking-confirmation`);
    }
  });

  it("keeps local dev over http", () => {
    expect(safeReturnUrl("http://localhost:8080/booking-confirmation")).toBe(
      "http://localhost:8080/booking-confirmation",
    );
    expect(safeReturnUrl("http://127.0.0.1:5173/booking-confirmation")).toBe(
      "http://127.0.0.1:5173/booking-confirmation",
    );
  });

  it("rejects everything else", () => {
    for (const bad of [
      // any other Lovable site — anyone can publish one for free
      "https://attacker.lovable.app/booking-confirmation",
      "https://evil.lovableproject.com/booking-confirmation",
      "https://evil.lovable.dev/booking-confirmation",
      "https://id-preview--00000000-0000-0000-0000-000000000000.lovable.app/x",
      "https://evil.example/booking-confirmation",
      "https://orlandoeventvenue.org.evil.example/booking-confirmation",
      "https://evilorlandoeventvenue.org/booking-confirmation",
      "https://orlandoeventvenue.com/booking-confirmation",
      "http://orlandoeventvenue.org/booking-confirmation",
      "https://orlandoeventvenue.org:8443/booking-confirmation",
      "https://user:pass@orlandoeventvenue.org/booking-confirmation",
      "https://localhost/booking-confirmation",
      "javascript:alert(1)",
      "not a url",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(safeReturnUrl(bad)).toBeNull();
    }
  });
});
