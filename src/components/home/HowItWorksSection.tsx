const STEPS = [
  { title: "Enter Event Date", body: "Share your date and time requirements." },
  { title: "Payment & Agreement", body: "Clear invoice with e-signature." },
  { title: "Confirm with Payment", body: "Pay 50% of total to lock your date and add any packages." },
  { title: "Show Up & Enjoy", body: "Get access instructions and on-site support." },
];

const HowItWorksSection = () => (
  <section className="band-soft" id="how-it-works">
    <div className="wrap">
      <div className="shead">
        <h2 data-rv>Four simple steps.</h2>
        <p className="lead" data-rv>
          From date to done — the whole booking takes minutes.
        </p>
      </div>
      <div className="steps snap-row" data-rv-group>
        {STEPS.map((s, i) => (
          <div className="step" key={s.title}>
            <div className="num" data-pop>
              {i + 1}
            </div>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
          </div>
        ))}
      </div>
      <div className="pricing-cta" data-rv>
        <a className="btn btn-primary btn-lg" href="/book">
          Book Now
        </a>
      </div>
    </div>
  </section>
);

export default HowItWorksSection;
