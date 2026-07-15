import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GalleryTours from "./GalleryTours";

describe("GalleryTours", () => {
  it("renders gallery heading, 3D tour and schedule tour links", () => {
    render(
      <MemoryRouter>
        <GalleryTours />
      </MemoryRouter>,
    );
    expect(screen.getByText("Take a look around.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /3D Virtual Tour/i })).toHaveAttribute(
      "href",
      "/tour",
    );
    expect(screen.getByRole("link", { name: /Schedule a Tour/i })).toHaveAttribute(
      "href",
      "/schedule-tour",
    );
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(11);
  });
});
