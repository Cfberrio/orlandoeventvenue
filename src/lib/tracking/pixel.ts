// Meta Pixel loader.
//
// The Pixel is what mints the _fbp browser id and reports the browser half of
// each conversion, so it loads for every visitor as long as a pixel id is
// configured (see consent.ts for why the banner does not gate it).
//
// Every funnel event passes an eventID so the server-side CAPI twin
// deduplicates into a single action inside Meta.
import { META_PIXEL_ID } from "./config";
import { adsAllowed } from "./consent";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _fbq?: unknown;
  }
}

let initialized = false;

export function pixelActive(): boolean {
  return initialized;
}

/**
 * Loads + inits the Pixel. No-op when META_PIXEL_ID is empty, which is the
 * safe default state: nothing loads and no request leaves the browser until
 * the Dataset exists (docs/META-PIXEL-CAPI-SETUP.md).
 */
export function initPixelIfAllowed(): boolean {
  if (initialized) return true;
  if (typeof window === "undefined" || !META_PIXEL_ID || !adsAllowed()) return false;

  // Standard Meta bootstrap: a stub that queues calls until fbevents.js lands.
  if (!window.fbq) {
    type FbqStub = ((...args: unknown[]) => void) & {
      callMethod?: (...args: unknown[]) => void;
      queue: unknown[][];
      push: unknown;
      loaded: boolean;
      version: string;
    };
    const n = ((...args: unknown[]) => {
      if (n.callMethod) n.callMethod(...args);
      else n.queue.push(args);
    }) as FbqStub;
    n.queue = [];
    n.push = n;
    n.loaded = true;
    n.version = "2.0";
    window.fbq = n;
    if (!window._fbq) window._fbq = n;
    const t = document.createElement("script");
    t.async = true;
    t.src = "https://connect.facebook.net/en_US/fbevents.js";
    const s = document.getElementsByTagName("script")[0];
    if (s?.parentNode) s.parentNode.insertBefore(t, s);
    else document.head.appendChild(t);
  }
  window.fbq("init", META_PIXEL_ID);
  initialized = true;
  return true;
}

export function pixelTrack(
  event: string,
  params?: Record<string, unknown>,
  eventId?: string,
): void {
  if (!initialized || typeof window === "undefined" || !window.fbq) return;
  if (eventId) window.fbq("track", event, params ?? {}, { eventID: eventId });
  else window.fbq("track", event, params ?? {});
}

export function pixelPageView(): void {
  pixelTrack("PageView");
}
