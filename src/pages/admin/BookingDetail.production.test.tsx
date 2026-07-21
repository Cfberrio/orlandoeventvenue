import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Booking } from "@/hooks/useAdminData";

// --- capture layers -------------------------------------------------------
const toastMock = vi.fn();
const updateMock = vi.fn(() => ({ eq: eqMock }));
const eqMock = vi.fn(async () => ({ error: null }));
const invokeMock = vi.fn(async () => ({ data: {}, error: null }));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({ update: updateMock }),
    functions: { invoke: (...a: unknown[]) => invokeMock(...a) },
  },
}));

// Replace radix Select with a native <select> so tests never touch pointer
// events. The component wiring under test (validate -> toast -> update) is
// unchanged; only the presentational package picker is swapped.
vi.mock("@/components/ui/select", () => {
  const React = require("react");
  const Ctx = React.createContext<(v: string) => void>(() => {});
  return {
    Select: ({ value, onValueChange, children }: any) =>
      React.createElement(Ctx.Provider, { value: onValueChange }, children),
    SelectTrigger: ({ children }: any) => React.createElement("div", null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: any) => React.createElement("div", null, children),
    SelectItem: ({ value, children }: any) => React.createElement("div", null, children),
  };
});

// Stub heavy child dialogs — irrelevant to production validation.
vi.mock("@/components/admin/CreateAddonInvoiceDialog", () => ({ default: () => null }));
vi.mock("@/components/admin/EventHoursEditDialog", () => ({ default: () => null }));
vi.mock("@/components/admin/StaffHoursEditDialog", () => ({ default: () => null }));
vi.mock("@/components/admin/BarServiceCard", () => ({ default: () => null }));

vi.mock("@/hooks/usePricing", () => ({
  usePricing: () => ({
    pricing: {
      processing_fee: 3.5,
      package_basic: 100,
      package_led: 150,
      package_workshop: 200,
    },
  }),
}));

// Mutation hook used by the page.
const mutateAsyncMock = vi.fn(async () => ({}));
vi.mock("@/hooks/useAdminData", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/hooks/useAdminData");
  return {
    ...actual,
    useBooking: () => ({ data: currentBooking, isLoading: false }),
    useBookingStaffAssignments: () => ({ data: [] }),
    useBookingHostReports: () => ({ data: [] }),
    useBookingCleaningReports: () => ({ data: [] }),
    useBookingReviews: () => ({ data: [] }),
    useBookingAttachments: () => ({ data: [] }),
    useBookingAddonInvoices: () => ({ data: [], refetch: vi.fn() }),
    useUpdateBooking: () => ({ mutateAsync: mutateAsyncMock }),
    useStaffMembers: () => ({ data: [] }),
    useBookingEvents: () => ({ data: [] }),
    useBookingMaintenanceTickets: () => ({ data: [] }),
  };
});

import BookingDetail from "./BookingDetail";

// --- fixtures -------------------------------------------------------------
let currentBooking: Booking;

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: "bk_1",
    reservation_number: "OEV-1001",
    event_date: "2026-08-01",
    start_time: "09:00:00",
    end_time: "23:00:00",
    booking_type: "hourly",
    number_of_guests: 40,
    event_type: "party",
    event_type_other: null,
    client_notes: null,
    package: "led",
    // Preset a 2-hour production window (below the old 4-hour minimum).
    package_start_time: "10:00:00",
    package_end_time: "12:00:00",
    setup_breakdown: false,
    tablecloths: false,
    tablecloth_quantity: 0,
    base_rental: 1000,
    cleaning_fee: 150,
    package_cost: 0,
    optional_services: 0,
    taxes_fees: 0,
    total_amount: 1150,
    deposit_amount: 500,
    balance_amount: 650,
    discount_amount: null,
    discount_code: null,
    payment_status: "deposit_paid",
    deposit_paid_at: null,
    balance_paid_at: null,
    full_name: "Jane Doe",
    email: "jane@example.com",
    phone: "555-0100",
    company: null,
    status: "confirmed",
    lifecycle_status: "confirmed",
    lead_source: null,
    pre_event_ready: "false",
    host_report_step: null,
    created_at: "2026-07-01T00:00:00Z",
    booking_origin: "external",
    policy_id: "pol_1",
    beer_wine_service: false,
    bar_package: "none",
    ...overrides,
  } as Booking;
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/bookings/bk_1"]}>
        <Routes>
          <Route path="/admin/bookings/:id" element={<BookingDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

async function openProductionDialog(user: ReturnType<typeof userEvent.setup>) {
  // The "Edit/Configure Production" button presets state from the booking
  // and opens the dialog.
  const trigger = await screen.findByRole("button", { name: /Production/i });
  await user.click(trigger);
  return within(await screen.findByRole("dialog"));
}

describe("BookingDetail — Configure Production (admin)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentBooking = makeBooking();
    // handleSaveProduction calls window.location.reload on success.
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: vi.fn() },
    });
  });

  it("saves a sub-4-hour (2h) production without an Invalid Duration error", async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openProductionDialog(user);
    // Preset window is 10:00–12:00 (2 hours). Save directly.
    await user.click(dialog.getByRole("button", { name: /Save Configuration/i }));

    await waitFor(() => expect(updateMock).toHaveBeenCalled());

    // No 4-hour-minimum rejection.
    const invalidDuration = toastMock.mock.calls.find(
      ([arg]) => arg?.description === "Production package requires a minimum of 4 hours"
    );
    expect(invalidDuration).toBeUndefined();

    // Persisted the exact 2-hour window.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        package: "led",
        package_start_time: "10:00",
        package_end_time: "12:00",
      })
    );

    // Success toast fired.
    const success = toastMock.mock.calls.find(([arg]) =>
      String(arg?.title).includes("Production Configuration Updated")
    );
    expect(success).toBeDefined();
  });

  it("still rejects end time not after start time", async () => {
    currentBooking = makeBooking({
      package_start_time: "12:00:00",
      package_end_time: "11:00:00",
    });
    const user = userEvent.setup();
    renderPage();

    const dialog = await openProductionDialog(user);
    await user.click(dialog.getByRole("button", { name: /Save Configuration/i }));

    await waitFor(() =>
      expect(
        toastMock.mock.calls.some(
          ([arg]) => arg?.description === "End time must be after start time"
        )
      ).toBe(true)
    );
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("still enforces production hours within an hourly booking window", async () => {
    // Booking window 09:00–23:00; production 08:00–08:30 is a valid 30-min
    // duration but falls outside the booking window.
    currentBooking = makeBooking({
      start_time: "09:00:00",
      end_time: "23:00:00",
      package_start_time: "08:00:00",
      package_end_time: "08:30:00",
    });
    const user = userEvent.setup();
    renderPage();

    const dialog = await openProductionDialog(user);
    await user.click(dialog.getByRole("button", { name: /Save Configuration/i }));

    await waitFor(() =>
      expect(
        toastMock.mock.calls.some(([arg]) =>
          String(arg?.description).includes("Production hours must be within booking time")
        )
      ).toBe(true)
    );
    expect(updateMock).not.toHaveBeenCalled();
  });
});
