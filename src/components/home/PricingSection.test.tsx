import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PricingSection from "./PricingSection";

vi.mock("@/hooks/usePricing", () => ({
  usePricing: () => ({
    pricing: { hourly_rate: 140, daily_rate: 899, cleaning_fee: 199 },
    items: [],
    isLoading: false,
    error: null,
  }),
}));

describe("PricingSection", () => {
  it("renders dynamic prices and exact booking links", () => {
    render(<PricingSection />);
    expect(screen.getByText("$140")).toBeInTheDocument();
    expect(screen.getByText("$899")).toBeInTheDocument();
    expect(screen.getByText("$199")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Select Hourly" })).toHaveAttribute(
      "href",
      "/book?type=hourly",
    );
    expect(screen.getByRole("link", { name: "Select Daily" })).toHaveAttribute(
      "href",
      "/book?type=daily",
    );
    expect(screen.getByText("Most Popular")).toBeInTheDocument();
  });
});
