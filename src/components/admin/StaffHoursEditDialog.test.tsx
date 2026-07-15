import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useAdminData", () => ({ useUpdateStaffAssignment: () => ({ mutateAsync, isPending: false }) }));
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import StaffHoursEditDialog from "./StaffHoursEditDialog";

const assignment = {
  id: "a1",
  assignment_role: "Assistant",
  scheduled_start_time: null,
  scheduled_end_time: null,
  booking: { package: "none", package_start_time: null, package_end_time: null, start_time: "17:00:00", end_time: "22:00:00" },
} as any;

describe("StaffHoursEditDialog", () => {
  beforeEach(() => {
    toastMock.mockClear();
    mutateAsync.mockClear();
    mutateAsync.mockResolvedValue(undefined);
  });

  it("saves a per-person override", async () => {
    render(<StaffHoursEditDialog assignment={assignment} bookingId="b1" open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText(/inicio/i), "14:00");
    await userEvent.type(screen.getByLabelText(/fin/i), "20:00");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ id: "a1", bookingId: "b1", scheduledStartTime: "14:00", scheduledEndTime: "20:00" }),
    );
  });

  it("resets to event hours (nulls both fields)", async () => {
    render(
      <StaffHoursEditDialog
        assignment={{ ...assignment, scheduled_start_time: "14:00:00", scheduled_end_time: "20:00:00" }}
        bookingId="b1"
        open
        onOpenChange={() => {}}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: /restablecer|reset/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ id: "a1", bookingId: "b1", scheduledStartTime: null, scheduledEndTime: null }),
    );
  });

  it("reseeds inputs from the assignment when reopened (no stale draft)", () => {
    const { rerender } = render(
      <StaffHoursEditDialog
        assignment={{ ...assignment, scheduled_start_time: "14:00:00", scheduled_end_time: "20:00:00" }}
        bookingId="b1"
        open={false}
        onOpenChange={() => {}}
      />,
    );
    rerender(
      <StaffHoursEditDialog
        assignment={{ ...assignment, scheduled_start_time: "15:00:00", scheduled_end_time: "21:00:00" }}
        bookingId="b1"
        open
        onOpenChange={() => {}}
      />,
    );
    expect((screen.getByLabelText(/inicio/i) as HTMLInputElement).value).toBe("15:00");
    expect((screen.getByLabelText(/fin/i) as HTMLInputElement).value).toBe("21:00");
  });

  it("shows a destructive toast when saving fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("boom"));
    render(<StaffHoursEditDialog assignment={assignment} bookingId="b1" open onOpenChange={() => {}} />);
    await userEvent.type(screen.getByLabelText(/inicio/i), "14:00");
    await userEvent.type(screen.getByLabelText(/fin/i), "20:00");
    await userEvent.click(screen.getByRole("button", { name: /guardar/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
  });
});
