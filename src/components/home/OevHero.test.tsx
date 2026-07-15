import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OevHero from "./OevHero";

describe("OevHero", () => {
  it("renders the giant line, event types and CTAs", () => {
    render(<OevHero />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Corporate")).toBeInTheDocument();
    expect(screen.getByText("Celebrations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
    expect(screen.getByRole("link", { name: "Schedule a Tour" })).toHaveAttribute(
      "href",
      "/schedule-tour",
    );
  });

  it("renders the four stat counters", () => {
    render(<OevHero />);
    expect(screen.getByText("Chairs")).toBeInTheDocument();
    expect(screen.getByText("Tables")).toBeInTheDocument();
    expect(screen.getByText("Deposit")).toBeInTheDocument();
  });
});
