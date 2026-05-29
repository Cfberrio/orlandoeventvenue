import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

// Mock supabase client BEFORE importing AccessCode
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    storage: { from: vi.fn() },
    functions: { invoke: vi.fn() },
  },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { supabase } from "@/integrations/supabase/client";
import AccessCode from "./AccessCode";

const rpcMock = supabase.rpc as unknown as ReturnType<typeof vi.fn>;

// Helper to build mock RPC response row
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    code: "1234",
    label: "Lockbox Code",
    booking_id: "bbb-1111-2222-3333",
    reservation_number: "OEV-TEST01",
    full_name: "Maria Rodriguez",
    email: "maria@example.com",
    phone: "5551234",
    event_date: "2026-08-15",
    end_time: "23:00:00",
    event_type: "wedding-reception",
    host_report_step: "pending",
    ...overrides,
  };
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AccessCode />
    </MemoryRouter>,
  );

beforeEach(() => {
  // Fake only Date — leaves setTimeout/microtasks real so userEvent works.
  vi.useFakeTimers({ toFake: ["Date"] });
  rpcMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("AccessCode — landing form", () => {
  it("renders both inputs and submit button on first visit", () => {
    vi.setSystemTime(new Date("2026-08-15T18:00:00"));
    renderAt("/accesscode");
    expect(screen.getByLabelText(/Reservation Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get Access Code/i })).toBeInTheDocument();
  });

  it("shows error when both inputs are empty", async () => {
    const user = userEvent.setup();
    vi.setSystemTime(new Date("2026-08-15T18:00:00"));
    renderAt("/accesscode");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));
    expect(
      await screen.findByText(/Please enter your reservation number or email address/i),
    ).toBeInTheDocument();
  });
});

describe("AccessCode — gate code view (BEFORE event end_time)", () => {
  it("shows the gate access code when now < event end", async () => {
    // event ends 2026-08-15 23:00. Test runs at 18:00 — BEFORE end.
    vi.setSystemTime(new Date("2026-08-15T18:00:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");

    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText("1234")).toBeInTheDocument();
    expect(screen.getByText("Lockbox Code")).toBeInTheDocument();
    expect(screen.getByText(/Maria Rodriguez/)).toBeInTheDocument();
    expect(screen.queryByText(/Post-Event Report/i)).not.toBeInTheDocument();
  });

  it("shows gate code when event is 3 days in the future", async () => {
    vi.setSystemTime(new Date("2026-08-12T10:00:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText("1234")).toBeInTheDocument();
    expect(screen.queryByText(/Post-Event Report/i)).not.toBeInTheDocument();
  });

  it("shows gate code 1 minute BEFORE end_time", async () => {
    vi.setSystemTime(new Date("2026-08-15T22:59:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText("1234")).toBeInTheDocument();
    expect(screen.queryByText(/Post-Event Report/i)).not.toBeInTheDocument();
  });

  it("defaults to 23:59 when end_time is null", async () => {
    // null end_time -> event ends at 2026-08-15 23:59. Test at 22:00 -> before end.
    vi.setSystemTime(new Date("2026-08-15T22:00:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow({ end_time: null }), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText("1234")).toBeInTheDocument();
    expect(screen.queryByText(/Post-Event Report/i)).not.toBeInTheDocument();
  });
});

describe("AccessCode — guest report view (AFTER event end_time)", () => {
  it("shows guest report form 1 minute AFTER end_time", async () => {
    // event ends 23:00. Test at 23:01 -> after end.
    vi.setSystemTime(new Date("2026-08-15T23:01:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText(/Post-Event Report/i)).toBeInTheDocument();
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
    expect(screen.getByText(/Front Door Closed/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Main Event Area/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Kitchen.*Trash/i)).toBeInTheDocument();
  });

  it("shows guest report 5 minutes after end_time (matches user's spec)", async () => {
    vi.setSystemTime(new Date("2026-08-15T23:05:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText(/Post-Event Report/i)).toBeInTheDocument();
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
  });

  it("shows guest report 1 day after event", async () => {
    vi.setSystemTime(new Date("2026-08-16T10:00:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText(/Post-Event Report/i)).toBeInTheDocument();
  });
});

describe("AccessCode — already-submitted state", () => {
  it("shows 'Report Already Submitted' when host_report_step === 'completed'", async () => {
    vi.setSystemTime(new Date("2026-08-16T10:00:00"));
    rpcMock.mockResolvedValueOnce({
      data: makeRow({ host_report_step: "completed" }),
      error: null,
    });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-TEST01");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(await screen.findByText(/Report Already Submitted/i)).toBeInTheDocument();
    // No form sections render
    expect(screen.queryByText(/Front Door Closed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Confirmations \/ Confirmaciones/i)).not.toBeInTheDocument();
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
    // reservation # shown
    expect(screen.getByText(/OEV-TEST01/)).toBeInTheDocument();
  });
});

describe("AccessCode — query param auto-lookup", () => {
  it("auto-runs lookup when ?res= query param present", async () => {
    vi.setSystemTime(new Date("2026-08-15T18:00:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    renderAt("/accesscode?res=OEV-TEST01");

    expect(await screen.findByText("1234")).toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith(
      "get_access_code_for_reservation",
      { p_reservation_number: "OEV-TEST01", p_email: null },
    );
  });

  it("auto-runs lookup when ?email= query param present", async () => {
    vi.setSystemTime(new Date("2026-08-15T18:00:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    renderAt("/accesscode?email=maria@example.com");

    expect(await screen.findByText("1234")).toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith(
      "get_access_code_for_reservation",
      { p_reservation_number: null, p_email: "maria@example.com" },
    );
  });

  it("auto-routes to report form when query param + event already ended", async () => {
    vi.setSystemTime(new Date("2026-08-16T10:00:00"));
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    renderAt("/accesscode?res=OEV-TEST01");

    expect(await screen.findByText(/Post-Event Report/i)).toBeInTheDocument();
  });
});

describe("AccessCode — error states from RPC", () => {
  it("handles reservation_not_found", async () => {
    vi.setSystemTime(new Date("2026-08-15T18:00:00"));
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "reservation_not_found" },
    });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-NOPE");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(
      await screen.findByText(/couldn't find a reservation/i),
    ).toBeInTheDocument();
  });

  it("handles reservation_inactive", async () => {
    vi.setSystemTime(new Date("2026-08-15T18:00:00"));
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "reservation_inactive" },
    });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.type(screen.getByLabelText(/Reservation Number/i), "OEV-CXLD");
    await user.click(screen.getByRole("button", { name: /Get Access Code/i }));

    expect(
      await screen.findByText(/no longer active/i),
    ).toBeInTheDocument();
  });
});
