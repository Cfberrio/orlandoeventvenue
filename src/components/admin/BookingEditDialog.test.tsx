import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mutateAsync = vi.fn().mockResolvedValue({ auditLogged: true });
vi.mock("@/hooks/useAdminData", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/hooks/useAdminData");
  return { ...actual, useUpdateBookingDetails: () => ({ mutateAsync, isPending: false }) };
});
const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));

import BookingEditDialog, {
  diffBookingEdit,
  validateBookingEdit,
  type EditableBooking,
} from "./BookingEditDialog";

const booking: EditableBooking = {
  id: "b1",
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone: "407-555-0101",
  company: null,
  event_type: "birthday-party",
  event_type_other: null,
  number_of_guests: 40,
  client_notes: "Cake table by the window",
  event_date: "2026-09-12",
  start_time: "17:00:00",
  end_time: "22:00:00",
};

const baseForm = {
  full_name: "Jane Doe",
  email: "jane@example.com",
  phone: "407-555-0101",
  company: "",
  event_type: "birthday-party",
  event_type_other: "",
  number_of_guests: "40",
  client_notes: "Cake table by the window",
};

describe("validateBookingEdit", () => {
  it("accepts an unchanged, valid form", () => {
    expect(validateBookingEdit(baseForm)).toBeNull();
  });

  it("rejects an invalid email", () => {
    expect(validateBookingEdit({ ...baseForm, email: "jane@" })).toMatch(/valid email/i);
  });

  it("rejects a guest count over venue capacity", () => {
    expect(validateBookingEdit({ ...baseForm, number_of_guests: "91" })).toMatch(/90 guests/);
  });

  it("rejects a guest count below one", () => {
    expect(validateBookingEdit({ ...baseForm, number_of_guests: "0" })).toMatch(/at least 1/i);
  });

  it("requires the free-text value when event type is other", () => {
    expect(validateBookingEdit({ ...baseForm, event_type: "other" })).toMatch(/specify/i);
  });
});

describe("diffBookingEdit", () => {
  it("returns no changes when nothing was edited", () => {
    expect(diffBookingEdit(booking, baseForm).changes).toHaveLength(0);
  });

  it("records only the edited fields", () => {
    const { updates, changes } = diffBookingEdit(booking, {
      ...baseForm,
      full_name: "Jane Smith",
      number_of_guests: "55",
    });
    expect(updates).toEqual({ full_name: "Jane Smith", number_of_guests: 55 });
    expect(changes).toEqual([
      { field: "full_name", label: "Client name", from: "Jane Doe", to: "Jane Smith" },
      { field: "number_of_guests", label: "Guests", from: 40, to: 55 },
    ]);
  });

  it("writes null rather than an empty string when a nullable field is cleared", () => {
    const { updates } = diffBookingEdit(booking, { ...baseForm, client_notes: "" });
    expect(updates).toEqual({ client_notes: null });
  });

  it("clears a stale event_type_other when the type is no longer 'other'", () => {
    const otherBooking = { ...booking, event_type: "other", event_type_other: "Fundraiser" };
    const { updates } = diffBookingEdit(otherBooking, {
      ...baseForm,
      event_type: "baby-shower",
      event_type_other: "Fundraiser",
    });
    expect(updates).toEqual({ event_type: "baby-shower", event_type_other: null });
  });

  it("never touches date, time or payment fields", () => {
    const { updates } = diffBookingEdit(booking, { ...baseForm, full_name: "Jane Smith" });
    expect(Object.keys(updates)).toEqual(["full_name"]);
  });
});

describe("BookingEditDialog", () => {
  beforeEach(() => {
    mutateAsync.mockClear();
    mutateAsync.mockResolvedValue({ auditLogged: true });
    toastMock.mockClear();
  });

  it("saves only the edited field", async () => {
    render(<BookingEditDialog booking={booking} open onOpenChange={() => {}} />);
    const name = screen.getByLabelText(/client name/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Jane Smith");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        bookingId: "b1",
        updates: { full_name: "Jane Smith" },
        changes: [
          { field: "full_name", label: "Client name", from: "Jane Doe", to: "Jane Smith" },
        ],
      }),
    );
  });

  it("does not write when nothing changed", async () => {
    render(<BookingEditDialog booking={booking} open onOpenChange={() => {}} />);
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "No changes to save" }));
  });

  it("blocks an invalid guest count instead of writing it", async () => {
    render(<BookingEditDialog booking={booking} open onOpenChange={() => {}} />);
    const guests = screen.getByLabelText("Guests");
    await userEvent.clear(guests);
    await userEvent.type(guests, "150");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: "destructive" }));
  });

  it("warns when the edit saved but the audit log did not", async () => {
    mutateAsync.mockResolvedValueOnce({ auditLogged: false });
    render(<BookingEditDialog booking={booking} open onOpenChange={() => {}} />);
    const name = screen.getByLabelText(/client name/i);
    await userEvent.clear(name);
    await userEvent.type(name, "Jane Smith");
    await userEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() =>
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({ description: expect.stringMatching(/edit history/i) }),
      ),
    );
  });

  it("hands date and time changes to the reschedule flow", async () => {
    const onReschedule = vi.fn();
    render(
      <BookingEditDialog booking={booking} open onOpenChange={() => {}} onReschedule={onReschedule} />,
    );
    expect(screen.queryByLabelText(/date/i)).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /reschedule instead/i }));
    expect(onReschedule).toHaveBeenCalled();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("reseeds from props when reopened (no stale draft)", () => {
    const { rerender } = render(
      <BookingEditDialog booking={booking} open={false} onOpenChange={() => {}} />,
    );
    rerender(
      <BookingEditDialog
        booking={{ ...booking, full_name: "Ana Ruiz" }}
        open
        onOpenChange={() => {}}
      />,
    );
    expect((screen.getByLabelText(/client name/i) as HTMLInputElement).value).toBe("Ana Ruiz");
  });
});
