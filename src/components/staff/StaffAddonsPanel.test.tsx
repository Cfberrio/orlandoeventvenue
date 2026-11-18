import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import StaffAddonsPanel from "./StaffAddonsPanel";

const paidAddons = vi.hoisted(() => ({ data: [] as unknown[] | undefined }));
vi.mock("@/hooks/useStaffData", () => ({
  useStaffPaidAddons: () => ({ data: paidAddons.data }),
}));

const base = {
  tablecloths: false, tablecloth_quantity: 0, setup_breakdown: false,
  package: "none", package_start_time: null, package_end_time: null,
  bar_package: "", bar_package_label: null, addons_detail: [],
};

describe("StaffAddonsPanel", () => {
  beforeEach(() => {
    paidAddons.data = [];
  });

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

  it("shows a package added after booking (paid add-on invoice) apart from the original add-ons", () => {
    paidAddons.data = [{
      id: "inv-1", paid_at: "2026-05-12T01:25:53Z", package: "led",
      package_start_time: "17:00", package_end_time: "21:00",
      setup_breakdown: false, tablecloths: false, tablecloth_quantity: 0,
      bar_package: "none", bar_package_label: null,
    }];
    render(<StaffAddonsPanel booking={base} bookingId="b-1" />);
    expect(screen.getByText("Added after booking (paid)")).toBeInTheDocument();
    expect(screen.getByText("led (17:00 - 21:00)")).toBeInTheDocument();
  });

  it("still shows the original add-ons when the paid add-ons cannot be loaded", () => {
    paidAddons.data = undefined; // RPC error: react-query leaves data undefined
    render(<StaffAddonsPanel booking={{ ...base, setup_breakdown: true }} bookingId="b-1" />);
    expect(screen.getByText("Montaje y desmontaje")).toBeInTheDocument();
    expect(screen.queryByText("Added after booking (paid)")).not.toBeInTheDocument();
  });

  it("shows original and later add-ons together", () => {
    paidAddons.data = [{
      id: "inv-2", paid_at: null, package: "none", package_start_time: null, package_end_time: null,
      setup_breakdown: false, tablecloths: true, tablecloth_quantity: 4,
      bar_package: "none", bar_package_label: null,
    }];
    render(<StaffAddonsPanel booking={{ ...base, setup_breakdown: true }} bookingId="b-1" />);
    expect(screen.getByText("Montaje y desmontaje")).toBeInTheDocument();
    expect(screen.getByText("Added after booking (paid)")).toBeInTheDocument();
    expect(screen.getByText("Manteles")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});
