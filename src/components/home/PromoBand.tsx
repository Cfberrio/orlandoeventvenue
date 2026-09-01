import { usePromoBandMotion } from "@/lib/marketingMotion";
/* Same "Event Space" frame the gallery carousel uses. */
import venuePhoto from "@/assets/venue/event-stage-02-2048.webp";
import venuePhoto2x from "@/assets/venue/event-stage-02-4096.webp";

const CHECKLIST = [
  "90 chairs + 10 tables",
  "Prep kitchen",
  "Free parking on-site",
  "24/7 access",
  "High-level A/V production available",
  "No catering restrictions",
];

const PromoBand = () => {
  const scope = usePromoBandMotion<HTMLElement>();

  return (
    <section className="promo" id="included" ref={scope}>
      <div className="wrap">
        <div className="promo-band" data-rv>
          <div className="promo-copy">
            <p className="p-eyebrow">The OEV rental</p>
            <h2>Everything included. One flat price.</h2>
            <p className="p-note">No hidden fees. No deposit.</p>
            <ul className="p-check">
              {CHECKLIST.map((item) => (
                <li key={item}>
                  <span className="tick" /> {item}
                </li>
              ))}
            </ul>
            <div className="promo-cta-row">
              <a className="btn btn-onblue" href="/book">
                Book Now
              </a>
              <a
                className="promo-reviews"
                href="https://g.page/r/CU-yUA0El90UEAE/review"
                target="_blank"
                rel="noopener noreferrer"
              >
                ⭐ See our 5-star reviews
              </a>
            </div>
          </div>
          <div className="promo-right">
            <div className="bubble" aria-hidden data-float>
              <strong>Flat pricing</strong>
              <span>no hidden fees</span>
            </div>
            <span className="seal" aria-label="Zero dollar deposit">
              $0
              <small>deposit</small>
            </span>
            <div className="promo-photo">
              <img
                src={venuePhoto}
                srcSet={`${venuePhoto} 2048w, ${venuePhoto2x} 4096w`}
                sizes="(max-width: 960px) 92vw, 40vw"
                alt="The OEV event space set up for an event"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PromoBand;
