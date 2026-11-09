import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PreEventReadinessCard from "./PreEventReadinessCard";
import type { BookingReadiness } from "@/hooks/useAdminData";

const readiness = (over: Partial<BookingReadiness>): BookingReadiness => ({
  ready: false,
  checklist_complete: true,
  staff_exempt: false,
  staff_total: 0,
  staff_accepted: 0,
  lifecycle_status: "confirmed",
  unmet: [],
  ...over,
});

describe("PreEventReadinessCard (ClickUp 86e3zjfq6)", () => {
  it("shows unmet requirements instead of an unconditional Ready for Event", () => {
    render(
      <PreEventReadinessCard
        lifecycleStatus="confirmed"
        readiness={readiness({ unmet: [{ code: "no_staff", message: "No staff assigned" }] })}
        onMarkChecklistComplete={() => {}}
      />,
    );
    expect(screen.getByTestId("pre-event-badge")).toHaveTextContent("Not Pre-Event Ready");
    expect(screen.queryByText(/Ready for Event/)).toBeNull();
    expect(screen.getByTestId("unmet-list")).toHaveTextContent("No staff assigned");
    expect(screen.getByTestId("checklist-status")).toHaveTextContent("complete");
  });

  it("lists pending staff by name and says it refreshes on its own", () => {
    render(
      <PreEventReadinessCard
        lifecycleStatus="confirmed"
        readiness={readiness({
          staff_total: 1,
          unmet: [{ code: "staff_pending", message: "Waiting for staff to accept: Marielysa Castellano (Custodial)" }],
        })}
        onMarkChecklistComplete={() => {}}
      />,
    );
    expect(screen.getByTestId("unmet-list")).toHaveTextContent("Marielysa Castellano (Custodial)");
    expect(screen.getByText(/Updates automatically/)).toBeInTheDocument();
    expect(screen.getByTestId("staff-status")).toHaveTextContent("Staff accepted: 0/1");
  });

  it("ready booking shows no unmet list", () => {
    render(
      <PreEventReadinessCard
        lifecycleStatus="pre_event_ready"
        readiness={readiness({ ready: true, staff_total: 1, staff_accepted: 1, lifecycle_status: "pre_event_ready" })}
        onMarkChecklistComplete={() => {}}
      />,
    );
    expect(screen.getByTestId("pre-event-badge")).toHaveTextContent("Pre-Event Ready");
    expect(screen.queryByTestId("unmet-list")).toBeNull();
  });

  it("checklist button only marks the checklist", async () => {
    const onMark = vi.fn();
    render(
      <PreEventReadinessCard
        lifecycleStatus="confirmed"
        readiness={readiness({
          checklist_complete: false,
          unmet: [{ code: "checklist_incomplete", message: "Confirmation checklist is not complete" }],
        })}
        onMarkChecklistComplete={onMark}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /Mark checklist complete/ }));
    expect(onMark).toHaveBeenCalledTimes(1);
  });
});
