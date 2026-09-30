import { describe, expect, it, vi } from "vitest";
import { describeRescheduleResult, rescheduleBooking, type ReschedulePayload } from "./rescheduleBooking";

const payload: ReschedulePayload = {
  booking_id: "b1",
  event_date: "2026-12-01",
  start_time: "09:00",
  end_time: "15:00",
  reason: null,
};

const clientReturning = (result: { data: unknown; error: unknown }) => ({
  functions: { invoke: vi.fn().mockResolvedValue(result) },
});

describe("rescheduleBooking", () => {
  it("invokes the function by name (no env-built URL) with the payload", async () => {
    const client = clientReturning({ data: { ok: true }, error: null });
    await rescheduleBooking(client, payload);
    expect(client.functions.invoke).toHaveBeenCalledWith("reschedule-booking", { body: payload });
  });

  it("returns the body of a 200 response, including business errors", async () => {
    const client = clientReturning({ data: { ok: false, error: "date_conflict" }, error: null });
    await expect(rescheduleBooking(client, payload)).resolves.toEqual({ ok: false, error: "date_conflict" });
  });

  it("reads the JSON body of a non-2xx response", async () => {
    const context = new Response(JSON.stringify({ ok: false, error: "admin_required" }), { status: 403 });
    const client = clientReturning({ data: null, error: Object.assign(new Error("non-2xx"), { context }) });
    await expect(rescheduleBooking(client, payload)).resolves.toEqual({ ok: false, error: "admin_required" });
  });

  it("throws when the error body is not JSON (e.g. an HTML page)", async () => {
    const context = new Response("<!doctype html><html></html>", { status: 404 });
    const err = Object.assign(new Error("Edge Function returned a non-2xx status code"), { context });
    const client = clientReturning({ data: null, error: err });
    await expect(rescheduleBooking(client, payload)).rejects.toBe(err);
  });
});

describe("describeRescheduleResult", () => {
  it("maps known business errors and names the conflict", () => {
    const t = describeRescheduleResult({ ok: false, error: "time_overlap", conflict: { guest: "Ana" } });
    expect(t).toMatchObject({ title: "Cannot reschedule", variant: "destructive", success: false });
    expect(t.description).toBe("That time overlaps with another booking. (Ana)");
  });

  it("covers the new server-side validations", () => {
    expect(describeRescheduleResult({ ok: false, error: "past_date" }).description).toMatch(/past/);
    expect(describeRescheduleResult({ ok: false, error: "blocked_date" }).description).toMatch(/blocked/);
  });

  it("falls back to the server message for unknown errors", () => {
    expect(describeRescheduleResult({ ok: false, error: "x", message: "boom" }).description).toBe("boom");
  });

  it("reports a no-op without claiming a reschedule", () => {
    expect(describeRescheduleResult({ ok: true, changed: false, warnings: [] })).toMatchObject({
      title: "Date unchanged",
      success: true,
    });
  });

  it("a no-op retry that still fails a follow-up is reported as a failure", () => {
    const t = describeRescheduleResult({ ok: true, changed: false, warnings: ["ghl_sync"] });
    expect(t.variant).toBe("destructive");
    expect(t.description).toContain("GHL contact sync");
  });

  it("surfaces failed follow-ups instead of a plain success", () => {
    const t = describeRescheduleResult({ ok: true, changed: true, warnings: ["ghl_sync", "balance"] });
    expect(t.success).toBe(true);
    expect(t.variant).toBe("destructive");
    expect(t.description).toContain("GHL contact sync");
    expect(t.description).toContain("remaining balance");
  });

  it("plain success when every follow-up ran", () => {
    expect(describeRescheduleResult({ ok: true, changed: true, warnings: [] })).toMatchObject({
      title: "Booking rescheduled successfully!",
      success: true,
    });
  });
});
