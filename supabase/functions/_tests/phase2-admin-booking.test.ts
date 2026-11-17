import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("E-16 / E-17 admin-created bookings", () => {
  const mig = read("supabase/migrations/20261117180000_phase2e_admin_booking.sql");

  it("one transaction: lock dates, re-check conflicts, then insert", () => {
    expect(mig.indexOf("pg_advisory_xact_lock(hashtext('oev_booking_date:'")).toBeLessThan(mig.indexOf("_booking_slot_conflict(v_d"));
    expect(mig.indexOf("_booking_slot_conflict(v_d")).toBeLessThan(mig.indexOf("INSERT INTO public.bookings"));
    expect(mig).toMatch(/end time must be after start time/);
    expect(mig).toMatch(/enter the number of guests/);
  });

  it("one booking per occurrence linked by series_id; external is single-date", () => {
    expect(mig).toMatch(/ADD COLUMN IF NOT EXISTS series_id uuid/);
    expect(mig).toMatch(/FOREACH v_d IN ARRAY v_dates LOOP\s+IF v_kind = 'internal' THEN\s+INSERT INTO public\.bookings/);
    expect(mig).toMatch(/external bookings are one date each/);
  });

  it("external bookings reach pre_event_ready through the lifecycle writer", () => {
    expect(mig).toMatch(/set_config\('oev\.lifecycle_writer', 'on', true\);\s+UPDATE public\.bookings SET pre_event_ready = 'true', lifecycle_status = 'pre_event_ready'/);
  });

  it("wizards no longer insert bookings or blocks from the browser", () => {
    for (const f of ["src/components/admin/InternalBookingWizard.tsx", "src/components/admin/ExternalBookingWizard.tsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/rpc\("admin_create_blocking_booking"/);
      expect(src, f).not.toMatch(/from\("bookings"\)\s*\.(insert|update)/);
      expect(src, f).not.toMatch(/createBlock\.mutateAsync/);
    }
  });
});
