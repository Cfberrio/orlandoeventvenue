// Canonical public origin for customer-facing links (Stripe success/cancel
// URLs, emailed links). FRONTEND_URL overrides for staging; the fallback is
// the production custom domain.
//
// History: until Aug 2026 three functions fell back to
// "https://vsvsgesgqjtwutadcshi.lovable.app" — that subdomain is the SUPABASE
// project ref, not a Lovable site, so every server-generated Stripe redirect
// landed on Lovable's "Project not found" page (ClickUp 86e2qxh2w).
export function getFrontendUrl(): string {
  const url = Deno.env.get("FRONTEND_URL");
  if (!url) {
    console.warn("FRONTEND_URL not set — falling back to production domain");
  }
  return url || "https://orlandoeventvenue.com";
}
