import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FaqSection from "./FaqSection";

vi.mock("@/hooks/usePricing", () => ({
  usePricing: () => ({
    pricing: { setup_breakdown: 100, tablecloth_rental: 5, tablecloth_cleaning_fee: 25 },
    items: [],
    isLoading: false,
    error: null,
  }),
}));

describe("FaqSection", () => {
  it("renders the five questions", () => {
    render(<FaqSection />);
    expect(screen.getByText("Can we have alcohol at our event?")).toBeInTheDocument();
    expect(screen.getByText("Can I bring my own caterer?")).toBeInTheDocument();
    expect(screen.getByText("Is setup and teardown included?")).toBeInTheDocument();
    expect(screen.getByText("Are tablecloths available?")).toBeInTheDocument();
    expect(screen.getByText("What about parking and load-in?")).toBeInTheDocument();
  });
});
