# OEV One-Page Redesign (estilo DR) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el sitio público de OEV como one-page con el lenguaje visual DR (tipografía bold, motion GSAP, estampillas/bubbles, botones pill) manteniendo branding OEV y toda la lógica de negocio intacta.

**Architecture:** Sistema visual scoped `.oev` en `src/oev-marketing.css` (cero contacto con tokens shadcn del dashboard) + hook de motion GSAP por data-attributes (`src/lib/marketingMotion.ts`) + 12 componentes de sección nuevos en `src/components/home/`. `Index.tsx` compone todo; `App.tsx` agrega redirects. Componentes de marketing viejos se borran al final.

**Tech Stack:** Vite + React 18 + react-router-dom 6 + Tailwind (solo fuera del scope) + GSAP 3.15 (ScrollTrigger, SplitText, DrawSVG — ya instalado) + vitest/testing-library.

**Spec:** `docs/superpowers/specs/2026-07-15-oev-onepage-redesign-design.md`

## Global Constraints

- **NO tocar:** `index.html` (GA4 `G-8D4SSYMCNP`), `src/pages/BookingConfirmation.tsx`, `src/lib/analytics.ts`, `src/pages/Book.tsx` y todo `src/components/booking/`, `src/components/admin/`, `src/components/staff/`, valores de tokens en `src/index.css` (solo se amplía el import de fuentes), `tailwind.config.ts`.
- Links de booking se preservan exactos: `/book`, `/book?type=hourly`, `/book?type=daily`.
- Precios SIEMPRE desde `usePricing()` / `useBarPackages()` — nunca hardcodear montos (fallbacks viven en los hooks).
- Todo el CSS nuevo va scoped bajo `.oev` en `src/oev-marketing.css`.
- Motion: estados iniciales ocultos SOLO dentro de `gsap.matchMedia` no-pref; `fromTo` siempre; float/parallax/orbits solo desktop.
- Componentes nuevos NO usan `useScrollAnimation` (se borra al final) ni componentes shadcn `Card` (el look nuevo es CSS propio); `Accordion`, `Dialog`, `Carousel` shadcn sí se reusan donde se indica.
- Copy en inglés (sitio público US). Prosa de commits en inglés convencional.
- Cada task termina con `npx vitest run <archivo>` verde y commit.

---

### Task 1: Fuentes Inter 400–900

**Files:**
- Modify: `src/index.css:1`

**Interfaces:**
- Produces: pesos Inter 800/900 disponibles globalmente (los usa todo el CSS de marketing).

- [ ] **Step 1: Ampliar import de Inter**

En `src/index.css` reemplazar la línea 1:

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap");
```

por:

```css
@import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap");
```

No tocar ninguna otra línea del archivo.

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build verde sin warnings nuevos.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(marketing): load Inter 800/900 weights for redesign typography"
```

---

### Task 2: Registro central GSAP (`src/lib/gsap.ts`)

**Files:**
- Create: `src/lib/gsap.ts`
- Test: `src/lib/gsap.test.ts`

**Interfaces:**
- Produces: `export { gsap, ScrollTrigger, SplitText, useGSAP }` y `export function prefersReducedMotion(): boolean`. DrawSVG se registra pero no se re-exporta (se usa vía `drawSVG` tween vars).

- [ ] **Step 1: Test que falla**

`src/lib/gsap.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { gsap, ScrollTrigger, SplitText, prefersReducedMotion } from "./gsap";

describe("lib/gsap", () => {
  it("registers ScrollTrigger and SplitText on the gsap core", () => {
    expect(gsap.core.globals().ScrollTrigger).toBe(ScrollTrigger);
    expect(gsap.core.globals().SplitText).toBe(SplitText);
  });

  it("prefersReducedMotion reflects matchMedia (mocked to false in setup)", () => {
    expect(prefersReducedMotion()).toBe(false);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/gsap.test.ts`
Expected: FAIL — `Cannot find module './gsap'` (o equivalente).

- [ ] **Step 3: Implementación**

`src/lib/gsap.ts`:

```ts
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { useGSAP } from "@gsap/react";

gsap.registerPlugin(ScrollTrigger, SplitText, DrawSVGPlugin, useGSAP);

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export { gsap, ScrollTrigger, SplitText, useGSAP };
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/gsap.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/gsap.ts src/lib/gsap.test.ts
git commit -m "feat(marketing): central gsap registry with ScrollTrigger/SplitText/DrawSVG"
```

---

### Task 3: Sistema de motion (`src/lib/marketingMotion.ts`)

**Files:**
- Create: `src/lib/marketingMotion.ts`
- Test: `src/lib/marketingMotion.test.tsx`

**Interfaces:**
- Consumes: `gsap`, `ScrollTrigger`, `useGSAP` de `@/lib/gsap` (Task 2).
- Produces:
  - `export const MM: { desktop: string; mobile: string; noPref: string; reduced: string }`
  - `export function useMarketingMotion<T extends HTMLElement>(): RefObject<T | null>` — un hook por página; anima descendientes por data-attributes: `data-rv` (fade+rise; variantes `left|right|scale`), `data-rv-group` (stagger de hijos directos), `data-pop` (scale 0→1), `data-count="90"` (roll-up entero), `data-draw` (stroke draw de SVG interno), `data-float` (loop y desktop), `data-parallax` (scrub yPercent desktop), `data-wiggle` (rotación al hover, fine pointer).
  - `export function usePromoBandMotion<T extends HTMLElement>(): RefObject<T | null>` — anima `.p-check li`, `.p-check .tick`, `.seal` dentro del scope.

- [ ] **Step 1: Test que falla**

`src/lib/marketingMotion.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { useMarketingMotion, usePromoBandMotion, MM } from "./marketingMotion";

function Page() {
  const scope = useMarketingMotion<HTMLDivElement>();
  return (
    <div ref={scope}>
      <p data-rv>reveal</p>
      <div data-rv-group>
        <span>a</span>
        <span>b</span>
      </div>
      <span data-count="90">90</span>
    </div>
  );
}

function Band() {
  const scope = usePromoBandMotion<HTMLDivElement>();
  return (
    <div ref={scope}>
      <ul className="p-check">
        <li>
          <span className="tick" /> item
        </li>
      </ul>
      <span className="seal">$0</span>
    </div>
  );
}

describe("marketingMotion", () => {
  it("exposes matchMedia conditions", () => {
    expect(MM.noPref).toContain("prefers-reduced-motion: no-preference");
  });

  it("useMarketingMotion renders without crashing and keeps content visible when no media matches", () => {
    render(<Page />);
    // setup.ts mocks matchMedia matches:false → ningún contexto corre → contenido intacto
    expect(screen.getByText("reveal")).toBeVisible();
    expect(screen.getByText("90")).toBeVisible();
  });

  it("usePromoBandMotion renders without crashing", () => {
    render(<Band />);
    expect(screen.getByText("item")).toBeVisible();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/lib/marketingMotion.test.tsx`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

`src/lib/marketingMotion.ts` (port adaptado de DR `lib/motion.ts` — sin i18n, mismos data-attributes):

```ts
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
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run src/lib/marketingMotion.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/marketingMotion.ts src/lib/marketingMotion.test.tsx
git commit -m "feat(marketing): data-attribute GSAP motion system (port of DR pattern)"
```

---

### Task 4: Base del sistema visual (`src/oev-marketing.css`)

**Files:**
- Create: `src/oev-marketing.css`

**Interfaces:**
- Produces: scope `.oev` con tokens, tipografía, `.wrap`, `.shead`, botones (`.btn`, `.btn-primary`, `.btn-ghost`, `.btn-onblue`, `.btn-lg`), `.band-soft`, `.tick`, `.snap-row`, `scroll-margin-top` para anchors, regla global de reduced motion. Las secciones (Tasks 5–14) appendean sus bloques a ESTE archivo.

- [ ] **Step 1: Crear el archivo con la base**

`src/oev-marketing.css`:

```css
/* =====================================================================
   OEV marketing system — scoped to .oev (one-page only).
   Inspired by the DR minimalist system; OEV official branding.
   NEVER leak styles outside .oev — the admin/staff dashboards must not
   be affected by anything in this file.
   ===================================================================== */

.oev {
  /* --- tokens (OEV branding) --- */
  --accent: hsl(200 98% 39%);      /* OEV primary, exact */
  --accent-ink: hsl(200 98% 30%);  /* hover / pressed */
  --accent-soft: hsl(200 98% 39% / 0.08);
  --ink: #0b0b0b;
  --g900: #1d1d1f;
  --g700: #3f4147;
  --g500: #6b7280;
  --g300: #c9ccd1;
  --g200: #e5e7eb;
  --g100: #eef0f3;
  --g50: #f5f6f8;
  /* event-type accents — ONLY for the hero event-types line + dots */
  --ev-cele: #e85d75;
  --ev-pres: #8b5cf6;
  --ev-prod: #f59e0b;

  --shadow-hover: 0 12px 34px rgba(11, 11, 11, 0.1);
  --radius-card: 26px;
  --radius-band: 30px;

  background: #fff;
  color: var(--g700);
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif;
  font-size: 16px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

/* --- layout --- */
.oev .wrap {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 24px;
}
.oev section {
  padding: 96px 0;
}
.oev section[id] {
  scroll-margin-top: 84px; /* sticky nav offset */
}
.oev .band-soft {
  background: var(--g50);
}

/* --- typography --- */
.oev h1,
.oev h2,
.oev h3 {
  color: var(--g900);
  font-weight: 900;
  letter-spacing: -0.03em;
  line-height: 1.05;
  margin: 0;
}
.oev .shead {
  text-align: center;
  margin-bottom: 44px;
}
.oev .shead h2,
.oev h2.accent {
  color: var(--accent);
  font-size: clamp(30px, 4vw, 52px);
}
.oev .shead .lead,
.oev .lead {
  color: var(--g500);
  font-size: clamp(16px, 1.6vw, 18.5px);
  max-width: 640px;
  margin: 14px auto 0;
}
.oev p {
  margin: 0;
}

/* --- buttons (pill, weight 800) --- */
.oev .btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border-radius: 999px;
  border: 1.5px solid transparent;
  font-weight: 800;
  font-size: 15px;
  letter-spacing: 0.01em;
  padding: 14px 28px;
  cursor: pointer;
  text-decoration: none;
  transition:
    background 0.2s,
    color 0.2s,
    border-color 0.2s,
    transform 0.2s,
    box-shadow 0.2s;
}
.oev .btn:active {
  transform: translateY(1px);
}
.oev .btn-lg {
  padding: 17px 36px;
  font-size: 16.5px;
}
.oev .btn-primary {
  background: var(--accent);
  color: #fff;
}
.oev .btn-primary:hover {
  background: var(--accent-ink);
  transform: translateY(-1px);
  box-shadow: var(--shadow-hover);
}
.oev .btn-ghost {
  background: #fff;
  color: var(--accent);
  border-color: var(--accent);
}
.oev .btn-ghost:hover {
  background: var(--accent);
  color: #fff;
}
.oev .btn-onblue {
  background: #fff;
  color: var(--accent);
}
.oev .btn-onblue:hover {
  background: var(--g50);
  transform: translateY(-1px);
}

/* --- shared bits --- */
.oev .tick {
  display: inline-grid;
  place-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.16);
  border: 1.5px solid rgba(255, 255, 255, 0.45);
  flex: none;
}
.oev .tick::after {
  content: "";
  width: 6px;
  height: 10px;
  border: solid #fff;
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translateY(-1px);
}

/* Mobile card rows: horizontal snap scroll, never stack (DR rule) */
@media (max-width: 960px) {
  .oev .snap-row {
    display: grid !important;
    grid-auto-flow: column;
    grid-auto-columns: 78%;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    padding-bottom: 8px;
  }
  .oev .snap-row::-webkit-scrollbar {
    display: none;
  }
  .oev .snap-row > * {
    scroll-snap-align: start;
  }
  .oev section {
    padding: 72px 0;
  }
  .oev .wrap {
    padding: 0 16px;
  }
}

/* Smooth anchor scroll, motion-safe */
@media (prefers-reduced-motion: no-preference) {
  html:has(.oev) {
    scroll-behavior: smooth;
  }
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: verde (archivo aún sin importar; se importa en Task 15).

- [ ] **Step 3: Commit**

```bash
git add src/oev-marketing.css
git commit -m "feat(marketing): scoped .oev visual system base (tokens, type, buttons, layout)"
```

---

### Task 5: `OevNav` + `MobileBar`

**Files:**
- Create: `src/components/home/OevNav.tsx`
- Create: `src/components/home/MobileBar.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/OevNav.test.tsx`

**Interfaces:**
- Produces: `export default OevNav` (sin props), `export default MobileBar` (sin props). Anchors usados: `#pricing #add-ons #gallery #tour #how-it-works #faq #contact`.

- [ ] **Step 1: Test que falla**

`src/components/home/OevNav.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OevNav from "./OevNav";
import MobileBar from "./MobileBar";

describe("OevNav", () => {
  it("renders anchor links and Book Now", () => {
    render(<OevNav />);
    expect(screen.getByRole("link", { name: "Pricing" })).toHaveAttribute("href", "#pricing");
    expect(screen.getByRole("link", { name: "Gallery" })).toHaveAttribute("href", "#gallery");
    expect(screen.getAllByRole("link", { name: "Book Now" })[0]).toHaveAttribute("href", "/book");
  });
});

describe("MobileBar", () => {
  it("renders sticky Book Now", () => {
    render(<MobileBar />);
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/OevNav.test.tsx`
Expected: FAIL — módulos no existen.

- [ ] **Step 3: Implementar componentes**

`src/components/home/OevNav.tsx`:

```tsx
import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import oevLogoIcon from "@/assets/oev-logo-icon.png";

const NAV_ITEMS = [
  { href: "#pricing", label: "Pricing" },
  { href: "#add-ons", label: "Add-ons" },
  { href: "#gallery", label: "Gallery" },
  { href: "#tour", label: "Tour" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#faq", label: "FAQ" },
  { href: "#contact", label: "Contact" },
];

const OevNav = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav className={`oev-nav${scrolled ? " scrolled" : ""}`}>
      <div className="wrap oev-nav-in">
        <a href="#top" className="brand" aria-label="Orlando Event Venue — top">
          <img src={oevLogoIcon} alt="" />
          <span>Orlando Event Venue</span>
        </a>

        <div className="nav-links" aria-label="Section navigation">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <a className="btn btn-primary btn-nav" href="/book">
            Book Now
          </a>
        </div>

        <button
          className="nav-burger"
          onClick={() => setOpen(!open)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
        >
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {open && (
        <div className="nav-mobile">
          {NAV_ITEMS.map((item) => (
            <a key={item.href} href={item.href} onClick={() => setOpen(false)}>
              {item.label}
            </a>
          ))}
          <a className="btn btn-primary" href="/book" onClick={() => setOpen(false)}>
            Book Now
          </a>
        </div>
      )}
    </nav>
  );
};

export default OevNav;
```

`src/components/home/MobileBar.tsx`:

```tsx
/* Sticky mobile CTA bar (<961px only, hidden via CSS on desktop). */
const MobileBar = () => (
  <div className="mbar">
    <a className="btn btn-primary" href="/book">
      Book Now
    </a>
  </div>
);

export default MobileBar;
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== nav ===================== */
.oev .oev-nav {
  position: sticky;
  top: 0;
  z-index: 50;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--g200);
  transition: box-shadow 0.25s;
}
.oev .oev-nav.scrolled {
  box-shadow: 0 6px 24px rgba(11, 11, 11, 0.07);
}
.oev .oev-nav-in {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 72px;
}
.oev .brand {
  display: flex;
  align-items: center;
  gap: 10px;
  text-decoration: none;
  min-width: 0;
}
.oev .brand img {
  height: 44px;
  width: auto;
  flex: none;
}
.oev .brand span {
  font-weight: 900;
  letter-spacing: -0.02em;
  font-size: 17px;
  color: var(--g900);
  white-space: nowrap;
}
.oev .nav-links {
  display: flex;
  align-items: center;
  gap: 22px;
}
.oev .nav-links > a:not(.btn) {
  font-weight: 700;
  font-size: 14.5px;
  color: var(--g700);
  text-decoration: none;
  transition: color 0.2s;
}
.oev .nav-links > a:not(.btn):hover {
  color: var(--accent);
}
.oev .btn-nav {
  padding: 10px 22px;
  font-size: 14px;
}
.oev .nav-burger {
  display: none;
  background: none;
  border: 0;
  color: var(--g900);
  padding: 8px;
  cursor: pointer;
}
.oev .nav-mobile {
  display: none;
}

@media (max-width: 960px) {
  .oev .nav-links {
    display: none;
  }
  .oev .nav-burger {
    display: block;
  }
  .oev .nav-mobile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 16px 18px;
    border-top: 1px solid var(--g200);
    background: #fff;
  }
  .oev .nav-mobile > a:not(.btn) {
    padding: 12px 8px;
    font-weight: 700;
    font-size: 16px;
    color: var(--g700);
    text-decoration: none;
    border-radius: 10px;
  }
  .oev .nav-mobile > a:not(.btn):active {
    background: var(--g50);
  }
  .oev .nav-mobile .btn {
    margin-top: 10px;
  }
  .oev .brand span {
    font-size: 15px;
  }
  .oev .brand img {
    height: 36px;
  }
}
@media (max-width: 420px) {
  .oev .brand span {
    display: none;
  }
}

/* ===================== mobile sticky bar ===================== */
.oev .mbar {
  display: none;
}
@media (max-width: 960px) {
  .oev .mbar {
    display: block;
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 60;
    background: var(--ink);
    padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  }
  .oev .mbar .btn {
    width: 100%;
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/OevNav.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/home/OevNav.tsx src/components/home/MobileBar.tsx src/components/home/OevNav.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): sticky nav with anchors + mobile Book Now bar"
```

---

### Task 6: `OevHero` (palabra gigante + counters + orbits)

**Files:**
- Create: `src/components/home/OevHero.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/OevHero.test.tsx`

**Interfaces:**
- Consumes: `gsap`, `SplitText`, `useGSAP` de `@/lib/gsap`; `MM` de `@/lib/marketingMotion`.
- Produces: `export default OevHero` (sin props), section `id="top"`. Stats con `data-count` estáticos (90, 10, 24, 0) — los precios async NO llevan counter (deviación consciente del spec: `data-count` se resuelve al montar y los precios llegan async).

- [ ] **Step 1: Test que falla**

`src/components/home/OevHero.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import OevHero from "./OevHero";

describe("OevHero", () => {
  it("renders the giant line, event types and CTAs", () => {
    render(<OevHero />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getByText("Corporate")).toBeInTheDocument();
    expect(screen.getByText("Celebrations")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
    expect(screen.getByRole("link", { name: "Schedule a Tour" })).toHaveAttribute(
      "href",
      "/schedule-tour",
    );
  });

  it("renders the four stat counters", () => {
    render(<OevHero />);
    expect(screen.getByText("Chairs")).toBeInTheDocument();
    expect(screen.getByText("Tables")).toBeInTheDocument();
    expect(screen.getByText("Deposit")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/OevHero.test.tsx`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

`src/components/home/OevHero.tsx`:

```tsx
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
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== hero ===================== */
.oev .hero {
  position: relative;
  padding: 110px 0 84px;
  text-align: center;
  overflow: hidden;
}
.oev .hero h1 {
  display: grid;
  gap: 10px;
  justify-items: center;
}
.oev .hero .pre {
  font-size: clamp(17px, 2vw, 23px);
  font-weight: 800;
  color: var(--g900);
  letter-spacing: -0.01em;
}
.oev .hero .giant {
  font-size: clamp(40px, 6.5vw, 84px);
  font-weight: 900;
  color: var(--accent);
  letter-spacing: -0.04em;
  line-height: 1.02;
  text-wrap: balance;
  max-width: 15ch;
}
.oev .hero .post {
  font-size: clamp(18px, 2.2vw, 27px);
  font-weight: 800;
  color: var(--g700);
}
.oev .evtypes {
  margin-top: 20px;
  font-weight: 800;
  font-size: clamp(14px, 1.6vw, 17px);
  color: var(--g300);
}
.oev .evtypes .ev-corp {
  color: var(--accent);
}
.oev .evtypes .ev-cele {
  color: var(--ev-cele);
}
.oev .evtypes .ev-pres {
  color: var(--ev-pres);
}
.oev .evtypes .ev-prod {
  color: var(--ev-prod);
}
.oev .hero-stats {
  display: flex;
  justify-content: center;
  gap: clamp(26px, 5vw, 64px);
  margin-top: 38px;
}
.oev .stat {
  display: grid;
  justify-items: center;
  gap: 2px;
}
.oev .stat-num {
  font-size: clamp(28px, 3.4vw, 42px);
  font-weight: 900;
  color: var(--accent);
  letter-spacing: -0.03em;
}
.oev .stat-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--g500);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.oev .hero-cta-row {
  display: flex;
  justify-content: center;
  gap: 14px;
  margin-top: 36px;
  flex-wrap: wrap;
}
.oev .hero-note {
  margin-top: 18px;
  font-size: 14px;
  font-weight: 600;
  color: var(--g500);
}
.oev .hero-orbits {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.oev .orbit {
  position: absolute;
}
.oev .orbit-in {
  display: block;
  width: 100%;
  height: 100%;
  color: var(--accent);
  opacity: 0.35;
}
.oev .orbit-in svg {
  width: 100%;
  height: 100%;
}
@media (max-width: 960px) {
  .oev .hero {
    padding: 72px 0 64px;
  }
  .oev .hero-orbits {
    display: none;
  }
  .oev .hero-stats {
    flex-wrap: wrap;
    gap: 22px 34px;
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/OevHero.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/home/OevHero.tsx src/components/home/OevHero.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): hero with SplitText giant line, stat counters and cursor orbits"
```

---

### Task 7: `PromoBand` (checklist + bubble + seal)

**Files:**
- Create: `src/components/home/PromoBand.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/PromoBand.test.tsx`

**Interfaces:**
- Consumes: `usePromoBandMotion` de `@/lib/marketingMotion`; asset `@/assets/gallery-4.png` (foto "Event Space").
- Produces: `export default PromoBand`, section `id="included"`.

- [ ] **Step 1: Test que falla**

`src/components/home/PromoBand.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PromoBand from "./PromoBand";

describe("PromoBand", () => {
  it("renders the included checklist, seal and reviews link", () => {
    render(<PromoBand />);
    expect(screen.getByText("Everything included. One flat price.")).toBeInTheDocument();
    expect(screen.getByText("90 chairs + 10 tables")).toBeInTheDocument();
    expect(screen.getByText("No catering restrictions")).toBeInTheDocument();
    expect(screen.getByText("$0")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /5-star/i })).toHaveAttribute(
      "href",
      "https://g.page/r/CU-yUA0El90UEAE/review",
    );
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/PromoBand.test.tsx`
Expected: FAIL — módulo no existe.

- [ ] **Step 3: Implementación**

`src/components/home/PromoBand.tsx`:

```tsx
import { usePromoBandMotion } from "@/lib/marketingMotion";
import venuePhoto from "@/assets/gallery-4.png";

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
              <img src={venuePhoto} alt="The OEV event space set up for an event" loading="lazy" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default PromoBand;
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== promo band ===================== */
.oev .promo {
  padding-top: 0;
}
.oev .promo-band {
  background: var(--accent);
  border-radius: var(--radius-band);
  padding: clamp(28px, 4vw, 46px);
  display: grid;
  grid-template-columns: 1.15fr 0.85fr;
  gap: 32px;
  color: #fff;
}
.oev .promo-band h2 {
  color: #fff;
  font-size: clamp(26px, 3vw, 40px);
  letter-spacing: -0.03em;
}
.oev .p-eyebrow {
  font-weight: 800;
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  opacity: 0.85;
  margin-bottom: 10px;
}
.oev .p-note {
  margin-top: 10px;
  font-weight: 600;
  opacity: 0.9;
}
.oev .p-check {
  list-style: none;
  margin: 22px 0 0;
  padding: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 18px;
}
.oev .p-check li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-weight: 600;
  font-size: 15px;
}
.oev .promo-cta-row {
  display: flex;
  align-items: center;
  gap: 18px;
  margin-top: 28px;
  flex-wrap: wrap;
}
.oev .promo-reviews {
  color: #fff;
  font-weight: 700;
  font-size: 14.5px;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.oev .promo-right {
  position: relative;
  display: grid;
}
.oev .promo-photo {
  border-radius: 22px;
  overflow: hidden;
  align-self: stretch;
}
.oev .promo-photo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.oev .bubble {
  position: absolute;
  top: -26px;
  right: -8px;
  z-index: 2;
  width: 148px;
  height: 148px;
  border-radius: 50%;
  background: #fff;
  color: var(--accent);
  display: grid;
  place-content: center;
  text-align: center;
  gap: 2px;
  transform: rotate(-9deg);
  box-shadow: 0 10px 30px rgba(11, 11, 11, 0.18);
}
.oev .bubble strong {
  font-size: 19px;
  font-weight: 900;
  letter-spacing: -0.02em;
}
.oev .bubble span {
  font-size: 12.5px;
  font-weight: 600;
}
.oev .seal {
  position: absolute;
  left: -14px;
  bottom: -14px;
  z-index: 2;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  background: #fff;
  color: var(--accent);
  display: grid;
  place-content: center;
  text-align: center;
  font-weight: 900;
  font-size: 26px;
  line-height: 1;
  letter-spacing: -0.02em;
  transform: rotate(-12deg);
  box-shadow: 0 10px 30px rgba(11, 11, 11, 0.18);
}
.oev .seal small {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
@media (max-width: 960px) {
  .oev .promo-band {
    grid-template-columns: 1fr;
  }
  .oev .p-check {
    grid-template-columns: 1fr;
  }
  .oev .bubble {
    top: -20px;
    right: 4px;
    width: 118px;
    height: 118px;
  }
  .oev .bubble strong {
    font-size: 16px;
  }
  .oev .promo-photo {
    min-height: 220px;
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/PromoBand.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/PromoBand.tsx src/components/home/PromoBand.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): promo band with animated checklist, rotated bubble and $0 seal"
```

---

### Task 8: `WhyCards` (eyeglass cards)

**Files:**
- Create: `src/components/home/WhyCards.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/WhyCards.test.tsx`

**Interfaces:**
- Produces: `export default WhyCards`, section `id="why"`. Cards son `<a>` a anchors internos.

- [ ] **Step 1: Test que falla**

`src/components/home/WhyCards.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import WhyCards from "./WhyCards";

describe("WhyCards", () => {
  it("renders three reason cards linking to sections", () => {
    render(<WhyCards />);
    expect(screen.getByText("Flexible")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Simple")).toBeInTheDocument();
    expect(screen.getByText("Flexible").closest("a")).toHaveAttribute("href", "#pricing");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/WhyCards.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`src/components/home/WhyCards.tsx`:

```tsx
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
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== why cards (vcard) ===================== */
.oev .grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
}
.oev .vcard {
  position: relative;
  display: block;
  background: #fff;
  border: 1.5px solid var(--accent);
  border-radius: var(--radius-card);
  padding: 26px 26px 30px;
  text-decoration: none;
  color: inherit;
  transition: transform 0.22s, box-shadow 0.22s;
}
.oev .vcard:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-hover);
}
.oev .vcard .big {
  display: block;
  color: var(--accent);
  font-weight: 900;
  font-size: 26px;
  letter-spacing: -0.03em;
}
.oev .vcard .small {
  display: block;
  color: var(--accent);
  font-weight: 700;
  font-size: 14.5px;
  margin-top: 2px;
}
.oev .vcard p {
  margin-top: 12px;
  color: var(--g500);
  font-size: 15.5px;
}
.oev .vcard .arrow {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 22px;
  height: 22px;
  color: var(--accent);
  transition: transform 0.22s;
}
.oev .vcard:hover .arrow {
  transform: translate(4px, -4px);
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/WhyCards.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/WhyCards.tsx src/components/home/WhyCards.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): three-reasons vcards with corner arrow and hover lift"
```

---

### Task 9: `PricingSection`

**Files:**
- Create: `src/components/home/PricingSection.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/PricingSection.test.tsx`

**Interfaces:**
- Consumes: `usePricing()` de `@/hooks/usePricing` → `{ pricing: { hourly_rate, daily_rate, cleaning_fee }, isLoading }`.
- Produces: `export default PricingSection`, section `id="pricing"`. CTAs exactos: `/book?type=hourly`, `/book?type=daily`, `/book`.

- [ ] **Step 1: Test que falla**

`src/components/home/PricingSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PricingSection from "./PricingSection";

vi.mock("@/hooks/usePricing", () => ({
  usePricing: () => ({
    pricing: { hourly_rate: 140, daily_rate: 899, cleaning_fee: 199 },
    items: [],
    isLoading: false,
    error: null,
  }),
}));

describe("PricingSection", () => {
  it("renders dynamic prices and exact booking links", () => {
    render(<PricingSection />);
    expect(screen.getByText("$140")).toBeInTheDocument();
    expect(screen.getByText("$899")).toBeInTheDocument();
    expect(screen.getByText("$199")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Select Hourly" })).toHaveAttribute(
      "href",
      "/book?type=hourly",
    );
    expect(screen.getByRole("link", { name: "Select Daily" })).toHaveAttribute(
      "href",
      "/book?type=daily",
    );
    expect(screen.getByText("Most Popular")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/PricingSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`src/components/home/PricingSection.tsx`:

```tsx
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
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== pricing ===================== */
.oev .pgrid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 18px;
  max-width: 860px;
  margin: 0 auto;
}
.oev .pcard {
  position: relative;
  background: #fff;
  border: 1.5px solid var(--g200);
  border-radius: var(--radius-card);
  padding: 30px 28px;
  transition: transform 0.22s, box-shadow 0.22s;
}
.oev .pcard:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-hover);
}
.oev .pcard h3 {
  font-size: 20px;
  letter-spacing: -0.02em;
}
.oev .pprice {
  margin-top: 12px;
  font-size: 44px;
  font-weight: 900;
  color: var(--g900);
  letter-spacing: -0.03em;
  line-height: 1;
  display: flex;
  align-items: baseline;
  gap: 4px;
}
.oev .pprice em {
  font-style: normal;
  font-size: 16px;
  font-weight: 600;
  color: var(--g500);
}
.oev .pprice.small {
  font-size: 30px;
}
.oev .pspin {
  width: 30px;
  height: 30px;
  animation: oev-spin 1s linear infinite;
}
@keyframes oev-spin {
  to {
    transform: rotate(360deg);
  }
}
.oev .pcard ul {
  list-style: none;
  margin: 20px 0 24px;
  padding: 0;
  display: grid;
  gap: 10px;
}
.oev .pcard li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14.5px;
  font-weight: 600;
  color: var(--g500);
}
.oev .ptick {
  display: inline-grid;
  place-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--accent-soft);
  flex: none;
}
.oev .ptick::after {
  content: "";
  width: 5px;
  height: 8px;
  border: solid var(--accent);
  border-width: 0 2px 2px 0;
  transform: rotate(45deg) translateY(-1px);
}
.oev .pcard .btn {
  width: 100%;
}
.oev .pcard-daily {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}
.oev .pcard-daily h3,
.oev .pcard-daily .pprice {
  color: #fff;
}
.oev .pcard-daily .pprice em,
.oev .pcard-daily li {
  color: rgba(255, 255, 255, 0.85);
}
.oev .pcard-daily .ptick {
  background: rgba(255, 255, 255, 0.16);
}
.oev .pcard-daily .ptick::after {
  border-color: #fff;
}
.oev .pop-badge {
  position: absolute;
  top: -14px;
  left: 50%;
  transform: translateX(-50%);
  background: #fff;
  color: var(--accent);
  border: 1.5px solid var(--accent);
  border-radius: 999px;
  font-size: 12.5px;
  font-weight: 800;
  padding: 5px 14px;
  white-space: nowrap;
}
.oev .fee-line {
  max-width: 860px;
  margin: 18px auto 0;
  background: #fff;
  border: 1.5px solid var(--g200);
  border-radius: 18px;
  padding: 18px 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}
.oev .fee-line strong {
  display: block;
  color: var(--g900);
  font-weight: 800;
}
.oev .fee-line span {
  font-size: 13.5px;
  color: var(--g500);
}
.oev .pricing-note {
  text-align: center;
  font-size: 13.5px;
  color: var(--g500);
  margin-top: 22px;
}
.oev .pricing-cta {
  text-align: center;
  margin-top: 22px;
}
@media (max-width: 960px) {
  .oev .pgrid.snap-row {
    grid-auto-columns: 84%;
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/PricingSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/PricingSection.tsx src/components/home/PricingSection.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): pricing section with dynamic rates and exact /book links"
```

---

### Task 10: `AddonsSection` (Production + Bar + Extras como tiles)

**Files:**
- Create: `src/components/home/AddonsSection.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/AddonsSection.test.tsx`

**Interfaces:**
- Consumes: `usePricing()` (labels vía `items` + `package_basic|package_led|package_workshop|setup_breakdown|tablecloth_rental|tablecloth_cleaning_fee`), `useBarPackages()` → `{ packages: BarPackage[] }` (`{ key, label, ratePerGuest, badge? }`).
- Produces: `export default AddonsSection`, section `id="add-ons"`.

- [ ] **Step 1: Test que falla**

`src/components/home/AddonsSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import AddonsSection from "./AddonsSection";

vi.mock("@/hooks/usePricing", () => ({
  usePricing: () => ({
    pricing: {
      package_basic: 79,
      package_led: 99,
      package_workshop: 149,
      setup_breakdown: 100,
      tablecloth_rental: 5,
      tablecloth_cleaning_fee: 25,
    },
    items: [],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("@/hooks/useBarPackages", () => ({
  useBarPackages: () => ({
    packages: [
      { key: "house_beer_wine", label: "House Beer & Wine", ratePerGuest: 18, sortOrder: 1 },
      {
        key: "signature_bar",
        label: "Signature Bar",
        ratePerGuest: 32.13,
        sortOrder: 3,
        badge: "Most Popular",
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

describe("AddonsSection", () => {
  it("renders production packages with hourly prices", () => {
    render(<AddonsSection />);
    expect(screen.getByText("Basic A/V Package")).toBeInTheDocument();
    expect(screen.getByText("$79/hr")).toBeInTheDocument();
    expect(screen.getByText("$149/hr")).toBeInTheDocument();
  });

  it("renders bar packages per guest and extras", () => {
    render(<AddonsSection />);
    expect(screen.getByText("House Beer & Wine")).toBeInTheDocument();
    expect(screen.getByText("$18/guest")).toBeInTheDocument();
    expect(screen.getByText("$32.13/guest")).toBeInTheDocument();
    expect(screen.getByText("Setup & breakdown")).toBeInTheDocument();
    expect(screen.getByText("$5/ea + $25 cleaning")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add to My Booking" })).toHaveAttribute(
      "href",
      "/book",
    );
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/AddonsSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`src/components/home/AddonsSection.tsx`:

```tsx
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
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== add-ons ===================== */
.oev .addon-h {
  font-size: 20px;
  letter-spacing: -0.02em;
  margin: 42px 0 18px;
}
.oev .addon-h em {
  font-style: normal;
  font-weight: 600;
  font-size: 14px;
  color: var(--g500);
  margin-left: 10px;
}
.oev .atile-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
}
.oev .atile-grid.bar {
  grid-template-columns: repeat(4, 1fr);
}
.oev .atile {
  position: relative;
  background: #fff;
  border: 1.5px solid var(--g200);
  border-radius: 20px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: transform 0.22s, box-shadow 0.22s, border-color 0.22s;
}
.oev .atile:hover {
  transform: translateY(-3px);
  border-color: var(--accent);
  box-shadow: var(--shadow-hover);
}
.oev .atile > svg {
  width: 34px;
  height: 34px;
  color: var(--accent);
}
.oev .atile .lbl {
  font-weight: 800;
  font-size: 15.5px;
  color: var(--g900);
  letter-spacing: -0.01em;
}
.oev .aprice {
  font-weight: 900;
  font-size: 20px;
  color: var(--accent);
  letter-spacing: -0.02em;
}
.oev .atile ul {
  list-style: none;
  margin: 4px 0 0;
  padding: 0;
  display: grid;
  gap: 5px;
}
.oev .atile li {
  font-size: 13px;
  color: var(--g500);
  padding-left: 14px;
  position: relative;
}
.oev .atile li::before {
  content: "✓";
  position: absolute;
  left: 0;
  color: var(--accent);
  font-weight: 700;
}
.oev .atile .pop-badge {
  top: -12px;
}
.oev .addon-note {
  font-size: 13px;
  color: var(--g500);
  margin-top: 14px;
}
.oev .extras {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  max-width: 760px;
}
.oev .extra-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--g50);
  border-radius: 14px;
  padding: 16px 20px;
  font-size: 14.5px;
  font-weight: 600;
  color: var(--g700);
}
.oev .extra-row strong {
  color: var(--accent);
  font-weight: 900;
  white-space: nowrap;
}
@media (max-width: 960px) {
  .oev .atile-grid.bar.snap-row {
    grid-auto-columns: 56%;
  }
  .oev .extras {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/AddonsSection.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/home/AddonsSection.tsx src/components/home/AddonsSection.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): add-ons as animated line-icon tiles (production, bar, extras)"
```

---

### Task 11: `GalleryTours` (carousel + hcard con bubble)

**Files:**
- Create: `src/components/home/GalleryTours.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/GalleryTours.test.tsx`

**Interfaces:**
- Consumes: shadcn `Carousel/CarouselContent/CarouselItem/CarouselPrevious/CarouselNext` + `embla-carousel-autoplay`, shadcn `Dialog/DialogContent` (lightbox), `react-router-dom` `Link`, assets `@/assets/gallery-{1..9}.png`, `@/assets/gallery-conferences.jpg`, `@/assets/gallery-events.jpg`, `@/assets/schedule-tour-bg.jpg`.
- Produces: `export default GalleryTours`, sections `id="gallery"` y `id="tour"`.

- [ ] **Step 1: Test que falla**

`src/components/home/GalleryTours.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import GalleryTours from "./GalleryTours";

describe("GalleryTours", () => {
  it("renders gallery heading, 3D tour and schedule tour links", () => {
    render(
      <MemoryRouter>
        <GalleryTours />
      </MemoryRouter>,
    );
    expect(screen.getByText("Take a look around.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /3D Virtual Tour/i })).toHaveAttribute(
      "href",
      "/tour",
    );
    expect(screen.getByRole("link", { name: /Schedule a Tour/i })).toHaveAttribute(
      "href",
      "/schedule-tour",
    );
    expect(screen.getAllByRole("img").length).toBeGreaterThanOrEqual(11);
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/GalleryTours.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`src/components/home/GalleryTours.tsx`:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { Rotate3d } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import Autoplay from "embla-carousel-autoplay";
import gallery1 from "@/assets/gallery-1.png";
import gallery2 from "@/assets/gallery-2.png";
import gallery3 from "@/assets/gallery-3.png";
import gallery4 from "@/assets/gallery-4.png";
import gallery5 from "@/assets/gallery-5.png";
import gallery6 from "@/assets/gallery-6.png";
import gallery7 from "@/assets/gallery-7.png";
import gallery8 from "@/assets/gallery-8.png";
import gallery9 from "@/assets/gallery-9.png";
import galleryConferences from "@/assets/gallery-conferences.jpg";
import galleryEvents from "@/assets/gallery-events.jpg";
import tourPhoto from "@/assets/schedule-tour-bg.jpg";

const IMAGES = [
  { url: gallery1, title: "Welcome Area" },
  { url: gallery2, title: "Main Entrance" },
  { url: gallery3, title: "Presentation Setup" },
  { url: gallery4, title: "Event Space" },
  { url: gallery5, title: "Storage Area" },
  { url: gallery6, title: "Restroom Facilities" },
  { url: gallery7, title: "Event Setup" },
  { url: gallery8, title: "Venue Exterior" },
  { url: gallery9, title: "Prep Kitchen" },
  { url: galleryConferences, title: "Conference" },
  { url: galleryEvents, title: "Events" },
];

const GalleryTours = () => {
  const [selected, setSelected] = useState<{ url: string; title: string } | null>(null);

  return (
    <>
      <section className="band-soft" id="gallery">
        <div className="wrap">
          <div className="shead">
            <h2 data-rv>Take a look around.</h2>
            <p className="lead" data-rv>
              A modern, flexible space that adapts to your event.
            </p>
          </div>

          <div data-rv>
            <Carousel
              opts={{ align: "start", loop: true }}
              plugins={[Autoplay({ delay: 4000 })]}
              className="gal"
            >
              <CarouselContent>
                {IMAGES.map((image) => (
                  <CarouselItem key={image.title} className="gal-item">
                    <button
                      type="button"
                      className="gcard"
                      onClick={() => setSelected(image)}
                      aria-label={`Open ${image.title}`}
                    >
                      <img src={image.url} alt={image.title} loading="lazy" />
                      <span className="gcap">{image.title}</span>
                    </button>
                  </CarouselItem>
                ))}
              </CarouselContent>
              <CarouselPrevious className="gal-arrow gal-prev" />
              <CarouselNext className="gal-arrow gal-next" />
            </Carousel>
          </div>
        </div>
      </section>

      <section id="tour" style={{ paddingTop: 40 }}>
        <div className="wrap">
          <div className="hcard" data-rv>
            <div className="h-bubble" aria-hidden data-float>
              See it
              <br />
              in person
            </div>
            <div className="h-img" data-parallax>
              <img src={tourPhoto} alt="The venue ready for a walkthrough tour" loading="lazy" />
            </div>
            <div className="h-copy">
              <h2>Walk the space before you book.</h2>
              <p>
                Explore the venue in 3D right now, or schedule a free in-person tour and see how we
                can bring your event to life.
              </p>
              <div className="h-cta-row">
                <Link to="/schedule-tour" className="btn btn-primary">
                  Schedule a Tour
                </Link>
                <Link to="/tour" className="btn btn-ghost">
                  <Rotate3d size={18} aria-hidden /> 3D Virtual Tour
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Dialog open={!!selected} onOpenChange={() => setSelected(null)}>
        <DialogContent className="max-w-7xl w-[95vw] h-[90vh] p-0 overflow-hidden">
          {selected && (
            <div className="lightbox">
              <img src={selected.url} alt={selected.title} />
              <p>{selected.title}</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default GalleryTours;
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== gallery ===================== */
.oev .gal {
  position: relative;
}
.oev .gal-item {
  flex-basis: 33.333%;
}
.oev .gcard {
  display: block;
  width: 100%;
  position: relative;
  border: 1.5px solid var(--g200);
  border-radius: 22px;
  overflow: hidden;
  padding: 0;
  background: none;
  cursor: pointer;
  transition: transform 0.25s, box-shadow 0.25s;
}
.oev .gcard:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-hover);
}
.oev .gcard img {
  display: block;
  width: 100%;
  height: 340px;
  object-fit: cover;
  transition: transform 0.6s;
}
.oev .gcard:hover img {
  transform: scale(1.05);
}
.oev .gcap {
  position: absolute;
  left: 14px;
  bottom: 12px;
  background: rgba(11, 11, 11, 0.72);
  color: #fff;
  font-size: 13px;
  font-weight: 700;
  border-radius: 999px;
  padding: 6px 14px;
}
.oev .gal-arrow {
  border: 1.5px solid var(--g200);
  background: #fff;
}
.oev .lightbox {
  width: 100%;
  height: 100%;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.97);
  position: relative;
}
.oev .lightbox img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}
.oev .lightbox p {
  position: absolute;
  bottom: 18px;
  left: 0;
  right: 0;
  text-align: center;
  font-weight: 800;
  color: var(--g900);
}
@media (max-width: 960px) {
  .oev .gal-item {
    flex-basis: 78%;
  }
  .oev .gcard img {
    height: 300px;
  }
}

/* ===================== tours hcard ===================== */
.oev .hcard {
  position: relative;
  border: 1.5px solid var(--g300);
  border-radius: var(--radius-band);
  padding: clamp(26px, 4vw, 44px);
  display: grid;
  grid-template-columns: 0.9fr 1.1fr;
  gap: 34px;
  align-items: center;
}
.oev .h-bubble {
  position: absolute;
  top: -34px;
  left: 44px;
  z-index: 2;
  width: 118px;
  height: 118px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-content: center;
  text-align: center;
  font-weight: 800;
  font-size: 15px;
  line-height: 1.25;
  transform: rotate(8deg);
  box-shadow: 0 10px 30px rgba(11, 11, 11, 0.16);
}
.oev .h-img {
  border-radius: 22px;
  overflow: hidden;
}
.oev .h-img img {
  display: block;
  width: 100%;
  height: 320px;
  object-fit: cover;
}
.oev .h-copy h2 {
  color: var(--accent);
  font-size: clamp(26px, 3vw, 38px);
}
.oev .h-copy p {
  margin-top: 14px;
  color: var(--g500);
  font-size: 16px;
}
.oev .h-cta-row {
  display: flex;
  gap: 12px;
  margin-top: 24px;
  flex-wrap: wrap;
}
@media (max-width: 960px) {
  .oev .hcard {
    grid-template-columns: 1fr;
  }
  .oev .h-img img {
    height: 220px;
  }
  .oev .h-bubble {
    top: -26px;
    left: 18px;
    width: 96px;
    height: 96px;
    font-size: 13px;
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/GalleryTours.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/GalleryTours.tsx src/components/home/GalleryTours.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): gallery carousel + tours hcard with rotated bubble and parallax"
```

---

### Task 12: `HowItWorksSection` (steps con pop)

**Files:**
- Create: `src/components/home/HowItWorksSection.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/HowItWorksSection.test.tsx`

**Interfaces:**
- Produces: `export default HowItWorksSection`, section `id="how-it-works"`.

- [ ] **Step 1: Test que falla**

`src/components/home/HowItWorksSection.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import HowItWorksSection from "./HowItWorksSection";

describe("HowItWorksSection", () => {
  it("renders the four numbered steps", () => {
    render(<HowItWorksSection />);
    expect(screen.getByText("Enter Event Date")).toBeInTheDocument();
    expect(screen.getByText("Payment & Agreement")).toBeInTheDocument();
    expect(screen.getByText("Confirm with Payment")).toBeInTheDocument();
    expect(screen.getByText("Show Up & Enjoy")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/HowItWorksSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`src/components/home/HowItWorksSection.tsx`:

```tsx
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
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== how it works ===================== */
.oev .steps {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 18px;
}
.oev .step {
  background: #fff;
  border: 1.5px solid var(--g200);
  border-radius: 20px;
  padding: 24px 20px;
}
.oev .step .num {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: grid;
  place-content: center;
  font-weight: 900;
  font-size: 19px;
  margin-bottom: 14px;
}
.oev .step h3 {
  font-size: 16.5px;
  letter-spacing: -0.01em;
}
.oev .step p {
  margin-top: 8px;
  font-size: 14px;
  color: var(--g500);
}
@media (max-width: 960px) {
  .oev .steps.snap-row {
    grid-auto-columns: 64%;
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/HowItWorksSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/HowItWorksSection.tsx src/components/home/HowItWorksSection.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): four-step how-it-works with popping numbered circles"
```

---

### Task 13: `FaqSection`

**Files:**
- Create: `src/components/home/FaqSection.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/FaqSection.test.tsx`

**Interfaces:**
- Consumes: shadcn `Accordion/AccordionItem/AccordionTrigger/AccordionContent`; `usePricing()` (montos en respuestas).
- Produces: `export default FaqSection`, section `id="faq"`.

- [ ] **Step 1: Test que falla**

`src/components/home/FaqSection.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FaqSection from "./FaqSection";

vi.mock("@/hooks/usePricing", () => ({
  usePricing: () => ({
    pricing: { setup_breakdown: 100, tablecloth_rental: 5, tablecloth_cleaning_fee: 25 },
    items: [],
    isLoading: false,
    error: null,
  }),
}));

describe("FaqSection", () => {
  it("renders the five questions", () => {
    render(<FaqSection />);
    expect(screen.getByText("Can we have alcohol at our event?")).toBeInTheDocument();
    expect(screen.getByText("Can I bring my own caterer?")).toBeInTheDocument();
    expect(screen.getByText("Is setup and teardown included?")).toBeInTheDocument();
    expect(screen.getByText("Are tablecloths available?")).toBeInTheDocument();
    expect(screen.getByText("What about parking and load-in?")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/FaqSection.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`src/components/home/FaqSection.tsx` (contenido 1:1 del FAQ actual, solo shell nuevo):

```tsx
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { usePricing } from "@/hooks/usePricing";

const FaqSection = () => {
  const { pricing: p } = usePricing();
  const faqs = [
    {
      question: "Can we have alcohol at our event?",
      answer:
        "Yes — bar service is available as a paid add-on for all private events. We coordinate the vendor; you select your package and pay online when you book. Packages start at $18/guest. No outside alcohol or outside bartenders are permitted.",
    },
    {
      question: "Can I bring my own caterer?",
      answer: "Yes! Any licensed caterer is welcome. We have a prep kitchen available for your use.",
    },
    {
      question: "Is setup and teardown included?",
      answer: `Basic setup and teardown is your responsibility. However, we offer an optional $${p.setup_breakdown} flat rate service if you'd like assistance.`,
    },
    {
      question: "Are tablecloths available?",
      answer: `Yes, tablecloths are available for $${p.tablecloth_rental} each, plus a $${p.tablecloth_cleaning_fee} cleaning fee.`,
    },
    {
      question: "What about parking and load-in?",
      answer:
        "Free parking is available on-site with convenient load-in access for your equipment and supplies.",
    },
  ];

  return (
    <section id="faq">
      <div className="wrap faq-wrap">
        <div className="shead">
          <h2 data-rv>Everything hosts ask us, answered.</h2>
        </div>
        <div data-rv>
          <Accordion type="single" collapsible className="faq-acc">
            {faqs.map((faq, index) => (
              <AccordionItem key={index} value={`item-${index}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default FaqSection;
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== faq ===================== */
.oev .faq-wrap {
  max-width: 780px;
}
.oev .faq-acc [data-state] {
  border-color: var(--g200);
}
.oev .faq-acc button {
  font-weight: 700;
  font-size: 16px;
  color: var(--g900);
}
.oev .faq-acc button:hover {
  color: var(--accent);
  text-decoration: none;
}
.oev .faq-acc [role="region"] {
  color: var(--g500);
  font-size: 15px;
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/FaqSection.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/home/FaqSection.tsx src/components/home/FaqSection.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): FAQ accordion restyled inside .oev scope"
```

---

### Task 14: `FinalBand` + `OevFooter`

**Files:**
- Create: `src/components/home/FinalBand.tsx`
- Create: `src/components/home/OevFooter.tsx`
- Modify: `src/oev-marketing.css` (append)
- Test: `src/components/home/FinalBand.test.tsx`

**Interfaces:**
- Consumes: `react-router-dom` `Link` (legal), asset `@/assets/oev-logo-full.png`.
- Produces: `export default FinalBand`, `export default OevFooter`.

- [ ] **Step 1: Test que falla**

`src/components/home/FinalBand.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FinalBand from "./FinalBand";
import OevFooter from "./OevFooter";

describe("FinalBand", () => {
  it("renders CTA to /book", () => {
    render(<FinalBand />);
    expect(screen.getByText("Ready to host an effortless event?")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book Now" })).toHaveAttribute("href", "/book");
  });
});

describe("OevFooter", () => {
  it("renders address, phone and legal links", () => {
    render(
      <MemoryRouter>
        <OevFooter />
      </MemoryRouter>,
    );
    expect(screen.getByText(/3847 E Colonial Dr/)).toBeInTheDocument();
    expect(screen.getByText("407-974-5979")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy-policy",
    );
    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute(
      "href",
      "/terms-of-use",
    );
  });
});
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run src/components/home/FinalBand.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implementación**

`src/components/home/FinalBand.tsx`:

```tsx
const FinalBand = () => (
  <section className="final">
    <div className="wrap">
      <div className="final-band" data-rv>
        <h2>Ready to host an effortless event?</h2>
        <p>Transparent pricing, production add-ons, and a beautiful space designed for results.</p>
        <a className="btn btn-onblue btn-lg" href="/book">
          Book Now
        </a>
      </div>
    </div>
  </section>
);

export default FinalBand;
```

`src/components/home/OevFooter.tsx`:

```tsx
import { MapPin, Phone } from "lucide-react";
import { Link } from "react-router-dom";
import oevLogoFull from "@/assets/oev-logo-full.png";

const OevFooter = () => (
  <footer className="oev-footer">
    <div className="wrap">
      <div className="f-grid">
        <div>
          <img src={oevLogoFull} alt="Orlando Event Venue" />
          <p>Modern venue for corporate events, celebrations, and presentations.</p>
        </div>
        <div>
          <h3>Location</h3>
          <p className="f-line">
            <MapPin size={16} aria-hidden />
            <span>
              3847 E Colonial Dr
              <br />
              Orlando, FL 32803
            </span>
          </p>
        </div>
        <div>
          <h3>Contact</h3>
          <p className="f-line">
            <Phone size={16} aria-hidden />
            <span>407-974-5979</span>
          </p>
          <p className="f-note">
            <strong>Bar Service</strong>
            <br />
            Available as a paid add-on. No outside alcohol or outside bartenders permitted.
          </p>
        </div>
      </div>
      <div className="f-legal">
        <p>
          <Link to="/privacy-policy">Privacy Policy</Link>
          <span> | </span>
          <Link to="/terms-of-use">Terms of Use</Link>
        </p>
        <p>Copyright © 2026 Orlando Event Venue. All rights reserved.</p>
      </div>
    </div>
  </footer>
);

export default OevFooter;
```

- [ ] **Step 4: Append CSS**

Al final de `src/oev-marketing.css`:

```css
/* ===================== final band ===================== */
.oev .final {
  padding-bottom: 40px;
}
.oev .final-band {
  background: var(--accent);
  border-radius: var(--radius-band);
  padding: clamp(36px, 5vw, 60px);
  text-align: center;
  color: #fff;
}
.oev .final-band h2 {
  color: #fff;
  font-size: clamp(28px, 3.6vw, 46px);
  letter-spacing: -0.03em;
}
.oev .final-band p {
  margin: 14px auto 26px;
  max-width: 560px;
  opacity: 0.92;
  font-size: 16.5px;
}

/* ===================== footer ===================== */
.oev .oev-footer {
  background: var(--ink);
  color: #fff;
  padding: 64px 0 40px;
  margin-bottom: 0;
}
.oev .oev-footer .f-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
}
.oev .oev-footer img {
  height: 72px;
  width: auto;
  margin-bottom: 14px;
}
.oev .oev-footer h3 {
  color: #fff;
  font-size: 15px;
  font-weight: 800;
  margin-bottom: 12px;
}
.oev .oev-footer p {
  font-size: 14px;
  opacity: 0.9;
}
.oev .f-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}
.oev .f-line svg {
  flex: none;
  margin-top: 3px;
}
.oev .f-note {
  margin-top: 14px;
}
.oev .f-legal {
  border-top: 1px solid rgba(255, 255, 255, 0.2);
  margin-top: 40px;
  padding-top: 26px;
  text-align: center;
  font-size: 13.5px;
  opacity: 0.8;
  display: grid;
  gap: 8px;
}
.oev .f-legal a {
  color: #fff;
  text-decoration: none;
}
.oev .f-legal a:hover {
  text-decoration: underline;
}
@media (max-width: 960px) {
  .oev .oev-footer .f-grid {
    grid-template-columns: 1fr;
  }
  .oev .oev-footer {
    padding-bottom: 96px; /* clear the fixed .mbar */
  }
}
```

- [ ] **Step 5: Verificar que pasa**

Run: `npx vitest run src/components/home/FinalBand.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add src/components/home/FinalBand.tsx src/components/home/OevFooter.tsx src/components/home/FinalBand.test.tsx src/oev-marketing.css
git commit -m "feat(marketing): final CTA band and restyled black footer"
```

---

### Task 15: Swap de `Index.tsx` (composición one-page)

**Files:**
- Modify: `src/pages/Index.tsx` (reescritura completa)

**Interfaces:**
- Consumes: TODOS los componentes de `@/components/home/` (Tasks 5–14), `useMarketingMotion` (Task 3), `ContactForm` y `DiscountPopup` existentes, `src/oev-marketing.css` (Task 4).
- Produces: one-page `.oev` completo en `/`.

- [ ] **Step 1: Reescribir Index**

`src/pages/Index.tsx` (contenido completo):

```tsx
import { useEffect } from "react";
import "@/oev-marketing.css";
import { useMarketingMotion } from "@/lib/marketingMotion";
import OevNav from "@/components/home/OevNav";
import OevHero from "@/components/home/OevHero";
import PromoBand from "@/components/home/PromoBand";
import WhyCards from "@/components/home/WhyCards";
import PricingSection from "@/components/home/PricingSection";
import AddonsSection from "@/components/home/AddonsSection";
import GalleryTours from "@/components/home/GalleryTours";
import HowItWorksSection from "@/components/home/HowItWorksSection";
import FaqSection from "@/components/home/FaqSection";
import FinalBand from "@/components/home/FinalBand";
import OevFooter from "@/components/home/OevFooter";
import MobileBar from "@/components/home/MobileBar";
import ContactForm from "@/components/ContactForm";
import DiscountPopup from "@/components/DiscountPopup";

const Index = () => {
  const scope = useMarketingMotion<HTMLDivElement>();

  /* Deep links from redirects (/#pricing etc.): scroll once layout settles. */
  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    const t = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth" });
    }, 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="oev" ref={scope}>
      <DiscountPopup />
      <OevNav />
      <OevHero />
      <PromoBand />
      <WhyCards />
      <PricingSection />
      <AddonsSection />
      <GalleryTours />
      <HowItWorksSection />
      <FaqSection />
      <FinalBand />
      <ContactForm />
      <OevFooter />
      <MobileBar />
    </div>
  );
};

export default Index;
```

- [ ] **Step 2: Build + suite completa**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: todo verde. Si `ContactForm` desentona visualmente dentro del scope, agregar overrides mínimos al final de `oev-marketing.css` bajo `.oev #contact` (solo tipografía de h2 — no tocar el componente).

- [ ] **Step 3: Humo visual en dev**

Run: `npm run dev` y abrir `http://localhost:5173/` (o puerto que indique Vite).
Expected: one-page completo renderiza; consola sin errores; anchors del nav scrollean.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Index.tsx src/oev-marketing.css
git commit -m "feat(marketing): compose redesigned one-page in Index"
```

---

### Task 16: Redirects en `App.tsx` + borrar componentes viejos

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/pages/PricingPage.tsx`, `src/pages/GalleryPage.tsx`, `src/pages/Contact.tsx`, `src/components/Hero.tsx`, `src/components/SpaceHighlights.tsx`, `src/components/Pricing.tsx`, `src/components/AddOns.tsx`, `src/components/Production.tsx`, `src/components/BarService.tsx`, `src/components/HowItWorks.tsx`, `src/components/FAQ.tsx`, `src/components/FinalCTA.tsx`, `src/components/ScheduleTourCTA.tsx`, `src/components/Gallery.tsx`, `src/components/Navigation.tsx`, `src/components/Footer.tsx`, `src/components/NavLink.tsx`, `src/hooks/useScrollAnimation.tsx`

**Interfaces:**
- Consumes: `Navigate` de react-router-dom.
- Produces: `/pricing → /#pricing`, `/gallery → /#gallery`, `/contact → /#contact`.

- [ ] **Step 1: Verificar consumidores antes de borrar**

Run:
```bash
grep -rn "components/Hero\|components/SpaceHighlights\|components/Pricing\"\|components/AddOns\|components/Production\|components/BarService\|components/HowItWorks\|components/FAQ\|components/FinalCTA\|components/ScheduleTourCTA\|components/Gallery\"\|components/Navigation\|components/Footer\|components/NavLink\|useScrollAnimation\|pages/PricingPage\|pages/GalleryPage\|pages/Contact\"" src --include="*.tsx" --include="*.ts" | grep -v "components/home/" | grep -v test
```
Expected: matches SOLO en `src/App.tsx` y en los propios archivos a borrar (imports entre ellos, p.ej. `ScheduleTour.tsx` puede importar `Navigation`/`Footer` — si `src/pages/ScheduleTour.tsx`, `src/pages/Book.tsx` u otra página viva importa `Navigation`/`Footer`, NO borrar esos dos; dejarlos y anotar en el commit. El resto se borra igual).

- [ ] **Step 2: Actualizar App.tsx**

En `src/App.tsx`:

1. Quitar imports: `Contact`, `PricingPage`, `GalleryPage`.
2. Agregar `Navigate` al import de react-router-dom:

```tsx
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
```

3. Reemplazar las tres rutas:

```tsx
<Route path="/contact" element={<Contact />} />
```
por
```tsx
<Route path="/contact" element={<Navigate to={{ pathname: "/", hash: "#contact" }} replace />} />
```

```tsx
<Route path="/pricing" element={<PricingPage />} />
```
por
```tsx
<Route path="/pricing" element={<Navigate to={{ pathname: "/", hash: "#pricing" }} replace />} />
```

```tsx
<Route path="/gallery" element={<GalleryPage />} />
```
por
```tsx
<Route path="/gallery" element={<Navigate to={{ pathname: "/", hash: "#gallery" }} replace />} />
```

No tocar ninguna otra ruta.

- [ ] **Step 3: Borrar archivos muertos**

```bash
git rm src/pages/PricingPage.tsx src/pages/GalleryPage.tsx src/pages/Contact.tsx \
  src/components/Hero.tsx src/components/SpaceHighlights.tsx src/components/Pricing.tsx \
  src/components/AddOns.tsx src/components/Production.tsx src/components/BarService.tsx \
  src/components/HowItWorks.tsx src/components/FAQ.tsx src/components/FinalCTA.tsx \
  src/components/ScheduleTourCTA.tsx src/components/Gallery.tsx src/components/NavLink.tsx \
  src/hooks/useScrollAnimation.tsx
```

`Navigation.tsx` y `Footer.tsx`: borrar SOLO si el grep del Step 1 confirmó que ninguna página viva (ScheduleTour, Book, legal pages, etc.) los importa; si alguna los usa, dejarlos.

- [ ] **Step 4: Build + suite completa**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: verde, cero imports rotos.

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(marketing): redirect legacy marketing routes to one-page anchors, drop dead components"
```

---

### Task 17: Gates finales de verificación

**Files:**
- Ninguno nuevo (correcciones menores si un gate falla).

- [ ] **Step 1: Gate de intocables**

Run:
```bash
git diff main --stat -- index.html src/pages/BookingConfirmation.tsx src/lib/analytics.ts tailwind.config.ts src/pages/Book.tsx src/components/booking src/components/admin src/components/staff
```
Expected: SALIDA VACÍA (cero cambios en esos paths). `src/index.css` diff = solo la línea del import de fuentes:
```bash
git diff main -- src/index.css
```
Expected: un solo hunk con el cambio de `@import` de Inter.

- [ ] **Step 2: Suite + build**

Run: `npx tsc --noEmit && npm run build && npm test`
Expected: verde.

- [ ] **Step 3: Playwright — flujo completo**

Con dev server corriendo, usar Playwright MCP:
1. Navegar a `/` en 1440×900 → screenshot de cada sección (hero, promo, why, pricing, add-ons, gallery, tour, steps, faq, final, contact, footer).
2. Click en cada link del nav → verificar que scrollea a la sección correcta (id visible bajo el sticky nav).
3. Navegar a `/pricing`, `/gallery`, `/contact` → verificar redirect a `/#...` y scroll.
4. Navegar a `/book`, `/schedule-tour`, `/tour` → cargan igual que antes (sin regresión).
5. Resize a 390×844 → screenshot: `.mbar` visible, orbits ausentes, filas snap-scroll horizontales.
6. Emular `prefers-reduced-motion: reduce` → recargar `/` → todo el contenido visible sin animación.
7. Revisar consola: cero errores.

Expected: todo OK; si algo falla, corregir y re-verificar.

- [ ] **Step 4: Lighthouse (registro, no bloqueante)**

Run (con preview server):
```bash
npm run build && npm run preview
```
Abrir Lighthouse en `/` (performance + accessibility) y anotar scores en el PR/commit final.

- [ ] **Step 5: Commit final (si hubo fixes)**

```bash
git add -A
git commit -m "fix(marketing): final verification pass fixes"
```

---

## Self-Review (ejecutada al escribir el plan)

- **Spec coverage:** rutas ✔ (T16), 13 secciones ✔ (T5–T15; ContactSection se resolvió montando `ContactForm` existente directo en Index — menos código, lógica intacta), sistema visual ✔ (T4 + appends), motion ✔ (T2–T3), fuentes ✔ (T1), borrados ✔ (T16), gates ✔ (T17).
- **Deviaciones conscientes del spec:** (1) `data-count` NO va en precios async (el counter se resuelve al montar; precios llegan después) — counters solo en stats estáticos del hero. (2) `ContactSection.tsx` no existe como archivo: `ContactForm` se monta directo (misma sección `#contact` que ya trae). Ambas anotadas aquí para el reviewer.
- **Type consistency:** `useMarketingMotion<T>(): RefObject<T | null>` consistente en T3/T5–T15; `usePricing()` shape verificado contra `src/hooks/usePricing.ts`; `BarPackage` contra `src/hooks/useBarPackages.ts`.
- **Placeholders:** ninguno — todo step con código completo.
