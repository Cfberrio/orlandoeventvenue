import { describe, expect, it } from "vitest";
import { bookingSearchOrFilter, cleanBookingSearch } from "./bookingSearch";

describe("booking search (E-14)", () => {
  it("searches name, email and reservation number", () => {
    expect(bookingSearchOrFilter("jzhy9z")).toBe(
      "full_name.ilike.%jzhy9z%,email.ilike.%jzhy9z%,reservation_number.ilike.%jzhy9z%",
    );
  });

  it("strips characters that would break the PostgREST or filter", () => {
    expect(cleanBookingSearch("a,b(c)*%d")).toBe("a b c d");
    expect(bookingSearchOrFilter("x),id.eq.1")).not.toMatch(/[(),]id/);
  });

  it("keeps emails and names with accents", () => {
    expect(cleanBookingSearch("josé.o'neil@mail.com")).toBe("josé.o'neil@mail.com");
  });

  it("returns null for empty input", () => {
    expect(bookingSearchOrFilter("  ,() ")).toBeNull();
    expect(bookingSearchOrFilter(undefined)).toBeNull();
  });
});
