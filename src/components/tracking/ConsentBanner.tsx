import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  getConsent,
  HONOR_AD_OPT_OUT,
  onConsentOpen,
  setConsent,
  type ConsentAction,
} from "@/lib/tracking/consent";
import { recordConsent } from "@/lib/tracking/track";

type Toggles = { preferences: boolean; analytics: boolean; advertising: boolean };

/**
 * Cookie banner.
 *
 * IMPORTANT — what this control actually does on OEV today: the choice made
 * here is written to a first-party cookie and journaled to consent_record, but
 * it does NOT gate analytics or the Meta Pixel. Capture continues either way.
 * That is a deliberate product decision; the single switch that changes it is
 * HONOR_AD_OPT_OUT in src/lib/tracking/consent.ts, which this component reads
 * so the copy stays truthful in both modes.
 *
 * Booking and payment work identically whatever is chosen here.
 */
export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [manage, setManage] = useState(false);
  const [toggles, setToggles] = useState<Toggles>({
    preferences: true,
    analytics: true,
    advertising: true,
  });

  useEffect(() => {
    // Decided after mount so the first client render matches the server HTML.
    setVisible(!getConsent());
    return onConsentOpen(() => {
      const c = getConsent();
      if (c) {
        setToggles({
          preferences: c.preferences,
          analytics: c.analytics,
          advertising: c.advertising,
        });
      }
      setManage(true);
      setVisible(true);
    });
  }, []);

  if (!visible) return null;

  const decide = (t: Toggles, action: ConsentAction) => {
    const saved = setConsent(t, action);
    recordConsent(saved, action);
    setManage(false);
    setVisible(false);
  };

  const row = (
    key: keyof Toggles,
    label: string,
    detail: string,
    locked = false,
  ) => (
    <label className="flex items-start gap-3 py-2 cursor-pointer">
      <Checkbox
        className="mt-0.5"
        checked={locked ? true : toggles[key]}
        disabled={locked}
        onCheckedChange={(v) => setToggles((p) => ({ ...p, [key]: v === true }))}
      />
      <span className="text-sm leading-tight">
        <span className="font-semibold text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-x-3 bottom-3 z-[70] sm:inset-x-auto sm:right-4 sm:bottom-4 sm:max-w-md">
      <div className="rounded-2xl border bg-background p-4 shadow-2xl sm:p-5">
        <h3 className="text-sm font-bold uppercase tracking-wider text-primary">
          Cookies at Orlando Event Venue
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          We use essential cookies to run the site and to process your booking, first-party
          analytics to understand how guests plan their events, and advertising cookies (Meta,
          Google) so we can show relevant ads and measure which ones bring real bookings. We never
          sell your information.{" "}
          <Link to="/privacy-policy" className="font-semibold text-primary hover:underline">
            Privacy Policy
          </Link>
        </p>

        {manage && (
          <div className="mt-3 rounded-xl bg-muted/50 px-3 py-1">
            {row(
              "preferences",
              "Essential",
              "Booking flow, security, payments. Always on.",
              true,
            )}
            {row("preferences", "Preferences", "Remembers interface choices.")}
            {row("analytics", "Analytics", "First-party only — how guests use the site.")}
            {row(
              "advertising",
              "Advertising (Meta, Google)",
              "Relevant ads on Instagram, Facebook and Google.",
            )}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {manage ? (
            <Button size="sm" onClick={() => decide(toggles, "custom")}>
              Save choices
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={() =>
                  decide({ preferences: true, analytics: true, advertising: true }, "accept_all")
                }
              >
                Accept all
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  decide(
                    { preferences: false, analytics: false, advertising: false },
                    "reject_all",
                  )
                }
              >
                Essential only
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setManage(true)}>
                Manage
              </Button>
            </>
          )}
        </div>

        {!HONOR_AD_OPT_OUT && (
          // Kept accurate on purpose: while the switch is off, a visitor who
          // picks "Essential only" is still measured, and saying so here is
          // the difference between a disclosure and a dark pattern.
          <p className="mt-3 border-t pt-2 text-[11px] leading-snug text-muted-foreground">
            Your choice is recorded and honored for interface preferences. Aggregate measurement
            of site and ad performance continues regardless of this setting. To request deletion
            of your data, contact us through the{" "}
            <Link to="/privacy-policy" className="underline">
              Privacy Policy
            </Link>
            .
          </p>
        )}
      </div>
    </div>
  );
}
