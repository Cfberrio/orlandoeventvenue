import { Loader2 } from "lucide-react";
import { usePricing } from "@/hooks/usePricing";
import { useBarPackages, type BarPackage } from "@/hooks/useBarPackages";

const formatGuestPrice = (n: number) => (n % 1 === 0 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);

/* Line icons, 24px grid, stroke 1.7 — same family as the hero glyphs. */
const ICONS: Record<string, JSX.Element> = {
  mic: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3M8.5 21h7" />
    </svg>
  ),
  screen: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M12 16v4M8 20h8" />
    </svg>
  ),
  stream: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="7" width="12" height="11" rx="2.5" />
      <path d="m15 11 6-3v9l-6-3" />
    </svg>
  ),
  wine: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M8 3h8l-1 7a3.5 3.5 0 0 1-6 0Z" />
      <path d="M12 13.5V20M9 20h6" />
    </svg>
  ),
};

const BAR_ICON: Record<string, keyof typeof ICONS> = {
  house_beer_wine: "wine",
  essential_bar: "wine",
  signature_bar: "wine",
  bespoke_bar: "wine",
};

const AddonsSection = () => {
  const { pricing: p, items, isLoading } = usePricing();
  const { packages: barPackages } = useBarPackages();

  const labelFor = (key: string, fallback: string) =>
    items.find((i) => i.item_key === key)?.label ?? fallback;

  const production = [
    {
      icon: "mic" as const,
      name: labelFor("package_basic", "Basic A/V Package"),
      price: p.package_basic,
      features: ["AV System", "Microphones", "Speakers", "Projectors", "Tech Assistant"],
    },
    {
      icon: "screen" as const,
      name: labelFor("package_led", "LED Wall Package"),
      price: p.package_led,
      features: ["Includes Basic +", "Stage LED Wall Screen", "For presentations", "Immersive environments"],
    },
    {
      icon: "stream" as const,
      name: labelFor("package_workshop", "Workshop/Streaming Package"),
      price: p.package_workshop,
      features: ["Includes Basic & LED +", "Streaming Equipment", "Live streaming & recording", "Virtual conferencing"],
    },
  ];

  return (
    <section id="add-ons">
      <div className="wrap">
        <div className="shead">
          <h2 data-rv>Optional add-ons.</h2>
          <p className="lead" data-rv>
            Production support, bar service, and extras. Mix and match to fit your event.
          </p>
        </div>

        <h3 className="addon-h" data-rv>
          Production packages <em>per hour, added to your rental</em>
        </h3>
        <div className="atile-grid snap-row" data-rv-group>
          {production.map((pkg) => (
            <article className="atile" data-draw data-wiggle key={pkg.name}>
              {ICONS[pkg.icon]}
              <p className="lbl">{pkg.name}</p>
              <p className="aprice">
                {isLoading ? <Loader2 className="pspin" aria-label="Loading price" /> : `$${pkg.price}/hr`}
              </p>
              <ul>
                {pkg.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>

        <h3 className="addon-h" data-rv>
          Bar service, handled <em>pay online, we coordinate the vendor</em>
        </h3>
        <div className="atile-grid bar snap-row" data-rv-group>
          {barPackages.map((pkg: BarPackage) => (
            <article className="atile" data-draw data-wiggle key={pkg.key}>
              {pkg.badge === "Most Popular" && <span className="pop-badge">Most Popular</span>}
              {ICONS[BAR_ICON[pkg.key] ?? "wine"]}
              <p className="lbl">{pkg.label}</p>
              <p className="aprice">{formatGuestPrice(pkg.ratePerGuest)}/guest</p>
            </article>
          ))}
        </div>
        <p className="addon-note" data-rv>
          No outside alcohol or outside bartenders permitted. Available for all private events.
        </p>

        <h3 className="addon-h" data-rv>
          Extras
        </h3>
        <div className="extras" data-rv-group>
          <div className="extra-row">
            <span>Setup &amp; breakdown</span>
            <strong>
              {isLoading ? <Loader2 className="pspin" aria-label="Loading price" /> : `$${p.setup_breakdown}`}
            </strong>
          </div>
          <div className="extra-row">
            <span>Tablecloth</span>
            <strong>
              {isLoading ? (
                <Loader2 className="pspin" aria-label="Loading price" />
              ) : (
                `$${p.tablecloth_rental}/ea + $${p.tablecloth_cleaning_fee} cleaning`
              )}
            </strong>
          </div>
        </div>

        <div className="pricing-cta" data-rv>
          <a className="btn btn-primary btn-lg" href="/book">
            Add to My Booking
          </a>
        </div>
      </div>
    </section>
  );
};

export default AddonsSection;
