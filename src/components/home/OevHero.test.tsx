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

  it("renders the 5-star reviews badge, address link and background photo", () => {
    const { container } = render(<OevHero />);
    expect(screen.getByRole("link", { name: /5 stars on Google/i })).toHaveAttribute(
      "href",
      "https://g.page/r/CU-yUA0El90UEAE/review",
    );
    expect(screen.getByRole("link", { name: /3847 E Colonial Dr/i })).toHaveAttribute(
      "href",
      expect.stringContaining("google.com/maps"),
    );
    expect(container.querySelector(".hero-bg")).not.toBeNull();
  });
});
