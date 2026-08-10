import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// --- capture layers -------------------------------------------------------
let currentBooking: Record<string, unknown> | null = null;
const maybeSingleMock = vi.fn(async () => ({ data: currentBooking, error: null }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: maybeSingleMock }),
      }),
    }),
  },
}));

vi.mock("@/components/Navigation", () => ({ default: () => null }));

const trackPurchaseMock = vi.fn();
vi.mock("@/lib/analytics", () => ({
  trackPurchase: (...a: unknown[]) => trackPurchaseMock(...a),
}));

import BookingConfirmation from "./BookingConfirmation";

// --- fixtures -------------------------------------------------------------
const baseBooking = {
  id: "5d551880-1be7-4e97-884e-7cf11617b0d6",
  reservation_number: "OEV-93UDYH",
  event_date: "2026-08-22",
  start_time: "01:00:00",
  end_time: "23:00:00",
  booking_type: "daily",
  number_of_guests: 50,
  event_type: "workshop-class",
  deposit_amount: 549,
  balance_amount: 549,
  total_amount: 1098,
  full_name: "Ryan Salinas",
  email: "ryan@urbnevents.com",
  payment_status: "fully_paid",
  balance_total_charged: 569.59,
};

const renderAt = (search: string) =>
  render(
    <MemoryRouter initialEntries={[`/booking-confirmation${search}`]}>
      <BookingConfirmation />
    </MemoryRouter>
  );

// The page waits 2s before fetching so the Stripe webhook can land first.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  currentBooking = { ...baseBooking };
});

const settle = async () => {
  await vi.advanceTimersByTimeAsync(2100);
};

describe("balance payment success (type=balance)", () => {
  it("shows the fully-paid state, not the deposit copy", async () => {
    renderAt("?session_id=cs_live_x&booking_id=b1&type=balance");
    await settle();

    expect(await screen.findByRole("heading", { name: /balance paid/i })).toBeInTheDocument();
    // Deposit-flow copy must not leak into the balance state
    expect(screen.queryByText(/pending confirmation/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/booking submitted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/will be charged/i)).not.toBeInTheDocument();
  });

  it("shows $0 remaining and the exact charged amount", async () => {
    renderAt("?session_id=cs_live_x&booking_id=b1&type=balance");
    await settle();

    expect(await screen.findByText(/\$569\.59/)).toBeInTheDocument();
    expect(screen.getByText(/\$0\.00/)).toBeInTheDocument();
  });

  it("does not fire the GA4 purchase event", async () => {
    renderAt("?session_id=cs_live_x&booking_id=b1&type=balance");
    await settle();
    await screen.findByRole("heading", { name: /balance paid/i });

    expect(trackPurchaseMock).not.toHaveBeenCalled();
  });
});

describe("balance payment cancelled", () => {
  it("does not offer 'Try Again' into a new booking", async () => {
    renderAt("?cancelled=true&booking_id=b1&type=balance");
    await settle();

    expect(await screen.findByText(/payment cancelled/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(screen.getByText(/no charges were made/i)).toBeInTheDocument();
  });
});

describe("addon payment success (type=addon)", () => {
  it("shows a payment-received state without deposit math", async () => {
    renderAt("?session_id=cs_live_x&booking_id=b1&type=addon");
    await settle();

    expect(await screen.findByText(/payment received/i)).toBeInTheDocument();
    expect(screen.queryByText(/deposit paid \(50%\)/i)).not.toBeInTheDocument();
    expect(trackPurchaseMock).not.toHaveBeenCalled();
  });
});

describe("deposit flow (no type param) is unchanged", () => {
  it("keeps the original submitted copy and fires GA4 purchase", async () => {
    currentBooking = { ...baseBooking, payment_status: "deposit_paid" };
    renderAt("?session_id=cs_live_x&booking_id=b1");
    await settle();

    expect(await screen.findByText(/payment successful/i)).toBeInTheDocument();
    expect(screen.getByText(/pending confirmation/i)).toBeInTheDocument();
    expect(trackPurchaseMock).toHaveBeenCalledTimes(1);
  });
});
