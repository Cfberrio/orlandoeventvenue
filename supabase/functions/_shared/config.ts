// Canonical public origin for customer-facing links (Stripe success/cancel
// URLs, emailed links). FRONTEND_URL overrides for staging; the fallback is
// the live custom domain that serves the app.
//
// The domain here must be verified by loading it, not just by pinging it:
// - orlandoeventvenue.org serves the app (and is the canonical URL in index.html)
// - orlandoeventvenue.com is a parked GoDaddy lander that answers 200 and
//   bounces every path to /lander
// - vsvsgesgqjtwutadcshi.lovable.app is the SUPABASE project ref, not a Lovable
//   site; it 404s. Three functions fell back to it until Aug 2026, so every
//   server-generated Stripe redirect dumped paying customers on Lovable's
//   "Project not found" page (ClickUp 86e2qxh2w).
export function getFrontendUrl(): string {
  const url = Deno.env.get("FRONTEND_URL");
  if (!url) {
    console.warn("FRONTEND_URL not set — falling back to production domain");
  }
  return url || "https://orlandoeventvenue.org";
}
