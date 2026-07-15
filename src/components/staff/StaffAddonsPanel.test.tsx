import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import StaffAddonsPanel from "./StaffAddonsPanel";

const base = {
  tablecloths: false, tablecloth_quantity: 0, setup_breakdown: false,
  package: "none", package_start_time: null, package_end_time: null,
  bar_package: "", bar_package_label: null, addons_detail: [],
};

describe("StaffAddonsPanel", () => {
  it("renders nothing when there are no add-ons", () => {
    const { container } = render(<StaffAddonsPanel booking={base} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows tablecloth quantity and no dollar amount", () => {
    render(<StaffAddonsPanel booking={{ ...base, tablecloths: true, tablecloth_quantity: 10 }} />);
    expect(screen.getByText("Manteles")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
  });
});
