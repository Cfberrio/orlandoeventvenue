import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AddonsSection from "./AddonsSection";

vi.mock("@/hooks/usePricing", () => ({
  usePricing: () => ({
    pricing: {
      package_basic: 79,
      package_led: 99,
      package_workshop: 149,
      setup_breakdown: 100,
      tablecloth_rental: 5,
      tablecloth_cleaning_fee: 25,
    },
    items: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useBarPackages", () => ({
  useBarPackages: () => ({
    packages: [
      { key: "house_beer_wine", label: "House Beer & Wine", ratePerGuest: 18, sortOrder: 1 },
      {
        key: "signature_bar",
        label: "Signature Bar",
        ratePerGuest: 32.13,
        sortOrder: 3,
        badge: "Most Popular",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

describe("AddonsSection", () => {
  it("renders production packages with hourly prices", () => {
    render(<AddonsSection />);
    expect(screen.getByText("Basic A/V Package")).toBeInTheDocument();
    expect(screen.getByText("$79/hr")).toBeInTheDocument();
    expect(screen.getByText("$149/hr")).toBeInTheDocument();
  });

  it("renders bar packages per guest and extras", () => {
    render(<AddonsSection />);
    expect(screen.getByText("House Beer & Wine")).toBeInTheDocument();
    expect(screen.getByText("$18/guest")).toBeInTheDocument();
    expect(screen.getByText("$32.13/guest")).toBeInTheDocument();
    expect(screen.getByText("Setup & breakdown")).toBeInTheDocument();
    expect(screen.getByText("$5/ea + $25 cleaning")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add to My Booking" })).toHaveAttribute(
      "href",
      "/book",
    );
  });
});
