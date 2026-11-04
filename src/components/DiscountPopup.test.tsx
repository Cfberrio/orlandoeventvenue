import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { fromMock, insertMock, invokeMock, toastMock, trackPopupLeadMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  insertMock: vi.fn(),
  invokeMock: vi.fn(),
  toastMock: vi.fn(),
  trackPopupLeadMock: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: fromMock, functions: { invoke: invokeMock } },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: toastMock }) }));
vi.mock("@/lib/tracking/funnel", () => ({ trackPopupLead: trackPopupLeadMock }));

import DiscountPopup from "./DiscountPopup";

/**
 * Models PostgREST against the real popup_leads policies: anon may INSERT but
 * has no SELECT policy, so asking for the row back fails the whole insert with
 * 42501. A mock that resolved `.select()` happily is how the Sep 2026 outage
 * (63 days, 0 leads) would have passed unnoticed.
 */
function insertBuilder(plainResult: { error: { code: string; message: string } | null }) {
  return {
    select: () => ({
      maybeSingle: async () => ({
        data: null,
        error: { code: "42501", message: 'new row violates row-level security policy for table "popup_leads"' },
      }),
    }),
    then: (
      resolve: (value: typeof plainResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(plainResult).then(resolve, reject),
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function openPopup() {
  vi.useFakeTimers();
  render(<DiscountPopup />);
  act(() => {
    vi.advanceTimersByTime(5000);
  });
  vi.useRealTimers();
}

function fillAndSubmit() {
  fireEvent.change(screen.getByLabelText(/first name/i), { target: { value: "Test" } });
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: "Guest@Example.com" } });
  fireEvent.change(screen.getByLabelText(/mobile phone/i), { target: { value: "4075551212" } });
  fireEvent.change(screen.getByLabelText(/what date/i), { target: { value: "2027-03-10" } });
  const form = screen.getByRole("button", { name: /send my kit/i }).closest("form");
  fireEvent.submit(form as HTMLFormElement);
}

const functionsInvoked = () => invokeMock.mock.calls.map(([name]) => name);

describe("DiscountPopup submit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    fromMock.mockReturnValue({ insert: insertMock });
    insertMock.mockImplementation(() => insertBuilder({ error: null }));
    invokeMock.mockResolvedValue({ data: { ok: true }, error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("saves a new lead as anon, then syncs GHL, sends email 1 and reports the Lead", async () => {
    openPopup();
    fillAndSubmit();

    expect(await screen.findByText(/are on the way/i)).toBeTruthy();
    expect(toastMock).not.toHaveBeenCalled();
    expect(fromMock).toHaveBeenCalledWith("popup_leads");

    const row = insertMock.mock.calls[0][0];
    expect(row.id).toMatch(UUID_RE);
    expect(row.email).toBe("guest@example.com");

    // The Meta Lead must name the same id the row was written with: track-event
    // refuses to mirror a Lead whose popup_leads row does not exist.
    expect(trackPopupLeadMock).toHaveBeenCalledWith(row.id, "guest@example.com");
    expect(functionsInvoked()).toEqual(
      expect.arrayContaining(["send-popup-lead", "send-discount-email"]),
    );
    expect(localStorage.getItem("popup_kit_shown")).toBe("true");
  });

  it("still saves the lead when the browser has no crypto.randomUUID, without a Meta Lead", async () => {
    vi.stubGlobal("crypto", {});
    openPopup();
    fillAndSubmit();

    expect(await screen.findByText(/are on the way/i)).toBeTruthy();
    expect(insertMock.mock.calls[0][0]).not.toHaveProperty("id");
    expect(trackPopupLeadMock).not.toHaveBeenCalled();
    expect(functionsInvoked()).toContain("send-discount-email");
  });

  it("treats a duplicate email as already on the list: GHL only, no email and no Lead", async () => {
    insertMock.mockImplementation(() =>
      insertBuilder({ error: { code: "23505", message: "duplicate key" } }),
    );
    openPopup();
    fillAndSubmit();

    expect(await screen.findByText(/are on the way/i)).toBeTruthy();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: expect.stringMatching(/already on the list/i) }),
    );
    expect(functionsInvoked()).toEqual(["send-popup-lead"]);
    expect(trackPopupLeadMock).not.toHaveBeenCalled();
  });

  it("does not blame the guest's fields when the save fails on our side", async () => {
    insertMock.mockImplementation(() =>
      insertBuilder({ error: { code: "XX000", message: "boom" } }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    openPopup();
    fillAndSubmit();

    await waitFor(() => expect(toastMock).toHaveBeenCalled());
    const shown = toastMock.mock.calls[0][0];
    expect(shown.variant).toBe("destructive");
    expect(shown.description).not.toMatch(/check the fields/i);
    expect(shown.description).toMatch(/407 974 5979/);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(trackPopupLeadMock).not.toHaveBeenCalled();
    expect(localStorage.getItem("popup_kit_shown")).toBeNull();
  });
});
