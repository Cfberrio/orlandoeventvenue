# Auditoría Visual del Frontend — OEV

> Objetivo: documentar **estructura visual, técnicas, iconos y ubicación de elementos** para poder replicar el sistema en otro venue.
> **No incluye paleta de colores** (los tokens se listan solo como referencia de mecanismo, no de valores estéticos).

---

## 0. Stack y fundamentos del sistema de diseño

| Pieza | Qué se usa |
|-------|-----------|
| Framework | React 18 + Vite + React Router |
| UI kit | **shadcn/ui** (primitivas Radix en `src/components/ui/`) |
| Estilos | **Tailwind CSS** + `tailwindcss-animate` |
| Iconos | **lucide-react** (todos los iconos del sitio) |
| Carrusel | `embla-carousel-react` + `embla-carousel-autoplay` |
| Formularios | `react-hook-form` + `zod` (vía `@hookform/resolvers`) |

### Tokens base (`src/index.css` + `tailwind.config.ts`)
- **Fuentes** (3 familias, cargadas desde Google Fonts):
  - `font-sans` → **Inter** (400/500/600/700) — texto general
  - `font-serif` → **Lora** — disponible para títulos editoriales
  - `font-mono` → **Space Mono** — números de reserva / IDs
- **Container**: centrado, `padding: 2rem`, `max 1400px` (en 2xl).
- **Radius base**: `--radius: 0.5rem` → `rounded-lg`. `md = -2px`, `sm = -4px`. Se usan también `rounded-xl`, `rounded-2xl`, `rounded-full`.
- **Sombras**: escala `xs → 2xl` vía variables `--shadow-*`.
- **Espaciado base**: `0.25rem` (escala Tailwind estándar).
- **Animaciones registradas** (keyframes):
  - `wave` — flotación vertical `translateY(-8px)`, 3s loop (iconos del Hero).
  - `pulse-glow` — glow + escala, 2.5s loop (CTA principal).
  - `ripple` — expansión 500px, 0.6s (efecto click).
  - `accordion-down/up` — 0.2s (FAQ).
  - `float` — `translateY(-10px)`, definido en CSS.
- **Modo oscuro**: clase `.dark`, mismos tokens redefinidos.

### Patrones globales reutilizados (memorizar — se repiten en TODO el sitio)
```
Sección:            py-8 md:py-12  (algunas py-10/14/16/24)
Ancla scroll:       scroll-mt-24   (compensa nav sticky)
Contenedor:         container mx-auto px-4 + max-w-{3xl..7xl}
Título sección H2:  text-3xl md:text-4xl font-bold text-center
Subtítulo:          text-center text-muted mb-12 max-w-2xl mx-auto
Card hover:         hover:shadow-xl hover:-translate-y-1/2 + group
Icono en círculo:   w-12 h-12 rounded-full bg-primary/10 → icono w-6 h-6 text-primary
Badge flotante:     absolute -top-3 left-1/2 -translate-x-1/2
Bullet de feature:  ✓ (text-primary) como texto, no icono
```

---

# PARTE 1 — ONE PAGE (Landing)

## Orden de secciones (`src/pages/Index.tsx`)
Render lineal, una sección debajo de otra:

```
1.  DiscountPopup     (modal, aparece sobre todo)
2.  Navigation        (sticky top)
3.  Hero
4.  SpaceHighlights
5.  Pricing
6.  AddOns            (incluye Production + BarService embebidos)
7.  Gallery
8.  ScheduleTourCTA
9.  HowItWorks
10. FAQ
11. FinalCTA
12. ContactForm
13. Footer
```
Navegación por hash: al cargar con `#ancla` hace `scrollIntoView({behavior:"smooth"})`. Cada sección con id usa `scroll-mt-24`.

---

## 1. Navigation
- **Layout**: `sticky top-0 z-50`, `bg-card/95 backdrop-blur-sm`. Flex `justify-between`, altura `h-16 sm:h-20`.
- **Logo**: izquierda, imagen `h-10 sm:h-16` + texto `text-base sm:text-xl font-bold`.
- **Links desktop**: `hidden lg:flex gap-4 xl:gap-6` (7 items). Subrayado animado con pseudo-elemento: `after:w-0 hover:after:w-full` (300ms) + `hover:scale-105`.
- **Mobile**: botón con iconos `Menu` / `X` (24px). Dropdown `animate-fade-in`, items `py-3 px-3 rounded-md hover:bg-accent/50`.
- **Breakpoint**: nav desktop aparece en `lg`, menú móvil debajo.

## 2. Hero
- **Sección**: `relative pt-32 md:pt-48 pb-12 md:pb-16 overflow-hidden`.
- **Fondo en capas** (técnica clave, se repite en CTAs):
  1. imagen `bg-cover bg-center`
  2. gradiente vertical `from-background/80 via-background/70 to-background/60`
  3. gradiente radial desde top-right (`primary/0.15` → transparente)
  4. fade inferior `h-32 bg-gradient-to-b from-transparent to-background`
- **Contenido**: `container z-10`, texto centrado `max-w-4xl`. H1 `text-4xl md:text-6xl font-bold leading-tight`.
- **Tarjeta de features** (debajo del H1):
  - `Card bg-card/60 backdrop-blur-md border-border/50 shadow-xl`
  - Grid `grid-cols-2 md:grid-cols-4 divide-x divide-border/30`, cada celda `h-40`.
  - Iconos lucide **48px**: `Armchair`, `BadgePercent`, `Clock`, `MapPin`.
  - Animación `animate-wave` con delays escalonados (0s / 0.2s / 0.4s / 0.6s).
- **CTA principal**: botón `size-lg text-lg px-8 py-6` + `hover:scale-105` + `animate-pulse-glow`.
- **Badges**: 2 secundarios bajo el botón `px-4 py-2 text-sm`.

## 3. SpaceHighlights
- **Layout**: `py-8 md:py-12`, contenedor `max-w-6xl`.
- **Grid de 4 cards**: `grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6`.
- **Card**: `bg-gradient-to-br from-card to-card/80`, hover `hover:shadow-xl hover:-translate-y-2 group`.
- **Iconos**: `Car`, `Star`, `ChefHat`, `MapPin` — `w-8 h-8 mx-auto mb-3`, hover `group-hover:scale-125 group-hover:rotate-6`.
- **Animación de entrada**: hook `useScrollAnimation()` → `opacity-0 translate-y-10` → `opacity-100 translate-y-0` (1000ms, delays 0/150/300ms).
- Links con `underline decoration-primary/30 hover:decoration-primary`.

## 4. Pricing
- **Sección** `id="pricing"`, contenedor `max-w-5xl`.
- **Grid 2 columnas**: `md:grid-cols-2 gap-6`.
  - **Card Hourly**: border estándar, icono `Clock` (5x5), precio `text-4xl font-bold`, botón `outline w-full`.
  - **Card Daily (destacada)**: `border-2 border-primary`, badge flotante "Most Popular" (`absolute -top-3 left-1/2 -translate-x-1/2`, gradiente), hover más pronunciado `hover:-translate-y-3 hover:scale-105`. Icono `Calendar`. Botón primario.
  - **Card Cleaning Fee**: ancho completo, `flex justify-between`, icono `Sparkles`, precio `text-2xl`.
- **Features**: lista con `✓` (text-primary) como bullet de texto.

## 5. AddOns (contenedor compuesto)
- **Sección** `id="add-ons"`, `py-10 md:py-14`, `max-w-6xl`.
- **Caja contenedora grande**: `bg-background rounded-2xl shadow-sm border p-6 md:p-10 space-y-10`.
- Embebe 2 sub-componentes separados por `border-t`:
  - **Production**: grid `md:grid-cols-3 gap-6`. Cards con icono-en-círculo (`Mic`, `Monitor`, `Video`), precio `text-2xl font-bold` + `/hr`, features `✓`.
  - **BarService**: grid `sm:grid-cols-2 lg:grid-cols-4 gap-6`. Card "Most Popular" con `border-2 border-primary` + badge flotante. Iconos `Wine`, `GlassWater`, `Martini`, `Sparkles`. Precio + `/guest`.
- **Extras**: grid `md:grid-cols-2 gap-4 max-w-3xl`, filas `flex justify-between p-4 bg-accent rounded-lg`.

## 6. Gallery
- **Sección** `id="gallery"`, `bg-gradient-to-b from-background to-accent overflow-hidden`, `max-w-7xl`.
- **Carrusel** (embla + autoplay 4000ms, loop):
  - `CarouselItem`: `pl-2 md:pl-4 md:basis-1/2 lg:basis-1/3` (1 / 2 / 3 visibles).
  - 11 imágenes. Alto fijo `h-80 md:h-96`, `object-cover`.
  - Hover: zoom `group-hover:scale-110` (700ms) + overlay `from-black/70` con título `absolute bottom-4`.
- **Flechas**: `-left-4 md:-left-12`, `bg-background/80 backdrop-blur-sm hover:scale-110`.
- **Indicadores (dots)**: activo `w-8 bg-primary`, inactivo `w-2`, `h-2 rounded-full transition-all`.
- **Modal**: `Dialog max-w-7xl w-[95vw] h-[90vh] p-0`, imagen `object-contain`, caption inferior con gradiente.

## 7. ScheduleTourCTA
- Mismo patrón de **fondo en capas** que el Hero (imagen + gradientes + fades).
- Contenido centrado `max-w-2xl space-y-6`. Icono `CalendarCheck` `h-12 w-12 mx-auto`.
- H2 `text-3xl md:text-4xl font-bold` + párrafo `text-lg` + botón `size-lg hover:scale-105`.

## 8. HowItWorks
- **Sección** `id="how-it-works"`, `bg-accent`, `max-w-6xl`.
- **Grid de 4 pasos**: `md:grid-cols-2 lg:grid-cols-4 gap-6`.
- **Card de paso**: número en badge flotante `absolute -top-4 -left-4 w-8 h-8 rounded-full bg-primary text-primary-foreground` + contenido con `pt-8` (deja sitio al badge).
- **Iconos**: `Calendar`, `FileText`, `CreditCard`, `PartyPopper` — `w-10 h-10 text-primary`.
- CTA tipo link `variant-link p-0` con flecha `→`.
- Entrada con `useScrollAnimation`.

## 9. FAQ
- **Sección** `id="faq"`, contenedor estrecho `max-w-3xl`.
- **Accordion shadcn** `type="single" collapsible`, 5 items.
- Trigger `text-left hover:text-primary transition-colors`. Animación nativa `accordion-down/up` (0.2s). Sin iconos extra (chevron del componente).

## 10. FinalCTA
- Patrón de **fondo en capas** (imagen + gradientes).
- **Card central**: `max-w-4xl bg-card/60 backdrop-blur-md shadow-2xl p-8 md:p-12 text-center`, hover sombra custom `hover:shadow-[0_20px_60px_-15px_...]`.
- H2 grande `text-3xl md:text-5xl font-bold`, botón `size-lg hover:scale-105`.

## 11. ContactForm
- **Sección** `id="contact"`, `py-24`, **fondo con 2 imágenes laterales** + overlay gradiente. Contenedor `max-w-4xl`.
- **Form box**: `bg-background p-8 rounded-xl shadow-sm border space-y-6`.
- **Campos**: grid `md:grid-cols-2 gap-6`. Date picker vía `Popover` + `Calendar` (icono `CalendarIcon`). Honeypot oculto (`display:none`).
- **Validación**: `border-destructive` + mensaje `text-sm text-destructive`.
- **Consentimientos**: 2 checkboxes en cajas `border rounded-lg p-3`.
- **Botón submit**: `size-lg w-full md:w-auto min-w-[200px]`, estados: `Loader2` (enviando) / `CheckCircle` (éxito) / `Send`.
- **Iconos**: `CalendarIcon`, `Loader2`, `Send`, `CheckCircle`.

## 12. Footer
- `bg-black text-white py-12`, `max-w-6xl`. Grid `md:grid-cols-3 gap-8`.
- Columnas: (1) logo `h-20` + tagline, (2) ubicación con icono `MapPin` (w-4 h-4), (3) contacto con icono `Phone`.
- Barra inferior: `border-t border-white/20 pt-8 text-center text-sm`, links separados por `|`.

## 13. DiscountPopup
- **Modal** `Dialog sm:max-w-md`. Header `text-center space-y-3`.
- **Icono en círculo**: `h-14 w-14 rounded-full bg-primary/10` → icono `Gift` `h-7 w-7`.
- Form: Name / Email / Phone / Select tipo de evento / checkbox consentimiento.
- **Estado éxito**: círculo verde `bg-green-500/10` con `CheckCircle2`.
- **Iconos**: `Gift`, `Loader2`, `CheckCircle2`.

---

# PARTE 2 — BOOKING FORM (Multi-step)

## Arquitectura del wizard (`src/pages/Book.tsx`)
- **Fondo de página**: `bg-gradient-to-b from-background to-accent/10`.
- **Contenedor**: `container mx-auto px-4 py-12 md:py-20`, contenido `max-w-4xl mx-auto`.
- **Indicador de progreso**:
  - Barra `Progress` (`h-3`) arriba.
  - Números de paso **1–6 clickeables** con su título debajo.
  - Header: "Step X of 6: {Título}" centrado, `text-4xl md:text-5xl`.
- **Todos los pasos** se renderizan dentro de **una sola `Card`** `p-6 md:p-8`.
- **NO hay sidebar** — el resumen/precio va integrado en el contenido del paso (Step 4).
- **Navegación**: siempre abajo `flex justify-between pt-4` → izq. "Back" (`variant=outline`), der. "Next" (`size=lg`, primario).
- **Scroll**: al cambiar de paso `window.scrollTo({top:0, behavior:"smooth"})`.

### Patrones compartidos entre pasos
```
Espaciado:        space-y-6 (algunos space-y-8)
Título paso H2:   text-2xl font-bold mb-4
Subsección H3:    text-lg font-semibold
Item radio/check: flex items-start space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors
Grid responsive:  grid grid-cols-1 md:grid-cols-2 gap-4
Label:            text-base font-semibold
Descripción:      text-sm text-muted-foreground
Caja secundaria:  bg-accent/20 rounded-lg p-4
Error:            bg-destructive/10 border-destructive/20 + texto destructive
Éxito:            bg-green-50 border-green-200 + icono Check
```
> **Técnica de selección**: NO usa ring/checkmark custom. Usa el radio/checkbox nativo de Radix + cambio de fondo en hover (`hover:bg-accent/50`). La caja completa (`border rounded-lg p-4`) es el área clickeable.

---

## Step 1 — Booking Type (`BookingTypeStep.tsx`)
- **RadioGroup** con 2 opciones en cajas bordeadas (`border rounded-lg p-4`), cada una con título `font-semibold` + descripción `text-sm text-muted-foreground`.
- **Date picker**: `Popover` con botón `variant=outline w-full pl-3 text-left`, icono `CalendarIcon` (`h-4 w-4 opacity-50 ml-auto`). Deshabilita fechas pasadas / días llenos.
- **Inputs de hora** (solo hourly, condicional): grid `grid-cols-1 md:grid-cols-2 gap-4`, `Input type=time`.
- **Alerta de conflicto**: `flex items-center gap-2 p-3 rounded-lg bg-destructive/10` + icono `AlertCircle`.
- **Orden**: H2 → descripción → tipo → fecha → (horas) → (alerta) → nav.

## Step 2 — Guests & Event (`GuestsEventStep.tsx`)
- Layout de 1 columna, todos los inputs full-width.
- **Number input** `min=1 max=90` + `FormDescription` "Maximum capacity: 90 guests".
- **Select** tipo de evento (11 opciones, `SelectContent bg-background`).
- Input condicional "other".
- **Textarea** `min-h-[120px]` con contador `{length}/1000 characters`. Label con emoji "🎯".
- Sin iconos.
- **Orden**: H2 → descripción → guests → tipo → (other) → notas → nav.

## Step 3 — Add-Ons (`AddOnsStep.tsx`)
- `space-y-8`. Tres bloques: Production → Optional Services → Bar Service.
- **Production RadioGroup**: 4 opciones (None/Basic/LED/Workshop), radio `mt-1` arriba, descripción multilínea.
- **Inputs de hora del paquete** (condicional): caja `border rounded-lg p-4 bg-accent/20`, grid `grid-cols-2 gap-4`.
- **Optional Services**: H3 `text-lg font-semibold`. Checkboxes en `flex flex-row items-start space-x-3 border rounded-lg p-4`. Input de cantidad indentado `ml-9 max-w-xs`.
- **Bar Service**: separado por `border-t mt-4 pt-4`. RadioGroup con `Badge` promocional (`bg-primary text-primary-foreground`). Input nº invitados + subtotal `text-sm bg-background border rounded-md p-3`.
- **Iconos**: `Loader2` (carga `animate-spin`) + `Badge`.

## Step 4 — Summary & Pricing (`SummaryStep.tsx`)
- Bloques tipo card con fondo. Botón **Edit** arriba-derecha de cada bloque (`variant=ghost size=sm` + icono `Edit h-4 w-4`, navega al paso).
- **Discount Code**: caja `bg-accent/20 rounded-lg p-4`. Header con icono `Tag`. Estado aplicado: `bg-green-50 border-green-200` + icono `Check` + botón `X` para quitar.
- **Pricing Breakdown**: caja `bg-accent/30 rounded-lg p-6`. Líneas `flex justify-between text-sm`, `Separator my-4`, subtotal `font-semibold text-lg`, depósito `text-primary`, balance `text-muted-foreground`.
- **Iconos**: `Edit`, `Tag`, `Check`, `X`.
- **Orden**: H2 → detalles reserva (Edit) → separador → evento (Edit) → addons (Edit) → discount → breakdown → nav.

## Step 5 — Contact & Policies (`ContactPoliciesStep.tsx`)
- **Contact grid**: `grid-cols-1 md:grid-cols-2 gap-4` → Nombre, Email, Teléfono (`type=tel inputMode=numeric maxLength=14`, formateado), Empresa.
- **Venue Rules**: `ScrollArea h-[250px] border rounded-lg p-4 bg-muted/30`, lista con bullet `• text-primary`.
- **Checkboxes de política**: `flex flex-row items-start space-x-3 border rounded-lg p-4 bg-background`. Links `text-primary underline`.
- **Firma (signature pad)**:
  - Input de iniciales `w-32 uppercase maxLength=4`.
  - Grid nombre + fecha (`readOnly bg-muted`).
  - **Canvas** `w-full cursor-crosshair touch-none` (`height:200px`), `border-2 rounded-lg`, escalado por device-pixel-ratio, soporta mouse + touch. Botón Clear `variant=outline size=sm`.
- **Orden**: H2 → contacto → reglas (scroll) → checks → firma → nav.

## Step 6 — Payment (`PaymentStep.tsx`)
- **Estado inicial**:
  - **Payment Summary Card** `Card p-6 bg-accent/30`: depósito `text-2xl font-bold text-primary` + desglose `ml-4 text-sm`.
  - **Banner de seguridad** `bg-blue-50 border-blue-200 rounded-lg p-4` con icono `Shield` + lista.
  - Botón pago `size=lg`: estado normal icono `CreditCard` + "Pay $X Now"; procesando `Loader2 animate-spin` + "Processing...".
- **Estado éxito**: centrado `space-y-6 py-8`. Icono `CheckCircle2 h-20 w-20 text-green-500`. H2 `text-3xl font-bold`. ID en `font-mono`. Card de detalles + "What's Next" + botón Return Home.
- **Iconos**: `CheckCircle2`, `CreditCard`, `Loader2`, `Shield`.

## Booking Confirmation (`BookingConfirmation.tsx`)
- 3 estados: **Loading** (`Loader2 h-12`), **Error** (`XCircle h-20 text-destructive`), **Success**.
- **Success** (`max-w-3xl space-y-8`):
  - Header centrado con `CheckCircle2 h-20`.
  - **Reservation card** `bg-primary/5 border-primary/20`: número `text-3xl md:text-4xl font-mono font-bold tracking-wider` + botón copiar (icono `Copy` → `Check` al copiar).
  - **Booking details** grid `md:grid-cols-2` con iconos `Calendar`, `Clock`, `Users` (`h-5 w-5 text-muted-foreground`).
  - **Payment summary** con líneas `flex justify-between`.
  - **What's Next**: lista con badges numerados `w-6 h-6 rounded-full bg-primary/10 text-primary`.

---

## Apéndice — Inventario completo de iconos lucide-react

| Sección | Iconos |
|---------|--------|
| Navigation | `Menu`, `X` |
| Hero | `Armchair`, `BadgePercent`, `Clock`, `MapPin` (48px) |
| SpaceHighlights | `Car`, `Star`, `ChefHat`, `MapPin` |
| Pricing | `Clock`, `Calendar`, `Sparkles` |
| Production | `Mic`, `Monitor`, `Video` |
| BarService | `Wine`, `GlassWater`, `Martini`, `Sparkles` |
| ScheduleTourCTA | `CalendarCheck` |
| HowItWorks | `Calendar`, `FileText`, `CreditCard`, `PartyPopper` |
| ContactForm | `CalendarIcon`, `Loader2`, `Send`, `CheckCircle` |
| Footer | `MapPin`, `Phone` |
| DiscountPopup | `Gift`, `Loader2`, `CheckCircle2` |
| Booking Step 1 | `CalendarIcon`, `AlertCircle` |
| Booking Step 3 | `Loader2` |
| Booking Step 4 | `Edit`, `Tag`, `Check`, `X` |
| Booking Step 6 | `CheckCircle2`, `CreditCard`, `Loader2`, `Shield` |
| Confirmation | `CheckCircle2`, `XCircle`, `Loader2`, `Calendar`, `Clock`, `Users`, `Copy`, `Check` |

## Apéndice — Tamaños de icono estándar
```
h-4 w-4   → dentro de botones, inline con texto
h-5 w-5   → detalles/listas
w-6 h-6   → icono dentro de círculo (w-12 h-12 rounded-full bg-primary/10)
w-8/10 h-8/10 → cards de highlights / pasos
48px      → Hero feature cards
h-20 w-20 → estados de éxito/error grandes
```

## Apéndice — Recetas reutilizables (copy-paste mental)

**Card con icono en círculo:**
```jsx
<Card className="hover:shadow-xl hover:-translate-y-1 group">
  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
    <Icon className="w-6 h-6 text-primary" />
  </div>
  <CardTitle>...</CardTitle>
  <p className="text-2xl font-bold">$X<span className="text-sm text-muted font-normal">/hr</span></p>
  <ul className="space-y-2"><li>✓ feature</li></ul>
</Card>
```

**Card destacada con badge flotante:**
```jsx
<Card className="border-2 border-primary pt-6 relative">
  <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-primary to-primary/80 shadow-lg group-hover:scale-110">
    Most Popular
  </Badge>
  ...
</Card>
```

**Sección con fondo en capas (Hero/CTA):**
```jsx
<section className="relative overflow-hidden py-12">
  <div className="absolute inset-0 bg-cover bg-center" style={{backgroundImage:`url(${bg})`}} />
  <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/70 to-background/60" />
  <div className="absolute inset-0" style={{background:'radial-gradient(... primary/0.15 ...)'}} />
  <div className="absolute bottom-0 inset-x-0 h-32 bg-gradient-to-b from-transparent to-background" />
  <div className="container mx-auto px-4 relative z-10">...</div>
</section>
```

**Entrada con scroll (`useScrollAnimation`):**
```jsx
const { ref, isVisible } = useScrollAnimation();
<div ref={ref} className={`transition-all duration-1000 ${isVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10'}`} style={{transitionDelay:'150ms'}}>
```

**Opción seleccionable (radio/checkbox card):**
```jsx
<label className="flex items-start space-x-3 border rounded-lg p-4 hover:bg-accent/50 transition-colors cursor-pointer">
  <RadioGroupItem value="x" className="mt-1" />
  <div>
    <p className="font-semibold">Título <span>$precio</span></p>
    <p className="text-sm text-muted-foreground mt-1">descripción</p>
  </div>
</label>
```
