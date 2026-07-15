const ARROW = (
  <svg
    className="arrow"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M7 17 17 7M9 7h8v8" />
  </svg>
);

const CARDS = [
  {
    href: "#pricing",
    big: "Flexible",
    small: "hourly or daily, 24/7",
    body: "Book by the hour or take the full day. All-day and night availability, on your schedule.",
  },
  {
    href: "#included",
    big: "Complete",
    small: "everything included",
    body: "Chairs, tables, prep kitchen, free parking and A/V options. One space, ready to go.",
  },
  {
    href: "#how-it-works",
    big: "Simple",
    small: "flat pricing, book online",
    body: "Transparent pricing with no hidden fees. Pick your date, sign, pay online — done.",
  },
];

const WhyCards = () => (
  <section id="why">
    <div className="wrap">
      <div className="shead">
        <h2 data-rv>Three reasons hosts say yes.</h2>
      </div>
      <div className="grid-3 snap-row" data-rv-group>
        {CARDS.map((c) => (
          <a className="vcard" href={c.href} key={c.big}>
            <span className="big">{c.big}</span>
            <span className="small">{c.small}</span>
            <p>{c.body}</p>
            {ARROW}
          </a>
        ))}
      </div>
    </div>
  </section>
);

export default WhyCards;
