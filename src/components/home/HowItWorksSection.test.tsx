import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HowItWorksSection from "./HowItWorksSection";

describe("HowItWorksSection", () => {
  it("renders the four numbered steps", () => {
    render(<HowItWorksSection />);
    expect(screen.getByText("Enter Event Date")).toBeInTheDocument();
    expect(screen.getByText("Payment & Agreement")).toBeInTheDocument();
    expect(screen.getByText("Confirm with Payment")).toBeInTheDocument();
    expect(screen.getByText("Show Up & Enjoy")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});
