import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WhyCards from "./WhyCards";

describe("WhyCards", () => {
  it("renders three reason cards linking to sections", () => {
    render(<WhyCards />);
    expect(screen.getByText("Flexible")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Simple")).toBeInTheDocument();
    expect(screen.getByText("Flexible").closest("a")).toHaveAttribute("href", "#pricing");
  });
});
