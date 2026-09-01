import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OevNav from "./OevNav";
import MobileBar from "./MobileBar";

describe("OevNav", () => {
  it("renders anchor links and Book Now", () => {
    render(<OevNav />);
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "#pricing");
    expect(screen.getByRole("link", { name: "Gallery" })).toHaveAttribute("href", "#gallery");
    expect(screen.getAllByRole("link", { name: "Book Now" })[0]).toHaveAttribute("href", "/book");
  });
});

describe("MobileBar", () => {
  it("renders sticky Book Now", () => {
    render(<MobileBar />);
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});
