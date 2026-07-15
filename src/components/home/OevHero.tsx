import { useRef } from "react";
import { gsap, SplitText, useGSAP } from "@/lib/gsap";
import { MM } from "@/lib/marketingMotion";

/* Ambient event glyphs orbiting the cursor (desktop + fine pointer only).
 * `depth` scales how far each drifts. Mobile never mounts them (CSS). */
const ORBITS = [
  { glyph: 0, top: "14%", left: "7%", size: 52, depth: 0.6 },
  { glyph: 1, top: "22%", left: "90%", size: 58, depth: 1.0 },
  { glyph: 2, top: "72%", left: "9%", size: 50, depth: 0.8 },
  { glyph: 3, top: "76%", left: "86%", size: 46, depth: 1.15 },
  { glyph: 1, top: "9%", left: "46%", size: 32, depth: 0.4 },
  { glyph: 0, top: "84%", left: "54%", size: 34, depth: 0.55 },
];

/* Line icons on a shared 24px grid, stroke 1.7 (one family). */
const GLYPHS = [
  /* toast glasses */
  <svg key="g0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <path d="M8 3 6.5 10a3.5 3.5 0 0 0 7 0L12 3Z" />
    <path d="M10 13.5V20M7.5 20h5" />
    <path d="m16 5 4 1.5-2 5.5a2.6 2.6 0 0 1-3.3 1.6" />
  </svg>,
  /* music note */
  <svg key="g1" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <circle cx="7" cy="18" r="3" />
    <path d="M10 18V5l9-2v12" />
    <circle cx="16" cy="15" r="3" />
  </svg>,
  /* stage lights */
  <svg key="g2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
    <path d="M12 3v3M5 5l2 2.5M19 5l-2 2.5" />
    <path d="M8 21a4 4 0 1 1 8 0Z" />
    <path d="M12 13v-2" />
  </svg>,
  /* camera */
  <svg key="g3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="7" width="12" height="11" rx="2.5" />
    <path d="m15 11 6-3v9l-6-3" />
  </svg>,
];

const OevHero = () => {
  const scope = useRef<HTMLElement>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();

      mm.add(MM.noPref, () => {
        /* fromTo throughout: end state explicit, nothing can strand hidden. */
        const tl = gsap.timeline({ defaults: { ease: "power3.out", duration: 0.8 } });
        tl.fromTo(".pre", { y: 24, opacity: 0 }, { y: 0, opacity: 1 }, 0)
          .fromTo(
            ".evtypes span",
            { scale: 0.6, opacity: 0 },
            { scale: 1, opacity: 1, ease: "back.out(2)", duration: 0.5, stagger: 0.06 },
            0.55,
          )
          .fromTo(".post", { y: 14, opacity: 0 }, { y: 0, opacity: 1 }, 0.7)
          .fromTo(".hero-stats", { y: 18, opacity: 0 }, { y: 0, opacity: 1 }, 0.82)
          .fromTo(".hero-cta-row", { opacity: 0 }, { opacity: 1 }, 0.95);

        SplitText.create(root.querySelector(".giant"), {
          type: "lines,words",
          mask: "lines",
          autoSplit: true,
          onSplit: (self) =>
            gsap.fromTo(
              self.words,
              { yPercent: 110 },
              { yPercent: 0, duration: 0.9, ease: "power3.out", stagger: 0.06, delay: 0.15 },
            ),
        });
      });

      mm.add(`${MM.desktop} and (hover: hover) and (pointer: fine)`, () => {
        const inners = gsap.utils.toArray<HTMLElement>(root.querySelectorAll(".orbit-in"));
        const movers = inners.map((el) => ({
          depth: Number(el.dataset.depth ?? "0.6"),
          x: gsap.quickTo(el, "x", { duration: 0.9, ease: "power3.out" }),
          y: gsap.quickTo(el, "y", { duration: 0.9, ease: "power3.out" }),
        }));
        const onMove = (e: PointerEvent) => {
          const r = root.getBoundingClientRect();
          const nx = (e.clientX - r.left) / r.width - 0.5;
          const ny = (e.clientY - r.top) / r.height - 0.5;
          for (const m of movers) {
            m.x(nx * 70 * m.depth);
            m.y(ny * 70 * m.depth);
          }
        };
        root.addEventListener("pointermove", onMove, { passive: true });
        return () => root.removeEventListener("pointermove", onMove);
      });
    },
    { scope },
  );

  return (
    <section className="hero" id="top" ref={scope}>
      <div className="hero-orbits" aria-hidden>
        {ORBITS.map((o, i) => (
          <span
            key={i}
            className="orbit"
            style={{ top: o.top, left: o.left, width: o.size, height: o.size }}
          >
            <span className="orbit-in" data-depth={o.depth}>
              {GLYPHS[o.glyph]}
            </span>
          </span>
        ))}
      </div>
      <div className="wrap">
        <h1>
          <span className="pre">Modern venue for</span>
          <span className="giant">events that just work.</span>
          <span className="post">Near Downtown Orlando.</span>
        </h1>
        <p className="evtypes">
          <span className="ev-corp">Corporate</span> · <span className="ev-cele">Celebrations</span>{" "}
          · <span className="ev-pres">Presentations</span> ·{" "}
          <span className="ev-prod">Productions</span>
        </p>

        <div className="hero-stats">
          <div className="stat">
            <span className="stat-num" data-count="90">
              90
            </span>
            <span className="stat-label">Chairs</span>
          </div>
          <div className="stat">
            <span className="stat-num" data-count="10">
              10
            </span>
            <span className="stat-label">Tables</span>
          </div>
          <div className="stat">
            <span className="stat-num">
              <span data-count="24">24</span>/7
            </span>
            <span className="stat-label">Access</span>
          </div>
          <div className="stat">
            <span className="stat-num">
              $<span data-count="0">0</span>
            </span>
            <span className="stat-label">Deposit</span>
          </div>
        </div>

        <div className="hero-cta-row">
          <a className="btn btn-primary btn-lg" href="/book">
            Book Now
          </a>
          <a className="btn btn-ghost btn-lg" href="/schedule-tour">
            Schedule a Tour
          </a>
        </div>
        <p className="hero-note">Flat pricing · No hidden fees · No catering restrictions</p>
      </div>
    </section>
  );
};

export default OevHero;
