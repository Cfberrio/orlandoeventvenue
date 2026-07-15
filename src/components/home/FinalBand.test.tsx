import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FinalBand from "./FinalBand";
import OevFooter from "./OevFooter";

describe("FinalBand", () => {
  it("renders CTA to /book", () => {
    render(<FinalBand />);
    expect(screen.getByText("Ready to host an effortless event?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});

describe("OevFooter", () => {
  it("renders address, phone and legal links", () => {
    render(
      <MemoryRouter>
        <OevFooter />
      </MemoryRouter>,
    );
    expect(screen.getByText(/3847 E Colonial Dr/)).toBeInTheDocument();
    expect(screen.getByText("407-974-5979")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy-policy",
    );
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
      "href",
      "/terms-of-use",
    );
  });
});
