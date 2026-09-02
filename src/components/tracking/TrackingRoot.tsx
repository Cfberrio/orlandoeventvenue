import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { deleteCookie, HONOR_AD_OPT_OUT, onConsentChange } from "@/lib/tracking/consent";
import { clearIdentity } from "@/lib/tracking/identity";
import { initPixelIfAllowed, pixelPageView } from "@/lib/tracking/pixel";
import { track } from "@/lib/tracking/track";
import { ConsentBanner } from "./ConsentBanner";

/**
 * Back-office prefixes that are never measured. The team's own navigation
 * would pollute the funnel and, worse, feed Meta an audience built out of
 * staff devices — a retargeting list of your own employees.
 */
const EXCLUDED_PREFIXES = ["/admin", "/staff", "/auth", "/stripe/"];

function isExcluded(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/**
 * Mounted once inside the router: SPA page views (internal ledger + Pixel),
 * consent side effects, and the cookie banner itself.
 */
export function TrackingRoot() {
  const { pathname } = useLocation();
  const excluded = isExcluded(pathname);

  useEffect(
    () =>
      onConsentChange(({ prefs }) => {
        // The banner is a record, not a gate, unless HONOR_AD_OPT_OUT is on
        // (see src/lib/tracking/consent.ts for why).
        if (HONOR_AD_OPT_OUT) {
          if (prefs.advertising) {
            if (initPixelIfAllowed()) pixelPageView();
          } else {
            // Technical revoke: Meta's identifiers leave with the consent.
            deleteCookie("_fbp");
            deleteCookie("_fbc");
          }
          if (!prefs.analytics) {
            clearIdentity();
            return;
          }
        }
        track("consent_updated");
      }),
    [],
  );

  useEffect(() => {
    if (excluded) return;
    initPixelIfAllowed();
    pixelPageView();
    track("page_viewed");
  }, [pathname, excluded]);

  if (excluded) return null;
  return <ConsentBanner />;
}
