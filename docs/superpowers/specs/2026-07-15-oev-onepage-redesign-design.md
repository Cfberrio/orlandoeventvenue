# Rediseño frontend OEV — one-page estilo DR (spec aprobado)

> ClickUp 86e2a4e96 §6. Referencia visual: `/Users/cberrio04/Documents/DISCIPLINERIFT/disciplinerift`
> (sistema "drm" aprobado: `DESIGN.md`, `src/dr-marketing.css`, `src/lib/motion.ts`,
> `src/components/home/HomeSections.tsx`). Se toma de DR **solo** el lenguaje visual
> (tipografía bold, animaciones, botones pill, estampillas/bubbles, ubicación de elementos).
> **NO** se copia paleta ni branding: OEV mantiene su branding oficial.

## Objetivo

Rediseñar el sitio público de OEV como one-page limpio y moderno con la estética DR,
manteniendo todo el contenido y la lógica de negocio actuales. Look más limpio y
profesional (pedido de Luis, video Jul 14).

## Requisitos duros (innegociables)

1. **One-page**: todo el marketing vive en `/`. Navegación por anchors.
   Únicas rutas de usuario final fuera del one-page: `/book`, `/schedule-tour`, `/tour`.
2. **Cero regresiones funcionales**:
   - GA4 (`index.html`, `G-8D4SSYMCNP`) — **no se toca**. Verificado: los componentes
     de marketing actuales no contienen ninguna llamada analytics; el evento `purchase`
     vive en `BookingConfirmation.tsx` (fuera de alcance, no se toca).
   - Flujo `/book` completo — no se toca. Links `/book?type=hourly|daily` se preservan.
   - Dashboard admin y staff — cero cambios. Ningún token global de shadcn
     (`--primary`, `--card`, etc. en `src/index.css`) cambia de valor.
   - Precios dinámicos vía `usePricing` — se preservan (hourly, daily, cleaning fee,
     setup/breakdown, tablecloth, bar packages).
   - Submit de ContactForm — misma lógica, solo re-styled.
   - DiscountPopup — se mantiene tal cual.
3. **SEO**: h1/h2 semánticos, redirects `/pricing|/gallery|/contact → /#anchor`
   (links indexados no mueren), meta tags de `index.html` intactos.
4. **Accesibilidad de motion**: `prefers-reduced-motion` ⇒ todo el contenido visible sin
   animación (patrón DR: estados iniciales solo dentro de `gsap.matchMedia` no-pref,
   `fromTo` siempre).
5. Tests vitest existentes pasan sin modificarse.

## Rutas

| Ruta | Acción |
|---|---|
| `/` | One-page rediseñado |
| `/book`, `/schedule-tour`, `/tour` | Sin cambios (rutas funcionales aparte) |
| `/pricing` | `<Navigate to="/#pricing" replace>` — se borra `PricingPage.tsx` |
| `/gallery` | `<Navigate to="/#gallery" replace>` — se borra `GalleryPage.tsx` |
| `/contact` | `<Navigate to="/#contact" replace>` — se borra `pages/Contact.tsx` |
| `/booking-confirmation`, `/auth`, `/accesscode`, `/sms-terms`, `/privacy-policy`, `/terms-of-use`, `/stripe/connect/callback`, `/admin/*`, `/staff/*` | Intactos |

## Arquitectura del one-page (orden de secciones)

1. **OevNav** — sticky, blanco 92% + blur, borde inferior 1px, sombra tras scroll.
   Logo OEV + wordmark, links anchor (Pricing, Add-ons, Gallery, Tour, How it works,
   FAQ, Contact), CTA "Book Now" pill. Mobile: hamburger actual re-styled.
2. **OevHero** (`#top`) — palabra gigante moderada:
   - `.pre` "Modern venue for" / `.giant` en acento (copy final a definir en
     implementación, p.ej. "events that just work.") / `.post` "Near Downtown Orlando."
   - Línea de tipos de evento color-coded (equivalente a la sports line DR):
     Corporate · Celebrations · Presentations · Productions.
   - Stats row con counters (`data-count`): 90 chairs, 10 tables, 24/7 access, $0 deposit.
   - CTA row: Book Now (`.btn-primary`) + Schedule a Tour (`.btn-ghost`).
   - Glifos ambient de eventos (copas, música, luces, cámara) orbitando el cursor —
     desktop + fine pointer only, mobile no los monta.
   - SplitText mask reveal en la línea gigante.
   - Hero limpio sobre blanco (sin foto de fondo; las fotos van a promo band/gallery/tours).
3. **PromoBand** (`#included`) — banda solid acento radius 30:
   checklist 2 col con ticks animados: 90 chairs + 10 tables · Prep kitchen ·
   Free parking on-site · 24/7 access · High-level A/V production available ·
   No catering restrictions. Bubble blanca rotada flotante: "Flat pricing /
   no hidden fees". `.seal` "$0 deposit" (gira al entrar, patrón seal DR).
   Link 5-star reviews (Google). Foto del venue lado derecho.
   CTA `.btn-onblue` Book Now.
4. **WhyCards** (`#why`) — 3 `.vcard` (borde 1.5px acento, radius 26, palabra grande +
   subline + body + flecha, hover lift): Flexible (hourly o daily, 24/7) /
   Complete (todo incluido, prep kitchen) / Simple (flat pricing, book online).
5. **PricingSection** (`#pricing`) — 2 cards: Hourly (outline, 4-hr min) vs
   Daily Special (solid acento, "Most Popular", 24-hr access), precios `usePricing`
   con roll-up `data-count`. Cleaning fee como línea aparte. CTAs → `/book?type=...`.
6. **AddonsSection** (`#add-ons`) — Production + Bar Service + Extras como `.atile`
   (outline gris, line-icon SVG stroke 1.8 con `data-draw` + `data-wiggle`, label +
   dot). Contenido y precios de los componentes actuales `Production`/`BarService`
   se re-maquetan aquí (misma info, mismos hooks).
7. **GalleryTours** (`#gallery`, `#tour`) — carousel embla actual (11 fotos, autoplay,
   lightbox) re-styled con hover DR + `.hcard` con `.h-bubble` rotada ("See it /
   in person") + imagen `data-parallax` + CTAs: "3D Virtual Tour" → `/tour` y
   "Schedule a Tour" → `/schedule-tour`.
8. **HowItWorksSection** (`#how-it-works`) — 4 `.step` con círculo numerado `data-pop`:
   Enter Event Date → Payment & Agreement → Confirm with Payment (50%) → Show Up & Enjoy.
   Mobile: cards outline en fila snap-scroll.
9. **FaqSection** (`#faq`) — accordion shadcn actual re-styled (5 preguntas, precios
   dinámicos de `usePricing` en respuestas).
10. **FinalBand** — banda CTA "Ready to host an effortless event?" → `/book`.
11. **ContactSection** (`#contact`) — `ContactForm` actual (lógica intacta) re-styled
    dentro del scope.
12. **OevFooter** — negro `#0B0B0B` (ya lo es), logo blanco, location, contact,
    nota bar service, legal links. Alineado a la estética nueva.
13. **MobileBar** — `.mbar` sticky bottom "Book Now" (negro, solo <961px).

DiscountPopup se monta igual que hoy.

## Sistema visual (scoped, branding OEV)

- Scope: `<div className="oev">` en Index; todo el CSS de marketing vive en
  `src/oev-marketing.css` bajo `.oev`. Cero cambios a `src/index.css` /
  `tailwind.config.ts` (los componentes shadcn re-usados dentro del scope se
  re-stylean por cascada, no por token).
- Tokens (CSS vars en `.oev`): `--accent` = primary OEV actual `hsl(200 98% 39%)`,
  `--accent-ink` (hover, más oscuro), `--ink #0B0B0B`, grises `--g50…--g900`,
  canvas blanco. Acentos secundarios SOLO para la línea de tipos de evento + dots.
- Tipografía: Inter 400–900 (ampliar import de Google Fonts; hoy 400–700).
  H1/H2 weight 800–900, tracking -0.02 a -0.045em, line-height ~1.05.
  Giant hero `clamp(40px, 6.5vw, 84px)` ("no necesariamente letras gigantes" — Luis).
  Section H2 acento centrado `clamp(30px, 4vw, 52px)`. Body 15.5–16.5px.
  Lora/Space Mono fuera del marketing (siguen cargadas para el resto de la app).
- Componentes canónicos (nombres estables, diffables contra DR): `.btn-primary`,
  `.btn-ghost`, `.btn-onblue` (pill 999, weight 800), `.vcard`, `.promo-band`,
  `.bubble`, `.hcard`, `.h-bubble`, `.steps`/`.step`, `.atile`, `.mbar`, `.tick`,
  `.seal`. (Sin `.pills` sub-nav: ninguna sección lo usa — YAGNI.)
- Layout: container 1200px, gutters 24/16, ritmo de sección 96px desktop / 72px
  mobile, radius 20–30, borders 1.5px, sombras solo hover
  (`0 12px 34px rgba(11,11,11,.10)`).
- Mobile: filas de cards = scroll horizontal snap (`grid-auto-flow: column`,
  `grid-auto-columns: 78%`), scrollbar oculto. Nunca apilar cards vertical.

## Motion (port del sistema DR)

- `src/lib/gsap.ts` — registro central: `gsap`, `ScrollTrigger`, `SplitText`,
  `DrawSVG`, `useGSAP`, helper `prefersReducedMotion()`. (gsap ^3.15 ya instalado;
  bonus plugins incluidos en el paquete público.)
- `src/lib/marketingMotion.ts` — port adaptado de DR `lib/motion.ts`:
  - `useMarketingMotion()` — un hook en Index, data-attributes:
    `data-rv` (+variantes left/right/scale), `data-rv-group`, `data-pop`,
    `data-count`, `data-draw`, `data-float`, `data-parallax`, `data-wiggle`.
  - `usePromoBandMotion()` — checklist slide + ticks pop + seal/bubble.
  - Todo dentro de `gsap.matchMedia` (desktop/mobile/no-pref). `fromTo` siempre.
    Desktop-only: float, parallax, orbits. Reduced motion: contenido visible, sin JS motion.
- Hero: SplitText (`lines,words`, mask lines, autoSplit) + orbits con `quickTo`.

## Archivos

Nuevos:
```
src/oev-marketing.css
src/lib/gsap.ts
src/lib/marketingMotion.ts
src/components/home/{OevNav,OevHero,PromoBand,WhyCards,PricingSection,
  AddonsSection,GalleryTours,HowItWorksSection,FaqSection,FinalBand,
  ContactSection,OevFooter,MobileBar}.tsx
docs/superpowers/specs/2026-07-15-oev-onepage-redesign-design.md (este doc)
```

Modificados: `src/pages/Index.tsx` (composición nueva), `src/App.tsx` (redirects,
menos imports), `src/index.css` (solo el import de fuentes Inter amplía pesos —
ningún token cambia).

Borrados tras verificación (grep de imports primero):
`components/{Hero,SpaceHighlights,Pricing,AddOns,Production,BarService,HowItWorks,
FAQ,FinalCTA,ScheduleTourCTA,Gallery,Navigation,Footer,NavLink}.tsx`,
`hooks/useScrollAnimation.tsx`, `pages/{PricingPage,GalleryPage,Contact}.tsx`.
Nota: `Navigation` la importan también `PricingPage/GalleryPage/Contact` (se borran
juntas). Ningún archivo de admin/staff/book importa componentes de marketing.

## Verificación (gates, en orden)

1. `npx tsc --noEmit` y `npm run build` verdes.
2. `npm test` — suite existente pasa sin modificar tests.
3. `grep` — cero imports rotos de archivos borrados; cero cambios en
   `index.html`, `BookingConfirmation.tsx`, `src/lib/analytics.ts`, tokens de
   `src/index.css`, `tailwind.config.ts`.
4. Playwright (dev server):
   - Desktop 1440px + mobile 390px: screenshot de cada sección.
   - Anchors del nav scrollean a la sección correcta (offset del sticky nav OK).
   - `/pricing`, `/gallery`, `/contact` redirigen al anchor.
   - `/book`, `/schedule-tour`, `/tour` cargan igual que antes.
   - Emulación `prefers-reduced-motion: reduce`: todo el contenido visible.
   - `.mbar` visible solo <961px; orbits solo desktop.
   - Consola sin errores.
5. Lighthouse rápido en `/` (no bloqueante, registrar score antes/después).

## Fuera de alcance

- Copy final en inglés del hero (se afina en implementación con aprobación del usuario).
- Rediseño de `/book`, `/schedule-tour`, `/tour` (fase posterior si se quiere).
- i18n (DR lo tiene; OEV no lo necesita hoy).
- Fotos nuevas del venue (Luis dijo que la distribución actual está bien).
