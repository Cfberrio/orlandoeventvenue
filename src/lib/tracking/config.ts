// Public configuration for the tracking layer. Everything here ships in the
// browser bundle by design — a Pixel id is public the moment the Pixel fires,
// and the Supabase publishable key is the anon key the app already ships.
//
// The SERVER twins are secrets and must never appear in this file:
//   META_PIXEL_ID, META_CAPI_TOKEN  → Lovable Cloud edge function secrets.

/**
 * Meta Pixel / Dataset id.
 *
 * An EMPTY string keeps the whole Pixel layer disabled: nothing loads, nothing
 * fires, no request leaves the browser. That is the intended state until the
 * Dataset exists in Meta Events Manager.
 *
 * To turn tracking on, follow docs/META-PIXEL-CAPI-SETUP.md, then paste the
 * 15-16 digit Dataset id here and republish. The server half needs the SAME id
 * set as the META_PIXEL_ID secret, or Pixel and CAPI will report into two
 * different datasets and nothing will deduplicate.
 */
export const META_PIXEL_ID = "27500552799622072";

// Mirrors src/integrations/supabase/client.ts, which is Lovable-generated and
// must not be edited. track.ts posts with raw fetch rather than the supabase
// client because it needs `keepalive: true` — without it the browser cancels
// the request the moment we redirect to Stripe, and the checkout event is lost
// exactly when it matters most.
export const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://vsvsgesgqjtwutadcshi.supabase.co";

export const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzdnNnZXNncWp0d3V0YWRjc2hpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQzNDA2MDIsImV4cCI6MjA3OTkxNjYwMn0.8z3tFxcYHbrVA9ZrRUFwuiI9Sb5StGCrpAvCbRtUgK4";
