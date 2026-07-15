import { Loader2 } from "lucide-react";
import { usePricing } from "@/hooks/usePricing";

const HOURLY_FEATURES = [
  "Flexible scheduling",
  "90 chairs + 10 tables",
  "Prep kitchen",
  "Two bathrooms",
  "4-hour minimum",
];
const DAILY_FEATURES = [
  "Full 24-hour access",
  "90 chairs + 10 tables",
  "Prep kitchen",
  "Two bathrooms",
  "Best value for all-day events",
];

const Price = ({ value, isLoading, unit }: { value: number; isLoading: boolean; unit: string }) => (
  <p className="pprice">
    {isLoading ? <Loader2 className="pspin" aria-label="Loading price" /> : <span>${value}</span>}
    <em>/{unit}</em>
  </p>
);

const PricingSection = () => {
  const { pricing: p, isLoading } = usePricing();

  return (
    <section className="band-soft" id="pricing">
      <div className="wrap">
        <div className="shead">
          <h2 data-rv>Simple, transparent pricing.</h2>
          <p className="lead" data-rv>
            No hidden fees. Choose what works for your event.
          </p>
        </div>

        <div className="pgrid snap-row" data-rv-group>
          <article className="pcard">
            <h3>Hourly Rate</h3>
            <Price value={p.hourly_rate} isLoading={isLoading} unit="hour" />
            <ul>
              {HOURLY_FEATURES.map((f) => (
                <li key={f}>
                  <span className="ptick" /> {f}
                </li>
              ))}
            </ul>
            <a className="btn btn-ghost" href="/book?type=hourly">
              Select Hourly
            </a>
          </article>

          <article className="pcard pcard-daily">
            <span className="pop-badge">Most Popular</span>
            <h3>Daily Special</h3>
            <Price value={p.daily_rate} isLoading={isLoading} unit="day" />
            <ul>
              {DAILY_FEATURES.map((f) => (
                <li key={f}>
                  <span className="ptick" /> {f}
                </li>
              ))}
            </ul>
            <a className="btn btn-onblue" href="/book?type=daily">
              Select Daily
            </a>
          </article>
        </div>

        <div className="fee-line" data-rv>
          <div>
            <strong>Cleaning fee</strong>
            <span>One-time fee added to all bookings</span>
          </div>
          <p className="pprice small">
            {isLoading ? <Loader2 className="pspin" aria-label="Loading price" /> : <span>${p.cleaning_fee}</span>}
            <em>/reservation</em>
          </p>
        </div>

        <p className="pricing-note" data-rv>
          Transparent pricing. Taxes/permits not included where applicable.
        </p>
        <div className="pricing-cta" data-rv>
          <a className="btn btn-primary btn-lg" href="/book">
            Book Now
          </a>
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
