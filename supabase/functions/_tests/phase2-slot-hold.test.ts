import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

describe("E-18 slot hold before Stripe", () => {
  const mig = read("supabase/migrations/20261117190000_phase2e_slot_hold.sql");
  const fn = read("supabase/functions/create-checkout/index.ts");

  it("claims the slot under the per-date lock, holds 35 min, service only", () => {
    expect(mig).toMatch(/pg_advisory_xact_lock\(hashtext\('oev_booking_date:'/);
    expect(mig).toMatch(/slot_hold_until = now\(\) \+ interval '35 minutes'/);
    expect(mig).toMatch(/o\.payment_status = 'pending' AND o\.slot_hold_until > now\(\)/);
    expect(mig).toMatch(/GRANT EXECUTE ON FUNCTION public\.claim_booking_slot\(uuid\) TO service_role/);
  });

  it("create-checkout claims before creating the session; the session expires first", () => {
    expect(fn.indexOf('rpc("claim_booking_slot"')).toBeGreaterThan(0);
    expect(fn.indexOf('rpc("claim_booking_slot"')).toBeLessThan(fn.indexOf("stripe.checkout.sessions.create("));
    expect(fn).toMatch(/expires_at: Math\.floor\(Date\.now\(\) \/ 1000\) \+ 31 \* 60/);
    expect(fn).toMatch(/error: "SLOT_TAKEN"/);
  });

  it("a payment on a taken slot is flagged, never refused", () => {
    expect(mig).toMatch(/'slot_conflict_on_payment'/);
  });
});
