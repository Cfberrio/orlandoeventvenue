import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PromoBand from "./PromoBand";

describe("PromoBand", () => {
  it("renders the included checklist, seal and reviews link", () => {
    render(<PromoBand />);
    expect(screen.getByText("Everything included. One flat price.")).toBeInTheDocument();
    expect(screen.getByText("90 chairs + 10 tables")).toBeInTheDocument();
    expect(screen.getByText("No catering restrictions")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /5-star/i })).toHaveAttribute(
      "href",
      "https://g.page/r/CU-yUA0El90UEAE/review",
    );
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});
