import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

// Helper to build mock RPC response row.
// The server decides the page state: code present => access released (STATE 2),
// code null => not yet available (STATE 1).
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    code: "1234",
    label: "Door Code",
    access_released: true,
    booking_id: "bbb-1111-2222-3333",
    reservation_number: "OEV-TEST01",
    full_name: "Maria Rodriguez",
    email: "maria@example.com",
    phone: "5551234",
    event_date: "2026-08-15",
    start_time: "14:00:00",
    end_time: "23:00:00",
    event_type: "wedding-reception",
    host_report_step: "pending",
    ...overrides,
  };
}

function makeLockedRow(overrides: Record<string, unknown> = {}) {
  return makeRow({ code: null, label: null, access_released: false, ...overrides });
}

// Recurring access codes (OEV-R… numbers) are always released and carry no
// booking/report fields.
function makeRecurringRow(overrides: Record<string, unknown> = {}) {
  return makeRow({
    booking_id: "rec-1111-2222-3333",
    reservation_number: "OEV-RFCG01",
    full_name: "FCG",
    email: null,
    phone: null,
    event_date: "2026-08-03",
    start_time: null,
    end_time: null,
    event_type: null,
    host_report_step: null,
    is_recurring: true,
    expires_on: "2027-02-03",
    ...overrides,
  });
}

const renderAt = (url: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <AccessCode />
    </MemoryRouter>,
  );

beforeEach(() => {
  rpcMock.mockReset();
});

async function lookup(reservation = "OEV-TEST01") {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/Reservation Number/i), reservation);
  await user.click(screen.getByRole("button", { name: /ENTER/i }));
}

describe("AccessCode — landing form", () => {
  it("renders both inputs and submit button on first visit", () => {
    renderAt("/accesscode");
    expect(screen.getByLabelText(/Reservation Number/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email Address/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /ENTER/i })).toBeInTheDocument();
  });

  it("shows error when both inputs are empty", async () => {
    const user = userEvent.setup();
    renderAt("/accesscode");
    await user.click(screen.getByRole("button", { name: /ENTER/i }));
    expect(
      await screen.findByText(/Please enter your reservation number or email address/i),
    ).toBeInTheDocument();
  });
});

describe("AccessCode — STATE 1 (before access is available)", () => {
  it("shows the not-available message with reservation details when code is null", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeLockedRow(), error: null });

    renderAt("/accesscode");
    await lookup();

    expect(await screen.findByText(/Your Access Is Not Available Yet/i)).toBeInTheDocument();
    expect(
      screen.getByText(/released one hour before your event begins/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Important Reminder/i)).toBeInTheDocument();
    // Reservation details stay visible at the bottom
    expect(screen.getByText(/Reservation Details/i)).toBeInTheDocument();
    expect(screen.getByText("OEV-TEST01")).toBeInTheDocument();
    expect(screen.getByText(/Maria Rodriguez/)).toBeInTheDocument();
    // No code, no report form
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
    expect(screen.queryByText(/Venue Checklist/i)).not.toBeInTheDocument();
  });

  it("shows the one-hour message when a legacy server gate still raises the locked error", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "access_code_locked_until_event_day" },
    });

    renderAt("/accesscode");
    await lookup();

    expect(
      await screen.findByText(/released one hour before your event begins/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
  });
});

describe("AccessCode — STATE 2 (access released)", () => {
  it("shows the door code, entry steps, guest report, rules, and reservation details", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    renderAt("/accesscode");
    await lookup();

    expect(await screen.findByText(/Your Access Is Ready/i)).toBeInTheDocument();
    // Code shows in the code card and again inside entry step 2
    expect(screen.getAllByText("1234").length).toBeGreaterThan(0);
    expect(screen.getByText(/How to Enter the Venue/i)).toBeInTheDocument();
    expect(screen.getByText(/How to Turn On the Lights/i)).toBeInTheDocument();
    expect(screen.getByText(/Wi-Fi Information/i)).toBeInTheDocument();
    // Guest report embedded (checklist + two photos)
    expect(screen.getByText(/Complete Your Guest Report/i)).toBeInTheDocument();
    expect(screen.getByText(/Venue Checklist/i)).toBeInTheDocument();
    expect(screen.getByText(/Upload Two Required Photos/i)).toBeInTheDocument();
    expect(screen.getByText(/Photo 1: Main Venue Space/i)).toBeInTheDocument();
    expect(screen.getByText(/Photo 2: Locked Entrance/i)).toBeInTheDocument();
    // Rules + details always at the bottom
    expect(screen.getByText(/Venue Rules/i)).toBeInTheDocument();
    expect(screen.getByText(/Reservation Details/i)).toBeInTheDocument();
    expect(screen.getByText("OEV-TEST01")).toBeInTheDocument();
    // Full rule tables with fees (per access-page spec doc)
    expect(screen.getByText(/maximum of 90 guests/i)).toBeInTheDocument();
    expect(screen.getByText(/\$500 and risk of the event being shut down/i)).toBeInTheDocument();
    expect(screen.getByText(/Pets are not allowed/i)).toBeInTheDocument();
    expect(screen.getByText("$250")).toBeInTheDocument();
  });

  it("renders all nine checklist items", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    renderAt("/accesscode");
    await lookup();

    await screen.findByText(/Venue Checklist/i);
    expect(screen.getByText(/All trash is bagged and placed on the back patio/i)).toBeInTheDocument();
    expect(screen.getByText(/tables and chairs are broken down/i)).toBeInTheDocument();
    expect(screen.getByText(/prep kitchen has been checked/i)).toBeInTheDocument();
    expect(screen.getByText(/Both bathrooms have been checked/i)).toBeInTheDocument();
    expect(screen.getByText(/personal items have been removed/i)).toBeInTheDocument();
    expect(screen.getByText(/remotes and venue equipment have been returned/i)).toBeInTheDocument();
    expect(screen.getByText(/All guests have left the venue/i)).toBeInTheDocument();
    expect(screen.getByText(/All lights are turned off/i)).toBeInTheDocument();
    expect(screen.getByText(/entrance door is locked/i)).toBeInTheDocument();
  });

  it("keeps the submit button disabled until checklist and photos are complete", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    const user = userEvent.setup();
    renderAt("/accesscode");
    await lookup();

    const submit = await screen.findByRole("button", { name: /Submit Guest Report/i });
    expect(submit).toBeDisabled();

    // Check all nine checklist items — still disabled (photos missing)
    for (const checkbox of screen.getAllByRole("checkbox")) {
      await user.click(checkbox);
    }
    expect(submit).toBeDisabled();

    // Upload both required photos — now enabled
    const photo = new File(["img"], "photo.jpg", { type: "image/jpeg" });
    await user.upload(screen.getByLabelText("Venue main space with lights on"), photo);
    await user.upload(screen.getByLabelText("Entrance door locked"), photo);
    expect(submit).toBeEnabled();
  });
});

describe("AccessCode — already-submitted state", () => {
  it("shows 'Report Already Submitted' when host_report_step === 'completed'", async () => {
    rpcMock.mockResolvedValueOnce({
      data: makeRow({ host_report_step: "completed" }),
      error: null,
    });

    renderAt("/accesscode");
    await lookup();

    expect(await screen.findByText(/Report Already Submitted/i)).toBeInTheDocument();
    expect(screen.queryByText(/Venue Checklist/i)).not.toBeInTheDocument();
    expect(screen.queryByText("1234")).not.toBeInTheDocument();
    expect(screen.getByText(/OEV-TEST01/)).toBeInTheDocument();
  });
});

describe("AccessCode — recurring access codes", () => {
  it("shows the door code and instructions without the guest report", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRecurringRow(), error: null });

    renderAt("/accesscode");
    await lookup("OEV-RFCG01");

    expect(await screen.findByText(/Your Access Is Ready/i)).toBeInTheDocument();
    expect(screen.getAllByText("1234").length).toBeGreaterThan(0);
    expect(screen.getByText(/How to Enter the Venue/i)).toBeInTheDocument();
    expect(screen.getByText(/Wi-Fi Information/i)).toBeInTheDocument();
    expect(screen.getByText(/Venue Rules/i)).toBeInTheDocument();
    // Recurring details instead of one-time reservation details
    expect(screen.getByText(/Recurring Access Details/i)).toBeInTheDocument();
    expect(screen.getByText("OEV-RFCG01")).toBeInTheDocument();
    expect(screen.getByText(/February 3, 2027/i)).toBeInTheDocument();
    // No guest report, no review CTA, no final venue check
    expect(screen.queryByText(/Venue Checklist/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Guest Report/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reservation Details/i)).not.toBeInTheDocument();
  });

  it("handles recurring_code_paused", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "recurring_code_paused" },
    });

    renderAt("/accesscode");
    await lookup("OEV-RFCG01");

    expect(await screen.findByText(/currently paused/i)).toBeInTheDocument();
  });

  it("handles recurring_code_expired", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "recurring_code_expired" },
    });

    renderAt("/accesscode");
    await lookup("OEV-RGST01");

    expect(await screen.findByText(/has expired/i)).toBeInTheDocument();
  });
});

describe("AccessCode — query param auto-lookup", () => {
  it("auto-runs lookup when ?res= query param present", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    renderAt("/accesscode?res=OEV-TEST01");

    expect(await screen.findByText(/Your Access Is Ready/i)).toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith(
      "get_access_code_for_reservation",
      { p_reservation_number: "OEV-TEST01", p_email: null },
    );
  });

  it("auto-runs lookup when ?email= query param present", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeRow(), error: null });

    renderAt("/accesscode?email=maria@example.com");

    expect(await screen.findByText(/Your Access Is Ready/i)).toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith(
      "get_access_code_for_reservation",
      { p_reservation_number: null, p_email: "maria@example.com" },
    );
  });

  it("auto-routes to STATE 1 when query param present and access not yet released", async () => {
    rpcMock.mockResolvedValueOnce({ data: makeLockedRow(), error: null });

    renderAt("/accesscode?res=OEV-TEST01");

    expect(await screen.findByText(/Your Access Is Not Available Yet/i)).toBeInTheDocument();
  });
});

describe("AccessCode — error states from RPC", () => {
  it("handles reservation_not_found", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "reservation_not_found" },
    });

    renderAt("/accesscode");
    await lookup("OEV-NOPE");

    expect(
      await screen.findByText(/couldn't find a reservation/i),
    ).toBeInTheDocument();
  });

  it("handles reservation_inactive", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: "reservation_inactive" },
    });

    renderAt("/accesscode");
    await lookup("OEV-CXLD");

    expect(
      await screen.findByText(/no longer active/i),
    ).toBeInTheDocument();
  });
});
