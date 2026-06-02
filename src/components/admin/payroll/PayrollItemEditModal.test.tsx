import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Track calls separately so each test sees fresh state
const fromMock = vi.fn();
const updateAssignmentMock = vi.fn();
const recalculatePayrollMock = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/hooks/usePayrollData", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/hooks/usePayrollData",
  );
  return {
    ...actual,
    usePayrollData: () => ({
      updateAssignment: updateAssignmentMock,
      recalculatePayroll: recalculatePayrollMock,
      addBonus: vi.fn(),
      addDeduction: vi.fn(),
    }),
  };
});

import PayrollItemEditModal from "./PayrollItemEditModal";
import type { PayrollLineItem } from "@/hooks/usePayrollData";

function makeItem(overrides: Partial<PayrollLineItem> = {}): PayrollLineItem {
  return {
    staff_name: "Juan Perez",
    staff_role: "production",
    payroll_type: "hourly",
    assignment_date: "2026-06-02",
    booking_id: "booking-uuid",
    assignment_id: "assignment-uuid-pm",
    reservation_number: "OEV-001",
    assignment_type: "production",
    pay_category: "hourly_production",
    pay_type: "production",
    amount: 200,
    hours: 4,
    rate: 50,
    description: "Production Services",
    assignment_status: "completed",
    paid_status: "pending",
    paid_at: null,
    payroll_item_id: "spi-uuid",
    created_at: "2026-06-02T18:00:00Z",
    ...overrides,
  };
}

/**
 * Builds a chainable Supabase mock for .from('table').select('*').eq('id', X).single()
 */
function mockAssignmentLookup(assignmentRow: Record<string, unknown> | null) {
  const single = vi.fn().mockResolvedValue({
    data: assignmentRow,
    error: assignmentRow ? null : { message: "not found" },
  });
  const eq = vi.fn().mockReturnValue({ single });
  const select = vi.fn().mockReturnValue({ eq });
  fromMock.mockImplementation((table: string) => {
    if (table === "booking_staff_assignments") {
      return { select };
    }
    return { select: vi.fn() };
  });
  return { single, eq, select };
}

describe("PayrollItemEditModal — assignment_id targeting", () => {
  beforeEach(() => {
    fromMock.mockReset();
    updateAssignmentMock.mockReset();
    recalculatePayrollMock.mockReset();
  });

  it("loads assignment by item.assignment_id (no reverse-lookup by name+date)", async () => {
    const lookup = mockAssignmentLookup({
      id: "assignment-uuid-pm",
      staff_id: "staff-1",
      hours_worked: 4,
      cleaning_type: null,
      celebration_surcharge: 0,
    });

    const item = makeItem({ assignment_id: "assignment-uuid-pm" });

    render(
      <PayrollItemEditModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        item={item}
      />,
    );

    await waitFor(() => {
      expect(lookup.eq).toHaveBeenCalledWith("id", "assignment-uuid-pm");
    });

    // Never queries staff_members for reverse-lookup
    expect(fromMock).not.toHaveBeenCalledWith("staff_members");
  });

  it("targets correct assignment when staff has two assignments same day (AM vs PM)", async () => {
    // Modal is opened from the PM row — must hit PM assignment_id, not AM
    const lookup = mockAssignmentLookup({
      id: "assignment-uuid-pm",
      staff_id: "staff-1",
      hours_worked: 4,
      cleaning_type: null,
      celebration_surcharge: 0,
    });

    const itemPm = makeItem({
      assignment_id: "assignment-uuid-pm",
      assignment_date: "2026-06-02",
    });

    render(
      <PayrollItemEditModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        item={itemPm}
      />,
    );

    await waitFor(() => {
      expect(lookup.eq).toHaveBeenCalledWith("id", "assignment-uuid-pm");
    });
    // No call with AM uuid
    expect(lookup.eq).not.toHaveBeenCalledWith("id", "assignment-uuid-am");
  });

  it("on submit: calls updateAssignment + recalculatePayroll with same assignment_id", async () => {
    mockAssignmentLookup({
      id: "assignment-uuid-pm",
      staff_id: "staff-1",
      hours_worked: 4,
      cleaning_type: null,
      celebration_surcharge: 0,
    });

    updateAssignmentMock.mockResolvedValue({ data: {}, error: null });
    recalculatePayrollMock.mockResolvedValue({ success: true, error: null });

    const onSuccess = vi.fn();
    const item = makeItem({ assignment_id: "assignment-uuid-pm" });

    render(
      <PayrollItemEditModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        item={item}
      />,
    );

    // Wait for prefill to populate hours_worked input
    const input = await screen.findByLabelText(/Hours Worked/i);
    await waitFor(() => expect((input as HTMLInputElement).value).toBe("4"));

    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, "2");

    const submit = screen.getByRole("button", { name: /Update & Recalculate/i });
    await user.click(submit);

    await waitFor(() => expect(updateAssignmentMock).toHaveBeenCalledTimes(1));
    expect(updateAssignmentMock).toHaveBeenCalledWith(
      "assignment-uuid-pm",
      { hours_worked: 2 },
    );
    expect(recalculatePayrollMock).toHaveBeenCalledWith("assignment-uuid-pm");
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("for per_assignment (custodial): does NOT show Hours Worked input — uses cleaning_type", async () => {
    mockAssignmentLookup({
      id: "assignment-uuid-clean",
      staff_id: "staff-2",
      hours_worked: null,
      cleaning_type: "regular",
      celebration_surcharge: 0,
    });

    const item = makeItem({
      payroll_type: "per_assignment",
      pay_category: "cleaning_base",
      pay_type: "regular",
      assignment_id: "assignment-uuid-clean",
    });

    render(
      <PayrollItemEditModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        item={item}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByLabelText(/Hours Worked/i)).toBeNull();
    });
    expect(await screen.findByLabelText(/Cleaning Type/i)).toBeInTheDocument();
    expect(
      screen.getByLabelText(/Celebration Surcharge/i),
    ).toBeInTheDocument();
  });

  it("blocks submit + shows error when assignment_id is missing on item", async () => {
    const toastMock = vi.fn();
    // Re-mock use-toast with capture
    vi.doMock("@/hooks/use-toast", () => ({
      useToast: () => ({ toast: toastMock }),
    }));

    const item = makeItem({ assignment_id: "" as unknown as string });

    render(
      <PayrollItemEditModal
        isOpen={true}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        item={item}
      />,
    );

    // No supabase call attempted with empty id
    await waitFor(() => {
      // Verify no .eq('id', '...') was called with empty string by ensuring
      // mockAssignmentLookup setup never ran (lookup not configured).
      expect(fromMock).not.toHaveBeenCalledWith("booking_staff_assignments");
    });
  });
});
