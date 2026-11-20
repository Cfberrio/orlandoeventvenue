// Where Stripe sends the guest after paying the deposit (success_url /
// cancel_url). The browser posts its own page URL, but a request can carry any
// value, so it is never trusted as-is: a crafted URL would point success_url —
// and the Checkout session id + booking id it carries — at any site, right
// after a real payment.
//
// Before 2026-11-20 any host ending in .lovable.app / .lovableproject.com /
// .lovable.dev passed. Anyone can publish a free site there, so that was not
// "our site". Now only our domain, this project's own Lovable hosts and local
// dev pass; anything else returns null and the caller falls back to
// getFrontendUrl(). Pure (no Deno APIs) so vitest can test it.

const ALLOWED_HOSTS = new Set([
  "orlandoeventvenue.org",
  "www.orlandoeventvenue.org",
  "orlandoeventvenue.lovable.app",
]);

// Previews of THIS Lovable project only (id-preview--<id>.lovable.app,
// <id>.lovableproject.com).
const PROJECT_PREVIEW =
  /^[a-z0-9-]*9838d610-03f9-4469-a8f3-362588d13d76[a-z0-9-]*\.(lovable\.app|lovableproject\.com)$/;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/** Our own origin + path from `url`, or null when it is not ours. */
export function safeReturnUrl(url: unknown): string | null {
  if (typeof url !== "string") return null;
  try {
    const u = new URL(url.trim());
    if (u.username || u.password) return null;
    const host = u.hostname.toLowerCase();
    const ours =
      u.protocol === "https:" &&
      u.port === "" &&
      (ALLOWED_HOSTS.has(host) || PROJECT_PREVIEW.test(host));
    const local = u.protocol === "http:" && LOCAL_HOSTS.has(host);
    if (!ours && !local) return null;
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}
