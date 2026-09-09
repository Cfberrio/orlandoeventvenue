import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock("@/hooks/useAdminData", () => ({ useUpdateBookingTimes: () => ({ mutateAsync, isPending: false }) }));
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import EventHoursEditDialog from "./EventHoursEditDialog";

describe("EventHoursEditDialog", () => {
  beforeEach(() => {
    toastMock.mockClear();
    mutateAsync.mockClear();
  });

  it("saves the edited event hours", async () => {
    render(<EventHoursEditDialog bookingId="b1" startTime="17:00:00" endTime="22:00:00" open onOpenChange={() => {}} />);
    const end = screen.getByLabelText(/end/i);
    await userEvent.clear(end);
    await userEvent.type(end, "23:00");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ bookingId: "b1", startTime: "17:00", endTime: "23:00" }),
    );
  });

  it("blocks saving when end is not after start", async () => {
    render(<EventHoursEditDialog bookingId="b1" startTime="17:00:00" endTime="22:00:00" open onOpenChange={() => {}} />);
    const end = screen.getByLabelText(/end/i);
    await userEvent.clear(end);
    await userEvent.type(end, "16:00");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("reseeds inputs from props when reopened (no stale draft)", () => {
    const { rerender } = render(<EventHoursEditDialog bookingId="b1" startTime="17:00:00" endTime="22:00:00" open={false} onOpenChange={() => {}} />);
    rerender(<EventHoursEditDialog bookingId="b1" startTime="18:00:00" endTime="23:00:00" open onOpenChange={() => {}} />);
    expect((screen.getByLabelText(/start/i) as HTMLInputElement).value).toBe("18:00");
    expect((screen.getByLabelText(/end/i) as HTMLInputElement).value).toBe("23:00");
  });

  it("shows a destructive toast when the update fails", async () => {
    mutateAsync.mockRejectedValueOnce(new Error("boom"));
    render(<EventHoursEditDialog bookingId="b1" startTime="17:00:00" endTime="22:00:00" open onOpenChange={() => {}} />);
    const end = screen.getByLabelText(/end/i);
    await userEvent.clear(end);
    await userEvent.type(end, "23:00");
    await userEvent.click(screen.getByRole("button", { name: /save/i }));
    await waitFor(() => expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" })));
  });
});
