import { useRef, type RefObject } from "react";
import { gsap, ScrollTrigger, useGSAP } from "@/lib/gsap";

/* Reduced motion always wins: animation code only runs inside `noPref`
 * contexts, so reduced users never see content hidden or moved. */
export const MM = {
  desktop: "(min-width: 961px) and (prefers-reduced-motion: no-preference)",
  mobile: "(max-width: 960px) and (prefers-reduced-motion: no-preference)",
  noPref: "(prefers-reduced-motion: no-preference)",
  reduced: "(prefers-reduced-motion: reduce)",
} as const;

const EASE = "power3.out";
const REVEAL = { duration: 0.8, start: "top 85%" };

export function useMarketingMotion<T extends HTMLElement>(): RefObject<T | null> {
  const scope = useRef<T>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();

      mm.add({ desktop: MM.desktop, mobile: MM.mobile }, (ctx) => {
        const mobile = Boolean((ctx.conditions as { mobile?: boolean }).mobile);
        const travel = mobile ? 12 : 24;
        const side = mobile ? 16 : 32;

        /* ---- data-rv singles ---- */
        const singles = gsap.utils.toArray<HTMLElement>(root.querySelectorAll("[data-rv]"));
        for (const el of singles) {
          const variant = el.dataset.rv;
          const from: gsap.TweenVars = { opacity: 0, y: travel };
          if (variant === "left") Object.assign(from, { y: 0, x: -side });
          if (variant === "right") Object.assign(from, { y: 0, x: side });
          if (variant === "scale") Object.assign(from, { scale: 0.94 });
          gsap.set(el, from);
        }
        if (singles.length) {
          ScrollTrigger.batch(singles, {
            start: REVEAL.start,
            once: true,
            onEnter: (batch) =>
              gsap.to(batch, {
                opacity: 1,
                x: 0,
                y: 0,
                scale: 1,
                duration: REVEAL.duration,
                ease: EASE,
                stagger: 0.08,
                overwrite: true,
              }),
          });
        }

        /* ---- data-rv-group: stagger direct children ---- */
        for (const group of gsap.utils.toArray<HTMLElement>(
          root.querySelectorAll("[data-rv-group]"),
        )) {
          const kids = Array.from(group.children) as HTMLElement[];
          if (!kids.length) continue;
          gsap.fromTo(
            kids,
            { opacity: 0, y: travel },
            {
              opacity: 1,
              y: 0,
              duration: REVEAL.duration,
              ease: EASE,
              stagger: 0.09,
              scrollTrigger: { trigger: group, start: REVEAL.start, once: true },
            },
          );
        }

        /* ---- data-pop ---- */
        for (const el of gsap.utils.toArray<HTMLElement>(root.querySelectorAll("[data-pop]"))) {
          gsap.fromTo(
            el,
            { scale: 0 },
            {
              scale: 1,
              duration: 0.55,
              ease: "back.out(2)",
              scrollTrigger: { trigger: el, start: "top 88%", once: true },
            },
          );
        }

        /* ---- data-count ---- */
        for (const el of gsap.utils.toArray<HTMLElement>(root.querySelectorAll("[data-count]"))) {
          const target = parseInt(el.dataset.count ?? el.textContent ?? "0", 10);
          if (!Number.isFinite(target)) continue;
          const state = { v: 0 };
          gsap.to(state, {
            v: target,
            duration: 1.4,
            ease: "power2.out",
            snap: { v: 1 },
            onUpdate: () => {
              el.textContent = String(Math.round(state.v));
            },
            scrollTrigger: { trigger: el, start: REVEAL.start, once: true },
          });
        }

        /* ---- data-draw (SVG stroke draw) ---- */
        for (const el of gsap.utils.toArray<HTMLElement>(root.querySelectorAll("[data-draw]"))) {
          const strokes = el.querySelectorAll("path, circle, line, polyline, ellipse");
          if (!strokes.length) continue;
          gsap.fromTo(
            strokes,
            { drawSVG: 0 },
            {
              drawSVG: "0% 100%",
              duration: 1.1,
              ease: "power2.inOut",
              stagger: 0.12,
              scrollTrigger: { trigger: el, start: REVEAL.start, once: true },
            },
          );
        }

        /* ---- desktop-only ambience ---- */
        if (!mobile) {
          for (const el of gsap.utils.toArray<HTMLElement>(root.querySelectorAll("[data-float]"))) {
            gsap.to(el, { y: 9, duration: 2.8, ease: "sine.inOut", yoyo: true, repeat: -1 });
          }
          for (const el of gsap.utils.toArray<HTMLElement>(
            root.querySelectorAll("[data-parallax]"),
          )) {
            gsap.fromTo(
              el,
              { yPercent: 6 },
              {
                yPercent: -6,
                ease: "none",
                scrollTrigger: { trigger: el, start: "top bottom", end: "bottom top", scrub: 0.8 },
              },
            );
          }
        }
      });

      /* ---- hover wiggle: fine pointers, motion-OK only ---- */
      mm.add(`${MM.noPref} and (hover: hover)`, () => {
        const handlers: Array<[HTMLElement, () => void]> = [];
        for (const el of gsap.utils.toArray<HTMLElement>(root.querySelectorAll("[data-wiggle]"))) {
          const target = el.querySelector("svg") ?? el;
          const fn = () => {
            gsap.fromTo(
              target,
              { rotation: -6 },
              { rotation: 0, duration: 0.45, ease: "back.out(3)" },
            );
          };
          el.addEventListener("mouseenter", fn);
          handlers.push([el, fn]);
        }
        return () => handlers.forEach(([el, fn]) => el.removeEventListener("mouseenter", fn));
      });
    },
    { scope },
  );

  return scope;
}

/** PromoBand: checklist slide + tick pops + seal spin-in. */
export function usePromoBandMotion<T extends HTMLElement>(): RefObject<T | null> {
  const scope = useRef<T>(null);

  useGSAP(
    () => {
      const root = scope.current;
      if (!root) return;
      const mm = gsap.matchMedia();
      mm.add(MM.noPref, () => {
        const items = root.querySelectorAll(".p-check li");
        if (items.length) {
          gsap.fromTo(
            items,
            { x: -18, opacity: 0 },
            {
              x: 0,
              opacity: 1,
              duration: 0.55,
              ease: EASE,
              stagger: 0.07,
              scrollTrigger: { trigger: root, start: "top 70%", once: true },
            },
          );
          gsap.fromTo(
            root.querySelectorAll(".p-check .tick"),
            { scale: 0 },
            {
              scale: 1,
              duration: 0.4,
              ease: "back.out(2.5)",
              stagger: 0.07,
              scrollTrigger: { trigger: root, start: "top 70%", once: true },
            },
          );
        }
        const seal = root.querySelector(".seal");
        if (seal) {
          gsap.fromTo(
            seal,
            { rotation: -90, scale: 0 },
            {
              rotation: -12,
              scale: 1,
              duration: 0.7,
              ease: "back.out(1.8)",
              scrollTrigger: { trigger: seal, start: "top 88%", once: true },
            },
          );
        }
      });
    },
    { scope },
  );

  return scope;
}
