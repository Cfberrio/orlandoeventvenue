import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("E-4 one lifecycle writer", () => {
  const writer = read("supabase/migrations/20261117170000_phase2d_lifecycle_writer.sql");
  const guard = read("supabase/migrations/20261117170100_phase2d_lifecycle_guard.sql");

  it("server writers mark the transaction before writing lifecycle", () => {
    expect(writer).toMatch(/oev\.lifecycle_writer/);
    expect(writer).toMatch(/CREATE OR REPLACE FUNCTION public\.admin_transition_booking/);
    expect(writer).toMatch(/CREATE OR REPLACE FUNCTION public\.ghl_apply_booking_status/);
    expect(writer).toMatch(/say why the status is being corrected/);
    expect(writer).toMatch(/REVOKE ALL ON FUNCTION public\.ghl_apply_booking_status\(uuid, text, text, text, text\) FROM PUBLIC, anon, authenticated/);
  });

  it("guard rejects unmarked lifecycle writes except cancels and nested trigger writes", () => {
    expect(guard).toMatch(/NEW\.lifecycle_status IS DISTINCT FROM 'cancelled'/);
    expect(guard).toMatch(/pg_trigger_depth\(\) <= 1/);
    expect(guard).toMatch(/bookings_lifecycle_status_check/);
  });

  it("admin page and GHL no longer write lifecycle_status directly", () => {
    const page = read("src/pages/admin/BookingDetail.tsx");
    expect(page).not.toMatch(/updates: \{ lifecycle_status/);
    expect(page).toMatch(/transitionBooking\(supabase as never, booking\.id, "closed_review_complete"\)/);
    const ghl = read("supabase/functions/ghl-update-booking-status/index.ts");
    expect(ghl).toMatch(/rpc\("ghl_apply_booking_status"/);
    expect(ghl).not.toMatch(/updateData\.lifecycle_status/);
  });
});
