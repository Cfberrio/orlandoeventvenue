# D'Space Orlando - Lovable Build Brief

A developer handoff specifying every screen, component, state, copy block, and booking behavior for the D'Space Orlando Mon-Thu corporate pilot site.

**Prepared for:** Lovable + OEV dev team
**Scope:** Frontend + booking logic, no database (no schema, SQL, or edge-function code)
**Date:** 2026-06-10

---

## Table of Contents

1. [Project Brief & Goals](#1-project-brief--goals)
2. [Brand, Positioning & Global Rules](#2-brand-positioning--global-rules)
3. [Homepage - Section by Section](#3-homepage---section-by-section)
4. [The Four Bookable Spaces](#4-the-four-bookable-spaces)
5. [Booking Wizard - Multi-Space, One Event (CORE)](#5-booking-wizard---multi-space-one-event-core)
6. [Booking + Operations State Machine](#6-booking--operations-state-machine)
7. [Lead-Capture Form & Supporting Pages](#7-lead-capture-form--supporting-pages)
8. [Improvements Over OEV + Open Items](#8-improvements-over-oev--open-items)
9. [Appendix: Source references](#appendix-source-references)

---

## 1. Project Brief & Goals

### 1.1 What D'Space Orlando Is

D'Space Orlando is a 6,000 sq ft modern-industrial event venue built for large-capacity gatherings, located 3.4 miles (roughly a 5-minute drive) from Orlando International Airport (MCO).

| Attribute | Value | Notes |
|---|---|---|
| Venue name | D'Space Orlando | Display name. Must be config-driven, never hardcoded in React (see 1.6). |
| Address | 6838 Hoffner Ave #1200, Orlando, FL 32822 | Config-driven. |
| Floor area | 6,000 sq ft | |
| Distance to MCO | 3.4 mi / ~5 min drive | Core positioning hook (see 1.4). |
| Aesthetic | Modern-industrial | Drives gallery and brand direction. |
| Phone | [PENDING - Glendalys] | Do not invent. Config-driven. One consolidated number. |
| Per-space hourly rates | See Section 4 | Hourly only; no daily rate. Config-driven per space. |
| Per-space capacities | See Section 4 | Config-driven per space. |
| Email sender domain | [PENDING - OEV dev] | Domain-authenticated sender (see 1.6). |

**Bookable spaces (4 separate calendars):**

1. Main Conference Area (full-room only for the pilot; 4-hour minimum)
2. Executive Mezzanine (4-hour minimum)
3. Meeting Room
4. Breakout Rooms (two private suites)

> **Improvement over OEV:** OEV books a single venue. D'Space exposes four independently bookable spaces that can be combined into ONE event with cumulative pricing.

### 1.2 The Soft Launch (Mon-Thu Corporate Pilot)

This build is a **soft launch** scoped to a **Monday-Thursday corporate pilot**.

- **Mon-Thu only.** Friday, Saturday, and Sunday must be **blocked/disabled in every date picker** across the site (booking wizard and lead form).
- **Weekend stays legacy.** Fri-Sun events continue to run through the venue's existing **HoneyBook** flow. This site does NOT handle weekend bookings.
- **Corporate is the lead use-case theme,** but it is NOT the top-line brand label (see 1.4).

> The pilot is deliberately narrow. Build the calendar architecture so spaces and days can expand later (e.g., weekends, room subdivision) WITHOUT a rebuild, but do not expose those capabilities now.

### 1.3 The Mandate: Replicate OEV's Logic, Materially Better

This site mirrors the Orlando Event Venue (OEV) booking system's proven logic - e-sign, Stripe deposit with 80/20 split, "pending, not confirmed" status, admin approval gate, calendar invite + lockbox code on approve, auto-refund + alternative-date offer on decline - and improves on it.

Every place this build upgrades OEV is flagged inline as **"Improvement over OEV:"** so both teams can see the delta. The four headline upgrades baked into this brief:

1. **Config-driven venue identity** - all name/address/phone/capacity/rate values come from config, never hardcoded (OEV's #1 tech debt).
2. **Multi-space, single-event cart** - combine multiple spaces into one event with one cumulative total.
3. **Cleaner add-on alert UX** - add-ons are selectable but non-payable; selecting one fires an admin alert only.
4. **Domain-authenticated email sender** - replaces OEV's fragile personal Gmail app-password setup.

### 1.4 Positioning & Brand

The hero positioning changes from OEV's "corporate event venue" framing to:

> **"Orlando's large-capacity venue - 5 min from MCO"**

- **Headline label:** large-capacity / 5-min-from-MCO. This is the primary identity.
- **Corporate** remains a strong **use-case theme** (it is the Mon-Thu pilot focus) but is NOT the top-line label.
- Do not invent capacity numbers, rates, or claims to support the "large-capacity" hook. Where a specific figure is needed, mark it with the appropriate `[PENDING - who]` tag (see 1.8).

### 1.5 Scope

**In scope for this doc (behavior, screens, and copy):**

- Homepage (with gallery moved up to ~position 6; the dedicated "tour band" section is removed)
- Booking wizard (multi-space, single-event arc: Spaces & time -> Event details -> Add-ons -> Sign & deposit -> Admin gate)
- `/spaces`
- `/gallery`
- `/contact`
- Lead-capture form

**Out of scope for this doc (do NOT include):**

- Database schema or table definitions
- Edge functions or server-side function code
- SQL of any kind
- API contracts and payload shapes

This doc specifies **screens, components, states, copy, and behavior only.** Schema and edge-function work are handled separately by the OEV dev team using the existing OEV implementation as the reference.

**Secondary navigation/CTA exception:** Keep a SECONDARY button in the nav and hero labeled for tours / weekend events that links OUT to HoneyBook. The dedicated on-page tour band is removed.

### 1.6 Config-Driven Mandate (Read Before Building)

> **Improvement over OEV - this is the single most important upgrade.** OEV hardcodes the venue name, address (`3847 E Colonial Dr, Orlando, FL 32803`), phone (`407-974-5979`), capacity (90 chairs / 10 tables), and rates across 9+ React components and 10+ email/PDF templates. That is the system's #1 tech debt and it is non-negotiable to avoid here.

For D'Space, the following must be read from a single config source (never typed into JSX, copy, or email/PDF templates):

- [ ] Venue name
- [ ] Address and postal code
- [ ] Phone number(s)
- [ ] Contact person name
- [ ] Per-space capacities
- [ ] Per-space hourly rates and any fees
- [ ] Website URL and email sender address
- [ ] Deposit percentage and processing fee
- [ ] Any venue rules, penalties, or policy figures shown in copy

Additional baked-in upgrades referenced throughout this doc:

- **Multi-space single-event cart** - see the Booking Wizard section.
- **Cleaner add-on alert UX** - add-ons are shown for selection but are NON-PAYABLE (zero charge); selecting one fires a backend admin notification only, mirroring OEV's existing alcohol/bar alert. No price is added to the cart.
- **Domain-authenticated email sender** - replaces OEV's personal Gmail app-password.

### 1.7 How to Read This Doc

- This is a **build brief / developer handoff**, not marketing material. It is written for a Lovable builder scaffolding the React/Tailwind site and for the OEV dev team wiring the backend.
- Sections describe **screens, components, states, copy, and behavior**. Where exact copy is given, treat it as the intended on-screen text unless marked otherwise.
- **Checklists** (`[ ]`) mark behavior the builder must verify before handoff.
- **Tables** define specs and states.
- **"Improvement over OEV:"** callouts mark every place this build intentionally upgrades the OEV reference system. Preserve these so the upgrade is visible to both teams.
- **Never invent** prices, phone numbers, capacities, or other venue facts. If a value is missing, leave the `[PENDING - who]` tag in place rather than guessing.

### 1.8 Legend: [PENDING - who] Tags

Any value not yet confirmed is marked inline with a pending tag naming the owner responsible for supplying it. Do not ship placeholder real-looking data in its place. The tag forms used throughout this doc are:

| Tag | Owner | Meaning |
|---|---|---|
| `[PENDING - Glendalys]` | Glendalys (client) | Awaiting a pre-publish venue decision Glendalys owns: Main Conference capacity, Breakout rate, cleaning fee, consolidated phone, approval SLA, outside-alcohol policy, display hours, standard rental-hour blocks. (Per the source DEV/PENDING list, Glendalys owns the entire pre-publish block.) |
| `[PENDING - Luis]` | Luis | Awaiting the **Meeting Room rate** review specifically (the COPY DECK assigns this rate to Luis). |
| `[PENDING - OEV dev]` | OEV dev team | Awaiting a backend/integration decision (email sender domain, Stripe config, automation timing, approval-timer SLA length, balance-reminder cadence, lockbox-code release timing). |
| `[PENDING - team]` | Joint (venue + dev) | Awaiting an assumption to be confirmed (e.g., all spaces share one event date; per-space time windows allowed; gallery default filter). |

> **Open assumption to confirm - `[PENDING - team]`:** In the booking wizard, all added spaces share the SAME event date, while each space gets its own start/end time window with cumulative pricing. Confirm this before build.

---

## 2. Brand, Positioning & Global Rules

This section defines the brand frame, the SEO/metadata payload, and the non-negotiable booking rules that apply to **every** screen and every date picker in the build. Treat the "Global Booking Rules" checklist as a build gate: nothing ships until each item is verified.

### 2.1 Positioning & Headline Frame

**The rename.** The hero positioning moves off OEV's "corporate event venue" label.

| | Old (OEV) | New (D'Space) |
|---|---|---|
| Primary positioning label | "Corporate event venue" | **"Orlando's large-capacity venue - 5 min from MCO"** |
| Corporate angle | The headline identity | A **use-case theme**, not the headline |

- The **headline label** is large-capacity + proximity to MCO (Orlando International Airport). That is the lead.
- **Corporate stays a strong use-case theme.** The Mon-Thu pilot is corporate-focused, so corporate messaging belongs in the use-case strip, the spaces copy, and the lead-form event types. It just no longer *labels* the venue in the hero.
- Do **not** treat "corporate" as the brand name or the H1. The H1 leads with large-capacity / 5-min-from-MCO.

**Capacity claim discipline (read before writing any number).** "400" is a **marketing whole-venue cocktail figure** for the homepage hero/positioning only. It is **never** a booking cap, never a per-space cap, and must **never** be wired into any guest-count validation in the wizard. See 2.4 capacity guard. Any other capacity, square-footage, rate, or phone number is `[PENDING - Glendalys]` until confirmed - do not invent.

### 2.2 Voice & Tone

| Attribute | Direction |
|---|---|
| Voice | Confident, modern, premium-but-approachable. Big-room energy without being loud. |
| Tone on corporate pages | Crisp, logistics-forward (parking, A/V, proximity to MCO, room flexibility). |
| Person | Second person ("your team," "your event"). |
| Language | American English throughout the site body. |
| Avoid | Overclaiming numbers, filler adjectives, and any hardcoded venue facts in copy that the config can supply. |

### 2.3 Metadata & Structured Data

#### Meta tags

| Field | Value |
|---|---|
| Meta title | **Large-Capacity Event Venue in Orlando \| D'Space - 5 Min from MCO** |
| Meta description | **D'Space Orlando is a 6,000 sq ft modern-industrial event venue, 5 minutes from MCO. Host conferences, product launches, and executive meetings - book your weekday date online.** |
| OG title / OG description | Mirror the (finalized) meta title / meta description above. |
| OG image | **[PENDING - Glendalys]** - hero/whole-room shot. |
| Canonical | Self-referencing per page. |

> Builder note: the meta title and meta description above are **final, ship-ready copy** - use them verbatim. The only outstanding metadata item is the OG image asset.

#### schema.org JSON-LD to emit

Emit these types as JSON-LD in the document head. **Improvement over OEV:** every field below is populated from the **venue config object**, not hardcoded into the component (see 2.5).

| Type | Where it lives | Notes |
|---|---|---|
| `EventVenue` | Homepage | Primary entity for the venue. name, address, geo, image from config. |
| `LocalBusiness` | Homepage (can be combined `@graph` with EventVenue) | Carries telephone, address, openingHours, priceRange. **Phone = the ONE consolidated number (2.4).** Hours reflect Mon-Thu operating reality. |
| `FAQPage` | Homepage and/or a dedicated FAQ block | One entry per Q/A pair actually rendered on the page. Do not emit FAQ schema for questions not visible to users. |
| `Offer` (one **per space**) | `/spaces` and each space card | Emit a distinct `Offer` for each of the 4 bookable spaces (Main Conference Area, Executive Mezzanine, Meeting Room, Breakout Rooms). `priceCurrency: USD`, `priceSpecification` = hourly. Pull each hourly rate from config, never literal; carry the per-space rate pending tags from Section 4. |

Verification checklist:

- [ ] All four `Offer` blocks present, one per bookable space, each reading its hourly rate from config.
- [ ] `FAQPage` entries match on-page Q/A exactly (no orphan schema).
- [ ] `LocalBusiness.telephone` equals the single consolidated phone (2.4).
- [ ] No venue name/address/phone string is hardcoded inside the JSON-LD component - all interpolated from config.

### 2.4 Global Booking Rules (Build Gate Checklist)

These rules are **global** and apply to every calendar, every date picker, and every guest field across the homepage, `/spaces`, the lead form, and all five wizard steps. Verify each before merge.

- [ ] **Mon-Thu only.** Friday, Saturday, and Sunday are **disabled in every date picker** (grayed, non-selectable, with a tooltip/helper: weekends handled via the legacy HoneyBook flow). Implement as a shared `isBookableDay(date)` guard so the rule lives in one place, not copy-pasted per calendar. Also disable past dates and fully-booked dates.
- [ ] **Hourly only - no daily.** There is **no hourly/daily toggle** anywhere. The daily-rate concept is removed entirely from the UI. (Removed vs OEV.)
- [ ] **No half-conference split exposed.** Main Conference Area is **full-room only** right now. Do **not** render any split/partition selector. **Build the calendars so a space CAN be subdivided later** (data model leaves room for sub-spaces), but **do not expose** subdivision in this build. (Removed vs OEV.)
- [ ] **4-hour minimum** enforced on **Main Conference Area** and **Executive Mezzanine** time windows. Meeting Room and Breakout Rooms have no minimum (see Section 4). Validate on time-window change, not just on submit.
- [ ] **Capacity guard.** **400 is marketing copy only** (whole-venue cocktail figure). It must **never** be a guest-count cap or validation max in the wizard or lead form. Per-space and whole-event guest caps are `[PENDING - Glendalys]`. Until confirmed, do **not** hard-block on a guest number - accept the input and let admin review handle overages. (This explicitly avoids OEV's hardcoded "90 guests max -> $500 penalty" pattern.)
- [ ] **One consolidated phone.** The site exposes a **single** phone number everywhere (nav, footer, contact, schema, emails). Value = `[PENDING - Glendalys]` (the live site currently shows two - 407-391-6109 and 407-368-9652; use ONE everywhere). **Improvement over OEV:** OEV scattered `407-974-5979` (and other contacts) across 9+ files; D'Space sources the one number from config. Never type a phone literal into a component.
- [ ] **Config-driven identity (no hardcoded venue facts).** Venue name, address, phone, email, capacity figures, hours, per-space hourly rates, and rules/penalties are **all read from a single venue config object** - never hardcoded in React, copy, or JSON-LD. **Improvement over OEV:** hardcoded identity is OEV's #1 tech debt (name/address/phone/capacity/rates baked into 9+ components and every email template). D'Space must fail this check if any venue fact is found as a literal string in a component.

### 2.5 Config-Driven Identity - Builder Contract

**Improvement over OEV (explicit):** introduce one source of truth (e.g. a `venueConfig` object/provider) that every screen, email, and schema block reads from. The following must come from config:

| Config key | Used by | Status |
|---|---|---|
| `name` | nav, hero, footer, schema, lead form consent copy | Locked: D'Space Orlando |
| `address` / `geo` | footer, schema, contact, maps | Locked: 6838 Hoffner Ave #1200, Orlando, FL 32822 |
| `phone` (single) | nav, footer, contact, schema, emails | [PENDING - Glendalys] (one consolidated number) |
| `email` / sender | footer, lead form, transactional email | info@dspaceorlando.com display; sender domain [PENDING - OEV dev]. **Improvement over OEV:** use a **domain-authenticated sender**, not a personal Gmail app-password. |
| `marketingCapacity` (the 400 cocktail figure) | hero/positioning copy ONLY | Marketing-only; never a booking cap. |
| `spaces[]` (4 entries: Main Conference Area, Executive Mezzanine, Meeting Room, Breakout Rooms) | `/spaces`, wizard Step A, schema `Offer` | Names locked; per-space rates/capacities/minimums per Section 4. |
| `bookableDays` (Mon-Thu) | every date picker | Locked: Mon-Thu. |
| `honeyBookUrl` (weekend / tour CTA) | nav secondary button, hero secondary button | [PENDING - Glendalys] |

Verification:

- [ ] Grep the React source for the literal venue name, any phone number, and any street address - **zero hardcoded matches** in components/emails/schema (config interpolation only).
- [ ] Changing one value in `venueConfig` updates the homepage, `/spaces`, footer, schema, and emails consistently - no second place to edit.

---

## 3. Homepage - Section by Section

This is the homepage in **final render order**. Two changes from the original wireframe are baked in: the **Gallery is moved up to position 6** (above the pricing-heavy lower sections), and the **dedicated "Tour band" section is removed** (the tour/weekend CTA now lives only in the nav and hero). Build each section as a standalone component so sections can be reordered later without refactoring.

**Improvement over OEV:** every venue identity value below (name, address, phone, capacities, rates, email) must be read from a single venue-config object, never hardcoded in JSX. OEV hardcodes these across 9+ files - that is the #1 tech debt. Wire each `[PENDING]` token to the config so swapping a value updates everywhere at once.

**Routing rule (applies to every CTA on the page):** every **"Book Mon-Thu"** button routes to the **internal booking flow** (Mon-Thu enforced, Stripe deposit, admin approval, lockbox). Every **"Tour / Weekend"** button routes **OUT to HoneyBook**. Do not wire the hero "up to 400" figure as a booking limit - it is whole-venue cocktail marketing; the bookable Main Conference cap is the per-space number (100, [PENDING - Glendalys]).

### 3.1 Nav (dual CTA)

**Purpose:** Persistent top navigation with the dual booking/tour CTA split. Sticky on scroll.

**Copy:**
- Logo: **D'Space Orlando**
- Links: **Spaces / Pricing / Add-ons / Gallery / FAQ**
- Phone: **[PENDING - Glendalys]** (ONE consolidated number; live site currently shows two - 407-391-6109 and 407-368-9652; use ONE everywhere)
- Primary button: **Book Mon-Thu** -> internal booking flow
- Secondary button: **Tour / Weekend Event** -> HoneyBook (external)

**Layout note:** Logo left; links centered; phone + two buttons right. Primary button solid/filled, secondary button outlined to signal the off-platform jump. Collapse to a hamburger drawer on mobile with both buttons stacked full-width.

### 3.2 Hero

**Purpose:** Above-the-fold positioning as Orlando's large-capacity / 5-min-from-MCO venue, with the dual CTA and a trust reassurance line.

**Copy:**
- Eyebrow: **Large-capacity event venue in Orlando**
- H1 (one per page): **Orlando's large-capacity venue - 5 minutes from MCO**
- Subhead: **6,000 sq ft of industrial-luxe, blank-canvas space for conferences, product launches, and executive meetings. The premier alternative to the convention center and the windowless hotel ballroom.**
- Value chips: **6,000 sq ft** | **Up to 400 guests** | **3.4 mi from MCO** | **Free on-site parking**
- Primary CTA: **Book Mon-Thu** -> internal booking flow
- Secondary CTA: **Schedule a tour / weekend event** -> HoneyBook (external)
- Reassurance: **Reserve online in minutes. Every booking is reviewed and approved before it's final.**

**Layout note:** Full-bleed hero image/video of the main gallery; eyebrow + H1 + subhead stacked left or centered; the four value chips in a single inline row (wrap on mobile); two CTAs side by side with the reassurance line directly beneath. The "Up to 400 guests" chip is display copy only - never wired as a booking cap.

### 3.3 Amenities band

**Purpose:** Fast scannable proof of what's included in one private building.

**Copy:**
- Header: **Everything your event needs, in one private building**
- 6 icon cards:
  1. **6,000 sq ft blank canvas - modern-industrial, black-and-white**
  2. **5 minutes from MCO - 3.4 miles, fly-in / fly-out**
  3. **Up to 400 guests - keynotes, galas, and mixers**
  4. **Free on-site parking - private lot, street-level load-in**
  5. **In-house catering - by D'Loft Kitchen**
  6. **High-speed Wi-Fi - dedicated power, streaming-ready**

**Layout note:** 6 icon cards in a 3x2 grid on desktop, 2x3 on tablet, single column on mobile. Each card = icon + bold lead phrase + supporting clause.

### 3.4 The four spaces

**Purpose:** Present all four bookable spaces, each with capacity, rate, minimum, and its own "Book" CTA. Each card maps to one of the four independent calendars.

**Copy:**
- Header: **Four flexible spaces, one private building**
- Subhead: **Book any space on its own calendar, Monday through Thursday. Take the full venue or just the room you need.**

| Card | Spec line | Body | Button |
|---|---|---|---|
| **Main Conference Area** | 4,345 sq ft - up to 100 guests **[PENDING - Glendalys]** - $450/hr - 4-hour minimum | Our open-plan main gallery: 23-ft black ceilings, polished concrete floors, exposed ductwork, and large industrial windows. Built for keynotes, theater-style sessions, galas, and product reveals - with street-level load-in for heavy equipment and set builds. | **Book the Main Conference Area** |
| **Executive Mezzanine** | 1,345 sq ft - up to 50 guests - $250/hr - 4-hour minimum | A second-floor loft overlooking the main gallery - total acoustic and visual privacy for receptions, executive breakouts, VIP green rooms, and private strategy sessions. | **Book the Mezzanine** |
| **Meeting Room** | Boardroom - up to 6 guests - $150/hr **[PENDING - Luis]** | A private, quiet room for board meetings, interviews, and focused working sessions. | **Book the Meeting Room** |
| **Breakout Rooms** (two private suites) | Two private suites - up to 7 each - $15/hr **[PENDING - Glendalys]** | The two private suites double as quiet breakout rooms - add one or both alongside a main booking for green rooms, syndicate sessions, or prep space. | **Add a Breakout Room** |

**Layout note:** Four cards (2x2 grid desktop, single column mobile), each with an image, spec line, body, and a per-space "Book" button that deep-links into the booking wizard with that space pre-selected. Main Conference is full-room only now - do NOT expose a "half conference" split here.

### 3.5 Why D'Space (proof)

**Purpose:** Differentiation/proof block - the reasons companies choose this venue over the convention center or a hotel ballroom.

**Copy:**
- Header: **Why companies choose D'Space**
  - **Unmatched MCO proximity:** Fly-in, fly-out. From Terminal C and Brightline to your front door in under five minutes.
  - **You own the building:** No competing conference in the next room. The entire private venue is yours for the day.
  - **Privacy & security:** A standalone, private entrance and security keep your board's business in the room.
  - **Industrial-chic brand canvas:** Black-and-white, blank-canvas design that makes your brand - not the venue's carpet - the focus.

**Layout note:** Four points as a 2x2 grid or alternating left/right rows; bold lead-in label followed by the supporting sentence. Optional supporting imagery per point.

### 3.6 Gallery (MOVED UP)

**Purpose:** Visual proof of the space set up for real corporate events. **Moved up from the lower wireframe position to ~position 6** so visitors see the room before the pricing-heavy sections.

**Copy:**
- Header: **Take a look inside**
- Subhead: **6,000 sq ft of modern-industrial space, set up for real corporate events.**
- Tile captions: **Main gallery - keynote setup** | **Executive mezzanine** | **Meeting room** | **Private suites** | **Entrance & street-level load-in** | **On-site parking**
- Button: **See full gallery** -> /gallery

**Layout note:** Responsive masonry or even grid of 6 captioned tiles; lightbox on click. "See full gallery" button below the grid links to /gallery (corporate-first filter).

### 3.7 Pricing

**Purpose:** Transparent per-space hourly pricing, Mon-Thu only, with cleaning and deposit explained and a weekend/full-service cross-sell.

**Copy:**
- Header: **Simple, transparent weekday pricing**
- Subhead: **Per-space hourly rates, Monday through Thursday. No hidden fees - cleaning is shown separately, and you only pay a deposit to hold your date.**

| Space | Capacity | Rate | Minimum |
|---|---|---|---|
| Main Conference | up to 100 **[PENDING - Glendalys]** | $450/hr | 4-hour min |
| Mezzanine | up to 50 | $250/hr | 4-hour min |
| Meeting Room | up to 6 | $150/hr **[PENDING - Luis]** | no min |
| Breakout (each) | up to 7 | $15/hr **[PENDING - Glendalys]** | no min |

- Cleaning fee line: **[PENDING - Glendalys] per booking**
- Deposit line: **Hold your date with a deposit; the balance is due before your event. Payments run securely through Stripe - money goes straight to D'Space.**
- Cross-sell: **Planning a full-service or weekend event? Schedule a tour and we'll build a custom package.** (-> HoneyBook)

**Layout note:** Clean pricing table or four price cards. Cleaning fee + deposit shown as separate lines below the table (not folded into the per-space rate). The cross-sell line gets a secondary "Schedule a tour" link to HoneyBook. **Improvement over OEV:** all rates, the cleaning fee, and the deposit percentage are config-driven - no hardcoded "50%" or dollar figures in the component.

### 3.8 Add-ons

**Purpose:** Show the add-on tiers the client can select during booking. **All add-ons are non-payable** - selecting one fires a backend alert to admin and adds zero charge online.

**Copy:**
- Header: **Build your event - add production, catering, and bar**
- Subhead: **Start with the room, then add what you need. Everything coordinated in-house.**
  - **Production & A/V [coming soon]:** Ground-supported LED video walls, truss-mounted intelligent lighting, professional stage decking, and live-streaming.
  - **Catering by D'Loft Kitchen:** Executive breakfasts, power lunches, and artisan grazing tables - chef-driven and served in-house by our sister brand.
  - **Bar & mixology:** Professional bar service with custom signature cocktails and premium wine, branded to your event.
  - **Extras:** 20-ft drapery, uplighting, tables & chairs, room partition, and setup & breakdown.
- Note: **Each tier includes the one before it. Tell us what you want when you book - we coordinate and quote it (no charge added online).**

**Layout note:** Four tier cards (Production tagged with a "Coming soon" pill). The closing note must make the no-charge-online behavior unmistakable. **Improvement over OEV:** cleaner add-on alert UX - selecting any add-on in the wizard fires a single admin notification (same mechanism as OEV's bar/alcohol alert) with zero price added to the cart.

### 3.9 How it works (5 steps)

**Purpose:** Set expectations for the full booking arc, including the admin approval gate and smart-lock code delivery.

**Copy:**
- Header: **Book your weekday event in 5 steps**
  1. **Pick your space & date** - choose any space, Monday through Thursday.
  2. **Customize** - add production, catering, bar, or extras (we coordinate; nothing extra charged online).
  3. **Sign & pay your deposit** - e-sign and hold your date securely online.
  4. **We confirm** - your booking is reviewed and approved, usually within **[X hours - PENDING - Glendalys]** (approval SLA).
  5. **Get your entry code** - receive smart-lock access and arrival details before your event.

**Layout note:** Horizontal 5-step timeline on desktop (numbered nodes), vertical stepper on mobile. Step 4 must visibly communicate the approval gate (booking is not final until reviewed).

### 3.10 FAQ

**Purpose:** Answer the high-intent questions; feeds the FAQPage schema.

**Copy:**
- Header: **Frequently asked questions**

| Question | Answer |
|---|---|
| How many guests can D'Space hold? | The full venue seats up to 300 banquet-style and holds up to 400 for a standing reception. Per space: Main Conference up to 100 **[PENDING - Glendalys]**, Mezzanine up to 50, Meeting Room up to 6, and each Breakout Room up to 7. |
| Where are you, and how close is the airport? | We're at 6838 Hoffner Ave, #1200, Orlando, FL 32822 - 3.4 miles (about 5 minutes) from MCO, 10 minutes from Lake Nona, and 15 minutes from Downtown Orlando. |
| Do you cater, or can we bring our own food? | We cater in-house through D'Loft Kitchen, and we keep a preferred-caterer list. For safety and licensing, any outside food must come from a licensed restaurant or caterer - no home-prepared food. |
| Do you have A/V and production? | Industrial-grade Wi-Fi, dedicated power circuits, streaming-ready for hybrid meetings. Full production packages - LED walls, intelligent lighting, stage decking - are [coming soon]. |
| What's included in a weekday rental? | Your rental hours, two private suites, tables and chairs, a room partition, 20-ft drapery, uplighting, Wi-Fi, preferred caterers, and bar packages. |
| How does booking and approval work? | You book and pay your deposit online and receive a payment confirmation. Your reservation is final once we review and approve it - then you'll get your confirmation and smart-lock entry code. |
| Is there parking? | Yes - free on-site private parking, plus street-level load-in. |
| What about alcohol and bar service? | Bar service and mixology are available in-house. **[Outside-alcohol policy - PENDING - Glendalys.]** |

**Layout note:** Accordion list (single-open or multi-open). Render each Q/A into FAQPage structured data. Note the deliberate tension between the FAQ "up to 300/400" full-venue marketing figure and the per-space booking caps - keep both as written; do NOT use 300/400 as a booking limit.

### 3.11 Final CTA

**Purpose:** Closing conversion band with the dual CTA repeated.

**Copy:**
- Header: **Host your next corporate event where Orlando does business**
- Subhead: **Conferences, launches, and executive meetings - five minutes from MCO, in a space that's entirely yours.**
- Primary: **Book your Mon-Thu date** -> internal booking flow
- Secondary link: **or schedule a tour** -> HoneyBook (external)

**Layout note:** Full-width contrasting band; centered header + subhead; primary button prominent with the secondary "or schedule a tour" as an inline text link beneath it.

### 3.12 Lead form

**Purpose:** Lead capture for date requests and private tours; posts to the GoHighLevel corporate pipeline with auto follow-up. Full field/consent/routing spec lives in Section 7 (the same reusable component is mounted here and on `/contact`).

**Copy:**
- Header: **Request a date or a private tour**
- Subhead: **Tell us about your event and we'll get right back to you.**
- Fields: **Name\*** | **Company** | **Email\*** | **Phone\*** | **Event type** (Conference/seminar, Product launch, Meeting/boardroom, Workshop/team building, Holiday party, Other) | **Preferred date(s)** | **Month** | **Estimated guests** | **Message**
- Consent 1 (required, pre-checked): **I agree to receive booking-related texts (confirmations, reminders, updates) from D'Space Orlando. Msg & data rates may apply. Reply STOP to opt out.**
- Consent 2 (optional): **I'd like to receive offers and availability updates by text/email from D'Space Orlando. Reply STOP to opt out.**
- Button: **Send request**
- Fine print: **By submitting, you agree to our Privacy Policy and Terms of Use.**

**Dev note:** Posts to GoHighLevel corporate pipeline + auto follow-up. **Improvement over OEV:** OEV's lead forms force two *required* SMS consents and lack Company / Estimated guests / Month / email-consent fields - this form splits consent correctly (SMS required + pre-checked, marketing optional) and captures the full corporate lead profile.

**Layout note:** Two-column field grid on desktop (Name/Company, Email/Phone, Event type/Estimated guests, Preferred date(s)/Month), full-width Message; consent checkboxes stacked below; submit button full-width on mobile. Include a hidden honeypot field for bot filtering.

### 3.13 Footer

**Purpose:** NAP, navigation, service areas, social, and legal.

**Copy:**
- Tagline: **D'Space Orlando - modern-industrial large-capacity event venue, 5 minutes from MCO.**
- Contact: **6838 Hoffner Ave, #1200, Orlando, FL 32822 - [ONE phone - PENDING - Glendalys] - info@dspaceorlando.com**
- Menu: **Spaces / Pricing / Add-ons / Gallery / FAQ / Book Mon-Thu / Tour-Weekend**
- Service areas: **Orlando, Lake Nona, Lee Vista, MCO, Downtown Orlando - free on-site private parking.**
- Socials: **FB / IG / YouTube / Pinterest**
- Legal: **Privacy Policy - Terms of Use - (c) 2026 D'Space Orlando**

**Layout note:** Multi-column footer (tagline + contact, menu, service areas, socials); legal bar pinned at the very bottom. The "Book Mon-Thu" menu item routes internal; "Tour-Weekend" routes to HoneyBook. **Improvement over OEV:** NAP (name, address, single phone, email) reads from the venue-config object - OEV bakes its address and phone into the footer JSX. Wire the LocalBusiness schema NAP from the same config source.

### 3.14 Builder verification checklist

- [ ] Sections render in the exact order above (Gallery at position 6, no Tour band section).
- [ ] Exactly one H1 on the page (the Hero H1).
- [ ] Every "Book Mon-Thu" CTA routes to the internal booking flow; every "Tour / Weekend" CTA routes to HoneyBook.
- [ ] Hero "up to 400" is display copy only - NOT wired as a booking capacity limit.
- [ ] Venue name, address, phone, email, capacities, rates, cleaning fee, and deposit % all read from a single venue-config object - none hardcoded in JSX.
- [ ] All `[PENDING]` tokens are bound to config placeholders and visibly flagged (Glendalys / Luis per tag) before publish.
- [ ] One consolidated phone number used in nav, footer, and schema (not the two currently on the live site).
- [ ] FAQ and pricing emit FAQPage and Offer/PriceSpecification structured data; footer emits LocalBusiness NAP.
- [ ] Lead form consent: Consent 1 required + pre-checked; Consent 2 optional. Form posts to GoHighLevel corporate pipeline.

---

## 4. The Four Bookable Spaces

D'Space exposes **four bookable spaces**, each with its **own independent calendar and availability**. This is the single biggest structural change from OEV, which books one venue against one calendar. Here, a guest can book one space, several spaces, or the whole building for a single event day - and each space tracks its own bookings, blocks, and time-slot conflicts separately.

**Core rules that apply to every space below:**

- **Own calendar per space.** Space A's availability never blocks Space B. Two different spaces can be booked at the same time on the same day. A conflict is only raised when the *same* space is requested for overlapping times.
- **Mon-Thu only.** Every date picker disables Fri/Sat/Sun (plus past dates and that space's booked/blocked dates). Weekend demand routes to HoneyBook via the secondary "Tour / Weekend Event" CTA - never into this flow.
- **Hourly only.** No daily rate, no hourly/daily toggle. *Improvement over OEV:* OEV's `BookingTypeStep` daily toggle and `daily_rate` path are removed entirely.
- **Config-driven identity.** Every name, square footage, capacity, rate, and minimum below is rendered from venue/space config - **never hardcoded in React**. *Improvement over OEV:* OEV bakes name/capacity/rates into `Hero.tsx`, `SpaceHighlights.tsx`, and `Pricing.tsx`; here a builder must wire each value to a config object so a rate change is a config edit, not a code change.
- **Cumulative cart.** Adding a space keeps the same event and same event day; the cart sums `rate × hours` for each space. Cleaning fee is charged once for the booking, not per space.

> **Builder verification - applies to all four spaces:**
> - [ ] Each space renders its own calendar component with its own availability source.
> - [ ] Fri/Sat/Sun are disabled in every space's date picker.
> - [ ] No hourly/daily toggle appears anywhere.
> - [ ] Selecting Space X at 10:00-14:00 does **not** disable that window on any other space.
> - [ ] All specs (sq ft, capacity, rate, minimum) read from config, with no literal strings in the component.

### 4.1 Main Conference Area

| Spec | Value |
|---|---|
| Square footage | 4,345 sq ft |
| Capacity | Up to 100 guests **[PENDING - Glendalys]** (may rise to 150-200) |
| Hourly rate | $450/hr |
| Minimum | 4-hour minimum |
| Own calendar | Yes - independent availability |
| Subdividable? | Full-room only now; calendar built to subdivide later (do not expose) |

**Body copy:**
> Our open-plan main gallery: 23-ft black ceilings, polished concrete floors, exposed ductwork, and large industrial windows. Built for keynotes, theater-style sessions, galas, and product reveals - with street-level load-in for heavy equipment and set builds.

**Booking-card button:** `Book the Main Conference Area`

**Use cases:** Keynotes, theater-style general sessions, galas, product launches and reveals, large mixers, set builds requiring heavy load-in.

**Full-room-only flag (build now, expose later):**
- The Main Conference Area is bookable as a **single full room only**. Do **not** render any "half conference" / split selector. *Improvement over OEV:* this maps to the removed half-conference split.
- However, model the calendar so the space **can be subdivided into independent sub-rooms in a future release** (e.g., two halves with their own time windows). Build the data layer to support sub-spaces; keep the UI collapsed to one full-room option for the pilot.

> **Builder verification - Main Conference Area:**
> - [ ] No split / half-room option is visible.
> - [ ] 4-hour minimum is enforced on submit (start/end window >= 4 hrs).
> - [ ] Capacity number renders from config and is flagged internally as **[PENDING - Glendalys]** until confirmed.
> - [ ] The marketing "up to 400" whole-venue figure is **not** wired as this space's booking limit - the per-space cap (100, pending) is the guard.

### 4.2 Executive Mezzanine

| Spec | Value |
|---|---|
| Square footage | 1,345 sq ft |
| Capacity | Up to 50 guests |
| Hourly rate | $250/hr |
| Minimum | 4-hour minimum |
| Own calendar | Yes - independent availability |

**Body copy:**
> A second-floor loft overlooking the main gallery - total acoustic and visual privacy for receptions, executive breakouts, VIP green rooms, and private strategy sessions.

**Booking-card button:** `Book the Mezzanine`

**Use cases:** Receptions, executive breakouts, VIP green rooms, private strategy sessions, leadership offsites overlooking the main gallery.

> **Builder verification - Executive Mezzanine:**
> - [ ] 4-hour minimum enforced on submit.
> - [ ] Calendar independent from Main Conference Area (can be booked the same day/time).

### 4.3 Meeting Room

| Spec | Value |
|---|---|
| Square footage | Boardroom |
| Capacity | Up to 6 guests |
| Hourly rate | $150/hr **[PENDING - Luis]** (rate under review) |
| Minimum | No minimum |
| Own calendar | Yes - independent availability |

**Body copy:**
> A private, quiet room for board meetings, interviews, and focused working sessions.

**Booking-card button:** `Book the Meeting Room`

**Use cases:** Board meetings, candidate interviews, focused working sessions, small client meetings, breakout overflow for a larger booking.

> **Builder verification - Meeting Room:**
> - [ ] No 4-hour minimum applied (booking can be < 4 hrs).
> - [ ] Rate renders from config and is flagged **[PENDING - Luis]** until confirmed.

### 4.4 Breakout Rooms (Two Private Suites)

| Spec | Value |
|---|---|
| Count | Two private suites (each individually bookable) |
| Capacity | Up to 7 guests **each** |
| Hourly rate | $15/hr **[PENDING - Glendalys]** (rate to confirm) |
| Minimum | No minimum |
| Own calendar | Yes - **each suite has its own calendar** |

**Body copy:**
> The two private suites double as quiet breakout rooms - add one or both alongside a main booking for green rooms, syndicate sessions, or prep space.

**Booking-card button:** `Add a Breakout Room`

**Use cases:** Green rooms, syndicate/breakout sessions, speaker prep, small working groups, add-on space alongside a Main Conference or Mezzanine booking.

**Two-suite structure:**
- These are **two separate bookable suites**, not one. Each suite is its own space with its own calendar - a guest can add **one or both** to an event, and each added suite gets its own start/end window and contributes `$15/hr × hours` **[PENDING - Glendalys]** to the cumulative cart.
- The button copy `Add a Breakout Room` reflects the typical pattern: a breakout suite is most often **added to** a larger booking rather than booked standalone, though standalone booking is allowed.

> **Builder verification - Breakout Rooms:**
> - [ ] Two distinct suite calendars exist; booking Suite 1 leaves Suite 2 fully available.
> - [ ] A single event can include Suite 1 and/or Suite 2, each with its own time window.
> - [ ] No 4-hour minimum applied.
> - [ ] Rate renders from config and is flagged **[PENDING - Glendalys]**.

### 4.5 Pending Items (this section)

| Item | Owner | Status |
|---|---|---|
| Main Conference Area capacity (raise to 150-200?) | Glendalys | **[PENDING]** |
| Meeting Room hourly rate ($150/hr?) | Luis | **[PENDING]** |
| Breakout Room hourly rate ($15/hr?) | Glendalys | **[PENDING]** |

---

## 5. Booking Wizard - Multi-Space, One Event (CORE)

This is the heart of D'Space. It mirrors OEV's proven 6-step wizard (`src/pages/Book.tsx` orchestrator + the `src/components/booking/*Step.tsx` components) but is restructured around **multiple bookable spaces combined into ONE event** with a single cumulative cart and a single deposit. Build the screens exactly as specified below.

**The arc:** `Step A (Spaces & Time) -> Step B (Event Details) -> Step C (Add-ons, non-payable) -> Step D (Sign & Deposit) -> Step E (Admin Gate, off-UI for client)`.

> **Improvement over OEV (architecture):** OEV has NO space selection - every booking targets the single hardcoded venue (`useCreateBooking.ts`, `useBookedDates.ts` assume one calendar). D'Space introduces 4 independent space calendars and a multi-space cart as a first-class concept. The wizard route, step container, and progress bar are reused; the data model and Step A are net-new.

### 5.0 Global wizard shell

| Element | Spec |
|---|---|
| Container | Reuse OEV's `Book.tsx` step orchestrator: a `currentStep` state, a top progress indicator, and `Back` / `Continue` buttons per step. |
| Steps shown in progress bar | `1 Spaces & Time` -> `2 Event Details` -> `3 Add-ons` -> `4 Sign & Pay`. (Step E is admin-only and never appears in the client progress bar.) |
| Running cart panel | Persistent on every step (right rail on desktop, collapsible sticky summary on mobile). Spec in 5.6. |
| Validation library | Reuse React Hook Form + Zod per step (OEV pattern). |
| State persistence | Form data lifted to the wizard container so `Back` never loses input. A user editing from the summary jumps back to the relevant step (OEV's `goToStep` pattern in `SummaryStep.tsx`). |
| Config-driven identity | Venue name, address, phone, support contact, deposit %, rates, minimums, and Mon-Thu rule all read from a single venue config object. **Never hardcode** (see 5.7). |

### 5.1 Step A - Spaces & Time

**Goal:** Let the user assemble one event from one or more spaces, each with its own time window, all on the same event date.

#### Screen layout
- Header: "Choose your space(s)" + helper "Add as many spaces as you need for your event. Each space gets its own start and end time."
- A repeatable **Space Line block**. The first block is shown by default. Below the last block, a `+ Add another space` button.
- Each Space Line block contains, in order:

| Field | Control | Behavior / Validation |
|---|---|---|
| Space | Selector (4 options): **Main Conference Area**, **Executive Mezzanine**, **Meeting Room**, **Breakout Rooms** (two private suites) | Required. A space already chosen in another active line is disabled/greyed in this line's selector (no duplicate space in one event). Show capacity + hourly rate from config under each option - never hardcoded. |
| Event date | Calendar popover (reuse OEV `Calendar` from `BookingTypeStep.tsx`) | Required. **Mon-Thu only** (see 5.2). The FIRST space sets the shared event date; subsequent space blocks inherit it and show it read-only with a note "All spaces share one event date." See open question in 5.11. |
| Start time | Time input | Required. Hourly only (see 5.3). |
| End time | Time input | Required. Must be after start. **4-hour minimum on Main Conference Area and Executive Mezzanine** (config-driven `min_hours` per space; Meeting Room and Breakout Rooms have no 4-hr floor unless config says so). |
| Per-space availability | Inline conflict check | On date/time change, run a **per-space** availability check (this space's calendar only). Show inline error "This time conflicts with an existing booking for {space}. Pick another window." Disable `Continue` while any line conflicts. |
| Line subtotal | Read-only | `space.hourly_rate x hours`, updates live; also feeds the cart panel. |
| Remove | `x Remove` (only when >1 line) | Removes the line; recomputes cart. |

#### Behavior - "Add another space"
- Clicking `+ Add another space` appends a new empty Space Line **within the same event** and the **same event date**.
- Each added space carries its **own start/end window** (windows may differ and may overlap across different spaces).
- Cost is **cumulative**: cart subtotal = sum over all lines of `(space hourly_rate x that line's hours)`. See 5.6.
- A space already used in another line is not selectable again in the new line.

#### Per-space, independent availability rules
- Availability is checked **per space**, never cross-space. OEV's `isTimeRangeAvailable()` (`useBookedDates.ts`) blocks one shared calendar; D'Space runs the same logic scoped to each space's own calendar.
- **Overlapping times on DIFFERENT spaces are allowed** (e.g., Main Conference 9:00-13:00 and Meeting Room 10:00-14:00 on the same day is valid).
- A conflict is only raised when the SAME space's chosen window collides with an existing paid/blocked booking on that space for that date.

> **Improvement over OEV:** OEV's daily booking type blocks the ENTIRE day (`isDateFullyBooked()`), and there is one venue so any booking locks everyone out. D'Space is hourly-only and per-space, so the same date/time can be sold across different rooms - materially more inventory from the same building.

#### REMOVED controls vs OEV (must NOT appear)
| Removed control | OEV source | D'Space behavior |
|---|---|---|
| **Hourly / Daily toggle** | `BookingTypeStep.tsx` RadioGroup (`bookingType: "hourly" \| "daily"`) | Gone. Hourly is the only mode. Do not render the toggle. Treat all bookings as hourly internally. |
| **Daily 24-hr / full-day option** | `BookingTypeStep.tsx`, `isDateFullyBooked()` daily path | Gone. No daily rate exists in D'Space config. |
| **Half-conference split selector** | (Pricing/space split concept) | Not exposed. Main Conference Area is full-room only now. **Build the calendar so the space CAN be subdivided later, but do NOT surface any split UI in this pilot.** |
| **`?type=hourly\|daily` URL param** | `Book.tsx` deep-link | Not needed. If present, ignore the daily branch. |

> **Improvement over OEV:** removing the daily toggle eliminates the OEV ambiguity where a "daily" booking silently blocked the whole calendar. D'Space is one consistent hourly mental model.

### 5.2 Mon-Thu-only date picker (every calendar)

Applies to **every** date picker in the wizard (each space line) and to the lead form / contact pages.

Disabled dates = **past dates** + **fully-booked-for-that-space dates** + **Friday, Saturday, Sunday**.

| Behavior | Spec |
|---|---|
| Weekend disable | Add an `isMonThursday(date)` check to the calendar's `disabled` predicate. Fri/Sat/Sun render greyed and unclickable. |
| Weekend tooltip/copy | On a disabled weekend day (or below the calendar): "Mon-Thu bookings only. For Fri-Sun events, [book a weekend date] -> HoneyBook." Link out to HoneyBook (secondary CTA, consistent with nav/hero). **Note:** this is net-new UX copy with no locked source string - the team should sign off since it routes users off-platform to HoneyBook. |
| Past dates | Disabled (OEV parity). |
| Per-space sold-out dates | A date with no remaining availability **for that specific space** is disabled in that space's calendar only - not globally. |

> **Improvement over OEV:** OEV has no weekday restriction. D'Space cleanly fences the Mon-Thu corporate pilot in the picker itself, and routes weekend demand out to the legacy HoneyBook flow instead of failing silently.

### 5.3 Hourly-only time pickers

- Each space line has **Start time** and **End time** inputs (reuse OEV's time inputs from `BookingTypeStep.tsx`).
- 4-hour minimum enforced on **Main Conference Area** and **Executive Mezzanine** via config `min_hours` (OEV hardcoded the 4-hr rule in the Zod `refine`; D'Space reads it per space).
- End must be after start; show "End time must be after start time."
- Live conflict detection per space (OEV `isTimeRangeAvailable` parity, scoped per space).
- No daily/24-hr path anywhere.

### 5.4 Step B - Event Details

Mirrors OEV `GuestsEventStep.tsx`, extended for multi-space headcount splitting.

| Field | Control | Validation / Behavior |
|---|---|---|
| Total guests | Number input | Required. Min 1; max from config (do not hardcode a 90 cap as OEV does in `Hero.tsx`/`GuestsEventStep.tsx`). |
| Guest split helper | Small allocator UI listing each selected space with an editable headcount per room | **Improvement over OEV (new):** lets the host distribute total guests across the chosen rooms (e.g., 60 in Main Conference, 12 in Meeting Room). Sum of per-room counts should reconcile to Total guests; show a soft warning if they don't match, not a hard block. Used by admin for setup; not a payment input. |
| Event type | Dropdown | Required. Fixed list (corporate-leaning for the pilot) + "Other". Reuse OEV's dropdown pattern. |
| Description / message | Textarea | Required. Min ~10 chars (OEV parity), max ~1000. Placeholder prompting agenda, AV needs, setup notes. |

`Continue` validates all fields, writes to wizard state, advances to Step C.

### 5.5 Step C - Add-ons (LAST step before signing; NON-PAYABLE)

Mirrors OEV `AddOnsStep.tsx` selection UX, but **every add-on is zero-charge**. Selecting one only fires a backend **admin alert** (exactly like OEV's existing bar/alcohol notification path - `stripe-webhook` internal email + `booking_events` log).

#### Add-on groups (selection only, no price in cart)
| Group | Items | UI note |
|---|---|---|
| Production / AV | Production package(s) | Show as **[Coming soon]** - visible, selectable to express interest, clearly flagged not yet bookable. |
| Catering | **Catering by D'Loft** | Select to request. |
| Bar & mixology | Bar service interest | Select to request (no per-guest pricing shown - that was OEV's paid model). |
| Extras | Drapery, uplighting, tables/chairs, room partition, setup/breakdown | Multi-select checkboxes. |

#### Non-payable behavior (build exactly)
- Selecting any add-on adds **$0.00** to the cart. Do **not** add to subtotal, deposit, or balance.
- Show a persistent banner on this step: **"Add-ons are not charged here. We'll follow up to coordinate and quote each item you select."**
- Each selected add-on renders in the cart/summary as a line labeled **"(Selected for coordination - no charge)"** with `$0.00`, never hidden.
- On booking creation, fire ONE admin alert listing every selected add-on + guest count + booking reference (reuse OEV's internal-email + `booking_events` `addon_selected` pattern).

> **Improvement over OEV (add-on UX + pricing model):** OEV CHARGES add-ons - production `$79-$149/hr`, bar `$18-$40/guest`, setup `$100`, tablecloths `$5 + $25` (`AddOnsStep.tsx`, `useBarPackages.ts`). D'Space makes them all alert-only via a config flag (`is_payable=false`), so the cart math stays clean and the team coordinates/quotes off-line. The alert is a single consolidated notification instead of OEV's payment-time-only email - admin learns of coordination needs at booking, not at checkout.

> **Important (summary display fix carried from OEV):** OEV's `SummaryStep.tsx` hides the bar line when `barSubtotal === 0`. For D'Space, **invert that**: when an add-on is selected, always render the line at `$0.00` with the coordination label so it is never dropped.

### 5.6 Running cart / summary panel (persistent, every step)

A right-rail (desktop) / sticky collapsible (mobile) panel visible on all steps. Replaces OEV's single-line `SummaryStep` total with a multi-space breakdown.

#### What it shows
```
YOUR EVENT
Event date: {shared Mon-Thu date}

SPACES
- Main Conference Area   9:00a-1:00p   4 hrs x ${rate}   = $XXX
- Meeting Room          10:00a-2:00p   4 hrs x ${rate}   = $XXX
                                       Spaces subtotal     $XXXX

ADD-ONS (coordination only)
- Catering by D'Loft     (Selected for coordination - no charge)   $0.00
- Uplighting             (Selected for coordination - no charge)   $0.00

SUBTOTAL                                                    $XXXX
Deposit due today (80%)                                     $XXXX
Balance due before event (20%)                              $XXX
```

#### Calculation rules
| Line | Formula |
|---|---|
| Per-space line subtotal | `space.hourly_rate x hours` |
| Spaces subtotal | sum of all space line subtotals |
| Add-ons | always `$0.00` (non-payable) |
| **Subtotal** | spaces subtotal (+ any config-driven shared fee, e.g., cleaning, charged once - NOT per space) |
| **Deposit due today** | `Subtotal x deposit_percentage` where `deposit_percentage` is config-driven (default **80%** for D'Space) |
| **Balance due before event** | `Subtotal - deposit` (the remaining **20%**) |
| Processing fee | If applicable, config-driven %, shown on the deposit line at pay step (OEV parity - do not hardcode 3.5%). |

> **Deposit/split clarity:** Two different "80/20"s exist - keep them separate in code and copy.
> - **Client-facing 80/20 = deposit vs. balance.** Client pays an **80% deposit now**, **20% balance** before the event. (OEV uses 50/50 via `deposit_percentage`; D'Space sets that config value to 80.)
> - **Stripe Connect 80/20 = platform vs. venue payout.** On every charge, 20% transfers to the connected venue account, 80% to the platform (`create-checkout/index.ts`, `create-balance-payment-link/index.ts`, `stripe-webhook/index.ts`). This is backend money-movement and is invisible to the client. Do not conflate it with the deposit split in any UI copy.

> **Improvement over OEV:** OEV's cart is one cumulative total for a single venue/date. D'Space itemizes every space (name, window, hours, rate, line subtotal) so the host sees exactly what each room costs in one combined invoice - and the shared cleaning/fee is charged once, not multiplied per room.

### 5.7 Step D - Sign & Deposit

Mirrors OEV `ContactPoliciesStep.tsx` + `PaymentStep.tsx`, condensed into the final step.

#### D-1 E-sign agreement
| Element | Spec |
|---|---|
| Contact fields | Full name, email, phone (auto-format), company (optional) - OEV parity. |
| Policies | Scrollable venue rules + fee schedule, sourced from **config** (OEV hardcodes the entire penalty matrix in `send-booking-confirmation/index.ts` - do not). |
| Required agreement checkbox | "I agree to the venue rules and terms." |
| SMS consent checkbox | Required (booking-related SMS). |
| Signature | Canvas signature (mouse + touch) + initials + signer name (auto-filled) + auto-dated, read-only date. Reuse OEV canvas + `Clear` button. |

#### D-2 Stripe deposit
| Element | Spec |
|---|---|
| Amount | **80% deposit** of Subtotal (config `deposit_percentage`), + processing fee if configured. Display dynamically as "Deposit due today ({deposit_percentage}%)" - **do not hardcode the percentage** in the string. |
| Balance note | "Remaining 20% balance due before your event." Timing is config-driven (OEV hardcodes "15 days before"). |
| Stripe call | Reuse OEV `create-checkout` (80/20 **platform/venue** Connect split, `setup_future_usage: off_session` so the balance can auto-charge later). |
| Post-pay | On `session_id` return, confirm and show the **"PENDING - not yet confirmed"** state (see 5.9) with the reservation reference. |

> **Improvement over OEV (deposit % correctness):** OEV hardcodes "50% Deposit" text in `PaymentStep.tsx` (lines 123/170/177/204) and `HowItWorks.tsx`, which drifts when the DB value changes. D'Space must render `{deposit_percentage}%` everywhere from config - single source of truth.

After payment the booking is created with **status = pending_review** / lifecycle **pending** (OEV `useCreateBooking.ts`) and payment **deposit_paid**. The client is explicitly told it is **not yet confirmed** - approval is gated by admin (Step E).

### 5.8 Step E - Admin gate (off-UI for client; spec the states)

The client does not see this step, but the wizard's terminal state depends on it. Mirror OEV's approval mechanics (`BookingDetail.tsx` + `trigger-booking-automation` + `cancel-booking`).

| Stage | Trigger | What fires | OEV source |
|---|---|---|---|
| Admin review | Booking lands in lifecycle `pending` | Admin opens detail, sees a **Confirmation Checklist** (NOT a single approve button): (1) Schedule availability, (2) Staffing availability, (3) **No overlaps across the selected spaces** for this event. | `BookingDetail.tsx` checklist |
| **APPROVE** | All checklist items checked / "Mark as Ready" | Lifecycle -> `pre_event_ready`; automations fire: client **confirmation**, **calendar invite** (via GHL sync), **smart-lock / lockbox code** made available, **balance reminder(s)** scheduled. | `trigger-booking-automation`, `sync-to-ghl`, `schedule-balance-payment` |
| **DECLINE** | Admin cancels | **Auto-refund** of the deposit + an **alternative-date offer** to the client; status -> `cancelled`, scheduled jobs + space availability blocks cleaned up. | `cancel-booking` |

> **Improvement over OEV (two real gaps to close for D'Space):**
> 1. **Refund automation.** OEV's `cancel-booking` sets status but does **not** trigger a Stripe refund (must be done manually in the dashboard). D'Space's decline path must actually **issue the Stripe refund** programmatically and set payment status `refunded`.
> 2. **Alternative-date offer.** OEV has no alternative-date automation (customer must rebook manually). D'Space's decline email should include an **alternative-date CTA** back into the wizard.
> Also: the checklist's "No event conflicts" item must validate **per space across all spaces in the event**, not a single venue.

### 5.9 States the client sees (terminal + lifecycle)

| Client-facing state | When | What the client sees | Underlying (OEV mapping) |
|---|---|---|---|
| **In progress** | During Steps A-D, pre-payment | Wizard with live cart; no booking yet. | not yet persisted (lead guard skips GHL until paid) |
| **Pending - not yet confirmed** | Deposit paid, awaiting admin | Reservation reference + banner: "Deposit received. Your booking is PENDING and not yet confirmed - we'll confirm within [PENDING - Glendalys] hours." | status `pending_review` / lifecycle `pending`, payment `deposit_paid` |
| **Approved / Confirmed** | Admin completes checklist | Confirmation page/email + calendar invite + access-code retrieval link (entered by reservation # or email on the access-code page). | lifecycle `pre_event_ready`; `sync-to-ghl`, `AccessCode.tsx` |
| **Balance due** | Before event (config timing) | Balance reminder(s) with payment link (OEV sends 2-3 reminders by notice window, not one). | `schedule-balance-payment` |
| **Declined / Refunded** | Admin declines | "Unfortunately we couldn't confirm this date. Your deposit has been refunded." + alternative-date CTA. | `cancel-booking` -> status `cancelled`, payment `refunded` |

> **Note on status modeling:** OEV carries two status fields - `status` (Supabase enum, surfaced to GHL) and `lifecycle_status` (internal workflow). **For D'Space client UI, surface only the lifecycle-style labels above** (Pending / Confirmed / Declined) to avoid the dual-enum confusion flagged in the OEV digest.

### 5.10 Builder verification checklist

- [ ] Every date picker disables Fri/Sat/Sun (Mon-Thu only) + past dates + per-space sold-out dates.
- [ ] No hourly/daily toggle, no daily option, no half-conference split control anywhere.
- [ ] `+ Add another space` keeps the same event + same event date; each line has its own start/end window.
- [ ] A space already chosen cannot be re-selected in another line.
- [ ] 4-hour minimum enforced on Main Conference Area and Executive Mezzanine (from config), not others.
- [ ] Overlapping times on DIFFERENT spaces are allowed; same-space conflicts are blocked with inline error.
- [ ] Cart lists each space (name, window, hours, rate, line subtotal), a single shared fee (once), Subtotal, Deposit (80%, dynamic), Balance (20%).
- [ ] All add-ons add $0.00, show "(Selected for coordination - no charge)", and fire ONE consolidated admin alert.
- [ ] Production/AV shown as [Coming soon]; Catering by D'Loft, Bar, Extras selectable.
- [ ] Deposit % rendered from config everywhere (no hardcoded "50%"/"80%" strings).
- [ ] Post-payment shows "PENDING - not yet confirmed" with reservation reference.
- [ ] Admin decline path issues a real Stripe refund AND offers an alternative date.
- [ ] No venue name/address/phone/capacity/rates hardcoded in React - all from venue config.

### 5.11 Open questions to confirm with team

- **[PENDING - OEV dev] Shared event date assumption.** Step A assumes **all spaces in one event share a single event date**, with per-space time windows allowed. Confirm this is correct. If a host must book Space A on Tuesday and Space B on Wednesday under "one event," that requires either multi-date events or treating them as separate bookings - flag before build. (Current spec: one date, per-space windows.)
- **[PENDING - OEV dev] Shared fees scope.** Confirm whether the cleaning/shared fee is charged **once per event** (current spec) vs. per space, and whether any add-on would ever become payable later.
- **[PENDING - Glendalys] Pending-confirmation SLA copy** ("we'll confirm within ___ hours") and balance-due timing window (config value).
- **[PENDING - team] Per-space rates, capacities, and 4-hr-minimum flags** - populate venue config; do not invent values.

---

## 6. Booking + Operations State Machine

D'Space runs the **same 8-stage pipeline as OEV**, refined for the Mon-Thu corporate pilot. The pipeline tracks one event from first lead to post-event review. Two stages are **ADMIN GATES** (no booking is ever auto-confirmed): Stage 4 holds the booking after deposit, and Stage 5 is the human approve/decline decision.

**Improvement over OEV:** OEV exposes two parallel status fields (`status` for the GHL/Supabase enum and `lifecycle_status` for the internal workflow), which confuses operators. D'Space surfaces a **single lifecycle status in the UI**. Every config value referenced below (approval-timer length, balance-reminder cadence, day-before timing, sender identity, lockbox contact) must be **config-driven per venue** - not hardcoded as OEV does today.

### 6.1 Pipeline Overview

| # | Stage | Lifecycle Status | Gate? |
|---|-------|------------------|-------|
| 1 | Inquiry / Lead | `lead` | - |
| 2 | Nurture / Tour (optional) | `lead` (nurturing) | - |
| 3 | Booking in progress | `in_progress` (no record yet) | - |
| 4 | Deposit paid - pending approval | `pending` | **GATE 1** |
| 5 | Admin decision | `pending` -> `confirmed` OR `cancelled` | **GATE 2** |
| 6 | Confirmed -> operations | `confirmed` / `pre_event_ready` | - |
| 7 | Balance / paid in full | `pre_event_ready` (payment_status -> `fully_paid`) | - |
| 8 | Event -> post-event | `in_progress` -> `post_event` -> `closed` | - |

### 6.2 Stage-by-Stage Responsibilities

| Stage | Client sees | Admin does | Staff does | System automation |
|-------|-------------|------------|-----------|-------------------|
| **1. Inquiry / Lead** | Lead-capture form (Name*, Company, Event type, Preferred date(s), Estimated guests, Month, Email*, SMS consent req, email consent opt) or HoneyBook hand-off for Fri-Sun. Sees "We'll follow up" confirmation. | Receives lead notification; reviews in dashboard. | - | Lead synced to GHL via `/contacts/upsert` (fire-and-forget, tagged). Internal email to admin. **Lead guard:** unpaid leads do NOT pollute the calendar. |
| **2. Nurture / Tour (optional)** | Optional follow-up email/SMS. **Tour / weekend CTA is a SECONDARY button** in nav + hero linking OUT to HoneyBook (no dedicated tour band). | Sends quote/answers, optionally schedules tour in HoneyBook. | - | GHL nurture workflows. No D'Space-side automation required at pilot. |
| **3. Booking in progress** | Multi-space wizard (Steps A-D): pick space(s) + Mon-Thu date + per-space start/end, split guests, pick event type, select add-ons (zero-charge), e-sign. No booking record persisted until deposit. | - (self-serve) | - | Per-space availability check (Mon-Thu only; per-space conflict detection; same time allowed on different spaces). Cumulative cart = SUM(space rate x hours). **Tentative hold** on selected slots during checkout. |
| **4. Deposit paid - pending approval** **[GATE 1]** | Status banner: **"PENDING - not yet confirmed."** Reservation number shown. Client warned the date is NOT locked until admin approves. | Booking lands in dashboard queue as `pending`. | - | On Stripe success (webhook): booking persisted with status `pending_review` / lifecycle `pending`, `payment_status=deposit_paid`. **Stripe 80/20 split** (20% to connected venue account, 80% platform) + processing fee, exact charged amounts persisted. Hold **firms to pending**. **Approval-timer** starts ([PENDING - OEV dev: define SLA, e.g. 24-48h]). Admin alerted. |
| **5. Admin decision** **[GATE 2]** | No client-facing UI change while admin decides. On outcome, receives either confirmation or decline+refund email. | Opens booking, works the **Confirmation Checklist** (3 items): (1) Schedule availability, (2) Staffing availability, (3) No event conflicts - checked across ALL selected spaces. **APPROVE** = all 3 checked / "Mark Ready." **DECLINE** = Cancel Booking + offer alternative date. | - | **APPROVE:** lifecycle -> `pre_event_ready` fires 3 automations (host-report reminders, guest-feedback schedule, balance-payment schedule + calendar invite via GHL sync). **DECLINE:** `cancel-booking` sets status `cancelled`, deletes scheduled jobs + availability blocks, sends cancellation email. **Improvement over OEV:** decline triggers **auto-refund (Stripe)** + **alternative-date offer** (OEV does neither today - refunds are manual, no alt-date). |
| **6. Confirmed -> operations** | Confirmation email + **calendar invite**. **Smart-lock / lockbox code** retrievable via self-service Access Code page (by reservation # or email) - code NOT emailed. | Assigns staff/vendors for any selected add-ons (add-ons are coordination-only alerts, not charges). | Sees assignment + booking detail (spaces, times, guest split, access window). | Calendar invite via GHL sync. Lockbox code scheduled/available post-approval. Add-on alert emails already fired to admin at selection (zero-charge coordination). |
| **7. Balance / paid in full** | Receives balance reminder(s) with payment link before event; status -> paid in full once paid. | Monitors balance status; can resend link. | - | **Balance reminders:** <=[PENDING - OEV dev: notice threshold, OEV default 15d] = link now + 1 retry; > threshold = 3 retries (T-15d 9AM, +48h, +48h). On payment, `payment_status -> fully_paid`; revenue items populated. Saved card enables auto-charge. **All timings config-driven per venue.** |
| **8. Event -> post-event** | Day-before reminder + access details. Post-event: thank-you + review/feedback request via self-service page. | Reviews host report; closes out. | Executes setup/breakdown; on-site ops; submits host report. | **Day-before reminder** scheduled. Lifecycle auto-transitions to `in_progress` on event date at start time, then `post_event`. **Release/expire lockbox code** after event window. Guest-feedback + review requests fire. Booking -> `closed` when post-event tasks complete. |

### 6.3 Gate Behavior - Builder Checklist

- [ ] No booking auto-confirms. After deposit, status is **strictly** "PENDING - not yet confirmed" until GATE 2 clears.
- [ ] GATE 1 (Stage 4): deposit captured via Stripe **80/20 split** + processing fee; booking persisted as `pending`; approval timer started.
- [ ] GATE 2 (Stage 5): approval is the **3-item Confirmation Checklist** (not a single approve button), evaluated across ALL selected spaces.
- [ ] APPROVE path fires: confirm + calendar invite + lockbox code availability + balance-reminder schedule.
- [ ] DECLINE path fires: **auto-refund (Stripe)** + cancellation email + **alternative-date offer** + cleanup of scheduled jobs and availability blocks. *(Both are improvements over OEV.)*
- [ ] Single lifecycle status shown in admin UI (do not surface the dual `status`/`lifecycle_status` split). *(Improvement over OEV.)*
- [ ] Lockbox code delivered via self-service Access Code page, never embedded in email. Code **released/expired** after the event window.
- [ ] Day-before reminder and thank-you/review request scheduled automatically.
- [ ] All timer/cadence/sender/contact values pulled from venue config - nothing hardcoded. *(Improvement over OEV.)*

### 6.4 Automation Summary (fires in order)

1. **Checkout success** -> tentative hold firms to `pending`; Stripe 80/20 split + fee captured; approval timer starts; admin alerted.
2. **Approve (GATE 2)** -> `pre_event_ready`: confirmation email, calendar invite, lockbox code availability, balance-payment schedule, host-report + guest-feedback schedules.
3. **Decline (GATE 2)** -> `cancelled`: **auto-refund**, cancellation email, **alternative-date offer**, scheduled-job + availability-block cleanup.
4. **Pre-event** -> balance reminder(s) per config cadence; **day-before reminder**.
5. **Event day** -> auto-transition to `in_progress`.
6. **Post-event** -> **release/expire lockbox code**; thank-you + review/feedback request; transition to `post_event` -> `closed`.

> **[PENDING - OEV dev]** Approval-timer SLA length, balance-reminder threshold/cadence per venue, and lockbox-code release timing must be set in venue config before launch.
> **[PENDING - Glendalys]** Refund policy wording and alternative-date offer copy for the decline path.

---

## 7. Lead-Capture Form & Supporting Pages

This section specs the **lead-capture form** (reused on the homepage and `/contact`) and the three supporting pages (`/spaces`, `/gallery`, `/contact`), plus the handling for the out-of-scope `/weddings` and `/social-events` pages.

> **Improvement over OEV:** OEV runs three *different* lead forms (ContactForm, DiscountPopup, booking ContactPoliciesStep) with inconsistent field sets and consent models. D'Space uses **ONE reusable lead-form component** mounted in two places (homepage section + `/contact`). All venue identity in copy (name, address, phone, email) must be **config-driven**, never hardcoded - OEV hardcodes "Orlando Event Venue," the address, and the phone across both the form's SMS-consent string and the footer in 9+ files. Build the form so the venue name in the consent text and the NAP block read from a single config object.

### Part A - Lead-Capture Form

**Section header:** "Request a date or a private tour"
**Subhead:** "Tell us about your event and we'll get right back to you."

This is a **lead form, not the booking wizard.** It does NOT take payment, signatures, or hold a date. It captures intent and routes to the corporate sales pipeline. The "Book Mon-Thu" CTA elsewhere on the site goes to the booking flow; this form is for people who want a follow-up, a quote, or a tour.

#### Fields

| # | Field | Required | Type / Control | Notes |
|---|-------|----------|----------------|-------|
| 1 | Name | **Yes** | Single text input | Full name. Map to GHL `firstName`/`lastName` by splitting on first space (OEV pattern). |
| 2 | Company | No | Single text input | Optional. Corporate-pilot signal - keep prominent, not buried. |
| 3 | Email | **Yes** | Email input | Validate format. Primary contact + GHL `email`. |
| 4 | Phone | **Yes** | Tel input, auto-format | Auto-format to `(XXX) XXX-XXXX`; normalize to `+1XXXXXXXXXX` on submit for GHL (OEV pattern). Required for SMS follow-up. |
| 5 | Event type | No | Dropdown (select) | Options below. |
| 6 | Preferred date(s) | No | Text input or date-range picker | Free-text acceptable for a lead (e.g., "week of June 15" or two dates). Do NOT enforce Mon-Thu here - this is a lead, not a booking. |
| 7 | Month | No | Dropdown (Jan-Dec) | Helps sales triage seasonality. Keep even though it overlaps with "Preferred date(s)" - per spec. |
| 8 | Estimated guests | No | Number input | Plain integer. No min/max gate on a lead. |
| 9 | Message | No | Textarea | Free-form. No 10-char minimum (that gate belongs to the booking wizard, not the lead form). |

**Event type dropdown options (exact):**
- Conference / seminar
- Product launch
- Meeting / boardroom
- Workshop / team building
- Holiday party
- Other

> **Improvement over OEV:** OEV's ContactForm and DiscountPopup are missing Company, Estimated guests, and Month entirely, and have no dropdown that matches the corporate use-cases. This form captures all corporate-triage fields in one place.

#### Consent checkboxes

| # | Checkbox | State | Exact string |
|---|----------|-------|--------------|
| 1 | SMS / transactional | **Required, pre-checked** | "I agree to receive booking-related texts (confirmations, reminders, updates) from D'Space Orlando. Msg & data rates may apply. Reply STOP to opt out." |
| 2 | Marketing | **Optional, unchecked** | "I'd like to receive offers and availability updates by text/email from D'Space Orlando. Reply STOP to opt out." |

> **Improvement over OEV:** OEV's ContactForm makes BOTH consent boxes required (transactional SMS **and** marketing SMS), which is a compliance smell - you cannot force marketing opt-in. D'Space splits them correctly: transactional **required**, marketing **optional**. Note the venue name "D'Space Orlando" in both strings must come from config, not be hardcoded (OEV hardcodes the venue name inside its consent copy).

**Validation:**
- Block submit if Name, Email, Phone are empty, or if the required SMS-consent box is unchecked.
- Email must pass format validation; phone must be a plausible 10-digit US number.
- Include a hidden **honeypot field** (`website`, `display:none`) - if filled, return a silent success (HTTP 200) without processing, to starve bots without tipping them off. (Direct OEV ContactForm parity.)

**Submit button:** "Send request"

**Fine print (below button):** "By submitting, you agree to our Privacy Policy and Terms of Use." Link "Privacy Policy" -> `/privacy`, "Terms of Use" -> `/terms` (config-driven URLs).

**Submit states checklist:**
- [ ] Default: button enabled, label "Send request."
- [ ] Submitting: button disabled, spinner/label "Sending..."; form fields locked.
- [ ] Success: replace form with confirmation message (e.g., "Thanks - we got your request and we'll be in touch shortly."). Do NOT clear into a blank form silently.
- [ ] Error (network/server): inline error, keep field values, allow retry. Never lose the user's typed data.
- [ ] Honeypot tripped: show the success state (silent drop).

#### Routing / dev behavior

> **Dev note:** Posts to the **GoHighLevel corporate pipeline** and triggers an auto follow-up.

Ground this in the OEV lead/GHL integration:

- On submit, the form hits a backend function (D'Space analog of OEV's `send-contact-form`) that:
  1. Sends an internal notification email to the **D'Space sales inbox** - **[PENDING - Glendalys]** (confirm alert inbox). **Improvement over OEV:** send from a **domain-authenticated sender** (e.g., `info@dspaceorlando.com`), not OEV's fragile personal-Gmail app-password setup.
  2. **Fire-and-forget** upsert to GHL via `/contacts/upsert` (do not block the UI on the GHL call; log failures to console but still return success to the user - OEV pattern).
- **GHL payload:** `firstName`, `lastName`, `email`, formatted `phone` (`+1XXXXXXXXXX`), plus **tags**. Tag the contact into the **corporate pipeline** (e.g., `corporate-lead` + an `event-type:<value>` tag derived from the Event type field, mirroring OEV's `event-type:` tagging).
- **Improvement over OEV:** OEV syncs only firstName/lastName/email/phone/tags and drops Company, Estimated guests, Month, and Preferred dates (they live only in local Supabase, never reach GHL). For D'Space, push **Company, Estimated guests, Month, and Preferred date(s) into GHL custom fields** so sales sees full context in the CRM, not just a name and a tag.
- GHL auth: Bearer token via env var (OEV uses `GHL_PRIVATE_API_KEY` + `GHL_LOCATION_ID`, API version `2021-07-28`). Endpoint: `https://services.leadconnectorhq.com/contacts/upsert`.
- **Auto follow-up** is handled by a GHL workflow on the corporate pipeline (outside this build) - the form's only job is to land the tagged contact with full custom-field context so that workflow can fire.

### Part B - Supporting Pages

#### `/spaces` - "The Venue"

- **H1 (one per page):** "Four flexible spaces in one 6,000 sq ft building"
- **Intro:** "Modern-industrial blank canvas - 23-ft black ceilings, polished concrete, exposed ductwork, large industrial windows, ornate chandelier. Configure as one venue or book a single space."
- **Four space blocks** (reuse the homepage space-card content; one block per space): Main Conference Area, Executive Mezzanine, Meeting Room, Breakout Rooms (two private suites). Each block carries its capacity, hourly rate, minimum (where applicable), body copy, and a per-space CTA. Carry forward every `[PENDING]` marker from the homepage cards (Main Conference capacity = `[PENDING - Glendalys]`, Meeting Room rate = `[PENDING - Luis]`, Breakout rate = `[PENDING - Glendalys]`) - do not resolve or invent them here.
- **Use-cases** per space (keynote/theater/gala for Main; receptions/VIP green rooms/strategy for Mezzanine; board meetings/interviews for Meeting Room; green rooms/syndicate/prep for Breakouts).
- **Included amenities list:** The COPY DECK lists the rental-hours item verbatim as **"8 or 12 hours"** rental. This conflicts with the LOCKED pricing model, which is **hourly with a 4-hour minimum**, not fixed 8/12-hour packages - so the standard rental-hour blocks are **[PENDING - Glendalys: confirm standard rental-hour blocks]** and must be reconciled before publish. Remaining included amenities: 2 private suites, tables & chairs, catering menus, bar packages, room partition, 20-ft drapery, uplighting, Wi-Fi, preferred caterers.
- **Page CTA pair:** primary "Book Mon-Thu" -> internal booking flow; secondary "Schedule a tour / weekend event" -> HoneyBook.

> **Build flag:** Every rate/capacity/amenity on this page must read from the venue config object, not be hardcoded into the React component (the core OEV tech-debt callout). When Glendalys finalizes pending values, only the config changes.

#### `/gallery`

- **H1:** "D'Space Orlando event gallery"
- **Intro/subhead:** "6,000 sq ft of modern-industrial space, set up for real corporate events."
- **Filter chips (in this order - corporate first, per pilot positioning):** All - Corporate - Facility - Weddings - Social
  - Default selection: **All** (or **Corporate** if the team wants the pilot front-and-center - **[PENDING - team: confirm default filter]**).
  - Filtering is client-side; tiles tagged by category. Empty-filter state: show a graceful "No photos in this category yet" message rather than a blank grid.
- **Tile captions** (from homepage gallery, reusable as tags/captions): Main gallery - keynote setup - Executive mezzanine - Meeting room - Private suites - Entrance & street-level load-in - On-site parking.
- **CTA:** "See full gallery" on the homepage gallery section links here; this page is the full grid.

#### `/contact`

- **H1:** "Connect with D'Space Orlando"
- **NAP block** (config-driven - do NOT hardcode):
  - **Address:** 6838 Hoffner Ave, #1200, Orlando, FL 32822
  - **Phone:** **[PENDING - Glendalys]** - one consolidated number; the live site currently shows TWO numbers (407-391-6109 and 407-368-9652); use a single number everywhere, sourced from config.
  - **Email:** info@dspaceorlando.com
  - Hours: Mon-Thu booking availability (Fri-Sun -> tour/weekend via HoneyBook). Confirm display hours **[PENDING - Glendalys]**.
- **Map embed:** embedded map centered on the Hoffner Ave address; pin matches the NAP block exactly. Drives the `LocalBusiness` geo schema.
- **Form:** mount the **same lead-capture component from Part A** here (identical fields, consent strings, validation, routing). Do not fork a second form.

> **Improvement over OEV:** OEV hardcodes the address, phone, and a contact name ("Luis Torres") across AccessCode.tsx, the footer, staff views, and 10+ email functions, so any NAP change requires touching many files. D'Space's `/contact` NAP, the footer, and the email senders all read one config object - change the phone once, it updates everywhere.

### Part C - Out-of-Scope Pages: `/weddings` & `/social-events`

These pages are **kept in the build but removed from the pilot's online-booking scope** (the Mon-Thu corporate pilot). Weekend and wedding/social business runs through the legacy HoneyBook flow.

**Behavior:**
- [ ] Leave the existing page **content** in place (copy, imagery, layout) - do not delete these pages.
- [ ] **Swap every CTA** on both pages to: **"Schedule a tour / weekend event"** -> links OUT to **HoneyBook**.
- [ ] Remove or disable any "Book Mon-Thu" / internal-booking-flow buttons on these two pages - these events do **not** route to the internal Stripe/approval/lockbox booking wizard.
- [ ] Do NOT add the Mon-Thu lead form's booking CTAs here; the only conversion action on these pages is the HoneyBook tour/weekend CTA.

**Routing rule (applies site-wide, restated for clarity):**

| CTA intent | Destination |
|------------|-------------|
| "Book Mon-Thu" (any page) | Internal booking flow (Mon-Thu enforced, Stripe deposit, admin approval gate, lockbox code) |
| "Tour / Weekend event" / any `/weddings` or `/social-events` CTA | HoneyBook (external) |

> **Improvement over OEV:** clean separation between the **internal Mon-Thu booking flow** and the **external HoneyBook weekend/wedding flow** means the corporate pilot's online booking never accidentally accepts a Fri-Sun or wedding date. OEV has a single venue and a single booking path; D'Space explicitly bifurcates by intent at the CTA level.

---

## 8. Improvements Over OEV + Open Items

This section is the "why this build is better than the source system" record, plus the unresolved decisions that gate specific build steps. The OEV system works, but it carries real tech debt. D'Space inherits the proven logic and fixes the debt up front.

### 8A. Do Better Than OEV

Each row is grounded in the actual OEV implementation. "Improvement over OEV" is called out so the Lovable builder and OEV dev team can see the upgrade.

| # | Area | What OEV does today (the debt) | What D'Space must do instead | Why it matters |
|---|------|-------------------------------|------------------------------|----------------|
| 1 | **Config-driven venue identity** | Venue name, address, phone, capacity, and rates are hardcoded across 9+ React components and 10+ edge functions. Specifically baked in: venue **name** ("Orlando Event Venue"), **address** ("3847 E Colonial Dr, Orlando, FL 32803"), **phone** ("407-974-5979"), **contact name** ("Luis Torres"), **capacity** ("90 chairs + 10 tables", "90 guest maximum"), **parking** ("200+ spots"), **rates / rules / penalty matrix**, **alert email**, **website URL**, and **footer email**. | **Improvement over OEV:** Read every venue identity value from a single config object (one source of truth), never literal strings in JSX or email templates. Name, address, phone(s), contact person, capacity, parking, website, sender email, support email, and all rules/penalty copy resolve from config. No component or template may hardcode a venue value. | This is OEV's #1 tech debt and the reason it cannot scale to a second venue. D'Space is the second venue. If we hardcode again, we repeat the mistake on day one. **Blocks:** Footer, Hero, /contact, /spaces, all transactional copy. |
| 2 | **Generalized non-payable add-on alert** | OEV has no real "alert-only" add-on. Bar service is a fully **charged** revenue item ($18-$40/guest); the admin notification only fires from `stripe-webhook` **after payment**, logged to `booking_events` and emailed to a hardcoded admin address. | **Improvement over OEV:** Generalize the existing alcohol/bar alert into a reusable pattern for **all** add-ons (Production/AV, Catering by D'Loft, Bar & mixology, Extras). Every add-on is **selection-only, zero charge**. Selecting any add-on fires the admin alert (same mechanism, decoupled from payment) and the selection persists with the booking. UI shows "we'll follow up to coordinate & quote." | Lets D'Space capture demand signals without forcing a price into the cart, and reuses a notification path OEV already trusts. **Blocks:** Wizard Step C (Add-ons), summary line items, admin alert. |
| 3 | **Multi-space, single-event cart** | OEV books a **single venue**, one event per date, with one cumulative total. No space concept exists; there is no space selector. | **Improvement over OEV:** Four independent space calendars (Main Conference Area, Executive Mezzanine, Meeting Room, Breakout Rooms / two suites). A user can add multiple spaces to **one** event; pricing is cumulative (sum of each space's rate × its hours). Shared fees (e.g., cleaning) apply once, not per space. Per-space availability is independent - same time on different spaces is allowed. | The core product differentiator vs OEV. The whole wizard arc depends on it. **Blocks:** Wizard Step A (Spaces & time), summary, availability checks. |
| 4 | **Domain-authenticated email sender** | OEV sends transactional and alert email through a **personal Gmail account using an app-password** (fragile, deliverability-risky, ties critical mail to one human's inbox). Sender/footer addresses are hardcoded gmail.com addresses. | **Improvement over OEV:** Send all transactional and admin-alert email from a **domain-authenticated sender** (SPF/DKIM/DMARC on the D'Space domain). Sender, reply-to, and support addresses come from config (row 1), not a personal Gmail. | Protects deliverability of confirmations, balance reminders, access codes, and add-on alerts; removes a single-point-of-failure tied to one personal account. **Blocks (backend):** all send functions, confirmation/access-code delivery. |
| 5 | **Cleaner state presentation** | OEV exposes **two** parallel status systems - `status` (7-value Supabase enum) and `lifecycle_status` (7 internal stages) - which is confusing to read in the UI. | **Improvement over OEV:** Present a **single, human-readable status** to the client (and a clean lifecycle view to admin). The client-facing post-deposit state is unambiguous: **"PENDING - not yet confirmed"** until admin approval. Map internal stages behind that one label. | Removes the dual-status confusion OEV's own digest flags as a known issue, and makes the admin-approval gate legible to the customer. **Blocks:** Wizard Step D status display, confirmation screen, admin gate UI. |

### 8B. Recommended Changes to the Arc (Professional Additions)

These are judgment calls layered on the locked arc. None of them change the locked decisions; they harden the flow. Where a call needs sign-off, it is flagged.

- **Confirm the per-space-time assumption.** The locked arc allows each added space its own start/end window while sharing one event date. This is an **assumption to confirm with the team** before building Step A. Two viable reads: (a) all spaces share one date, per-space time windows allowed (current assumption), or (b) all spaces share one date **and** one time window. Build for (a) but gate it on confirmation, because the summary and cumulative-pricing math differ. Note: this is **not** the half-conference split (that stays disabled) - it is the multi-room combo case. *(Decision needed - see 8C / 5.11.)*
- **Show availability BEFORE the deposit.** OEV validates availability at booking creation, but the admin approval gate still re-checks overlaps after payment. To reduce declined-after-paying friction, surface live per-space availability in Step A (calendar disables fully-booked dates and conflicting time ranges per space) so the client rarely reaches deposit on an unavailable slot. The admin gate remains the final authority.
- **Save-as-draft / cart recovery.** The wizard is multi-step with e-sign and payment at the end. Add a way to preserve in-progress selections (spaces, times, guests, add-ons) so a user who drops off can resume, and so we don't lose a warm lead. At minimum, persist wizard state locally; ideally capture the lead (email) early enough to follow up on abandonment. *(Mechanism for cross-device recovery is [PENDING - OEV dev]; local persistence can ship now.)*
- **Explicit "pending, not confirmed" messaging.** After deposit, the client sees a clearly worded interstitial: payment received, but the booking is **not confirmed** until admin approval; what happens next (approve -> confirmation + calendar invite + smart-lock code; decline -> auto-refund + alternative-date offer); and an expected review window. Do not imply the date is locked. This is the single most important expectation-setting copy in the flow. The exact review window depends on the approval SLA *([PENDING - Glendalys]).*
- **Mobile-first wizard.** Build the wizard mobile-first: single-column steps, large tap targets for date/time pickers, a sticky running-total/CTA, and the e-sign canvas usable by touch (OEV's signature canvas already supports touch - preserve that). Corporate planners book on phones; the multi-space cart must not feel cramped on small screens.
- **Accessibility.** Keyboard-navigable date pickers and time inputs; visible focus states; labeled form fields and error messages tied to inputs; sufficient color contrast for status badges and disabled (Fri-Sun) dates; the disabled-weekend state must be communicated by more than color (e.g., aria-disabled + helper text). The signature step needs an accessible fallback path.
- **Disabled-weekend clarity.** Fri/Sat/Sun are disabled in every date picker (Mon-Thu pilot). Don't just gray them out silently - show inline helper copy ("Weekend dates are handled separately - book a weekend via our tour flow") and route the weekend intent to the HoneyBook CTA so the user isn't dead-ended.

### 8C. [PENDING] Before Publish

These must be answered before this brief is published and before the noted build steps can be finalized. Each item notes its owner and which build step it blocks. **Do not invent any of these values.**

| Item | Detail needed | Owner | Blocks build step |
|------|---------------|-------|-------------------|
| Public phone number | Single canonical public phone for D'Space (NAP) | [PENDING - Glendalys] | Footer, /contact, all email footers, access-code help line |
| Main Conference capacity | Max guests for full-room Main Conference Area | [PENDING - Glendalys] | Hero/positioning copy, /spaces, guest-count helper, capacity guard |
| Meeting Room rate | Hourly rate for Meeting Room | [PENDING - Luis] | Wizard Step A pricing, summary, deposit math |
| Breakout Rooms rate | Hourly rate for Breakout suites (two private suites) | [PENDING - Glendalys] | Wizard Step A pricing, summary, deposit math |
| Cleaning fee | Shared cleaning fee amount (applied once per event, not per space) | [PENDING - Glendalys] | Summary, cumulative-cart math, deposit math |
| Approval SLA | Target turnaround for the admin approval gate (review window to communicate to clients) | [PENDING - Glendalys] | "Pending, not confirmed" messaging, post-deposit interstitial copy |
| Outside-alcohol policy | D'Space's policy/penalty for outside alcohol (OEV used a $500 fine - do not copy) | [PENDING - Glendalys] | Bar/mixology add-on copy, e-sign agreement rules, venue rules block |
| Standard rental-hour blocks | COPY DECK /spaces lists "8 or 12 hours" rental, which conflicts with the locked hourly + 4-hr-minimum model; confirm the standard rental-hour blocks | [PENDING - Glendalys] | /spaces included-amenities copy |
| NAP two-phone cleanup | OEV ships **two** different phone references in code; confirm D'Space uses **one** canonical number everywhere (Name/Address/Phone consistency) | [PENDING - Glendalys] | Footer, /contact, email footers, access-code page - all must resolve to one config value |
| Capacity-guard note | Confirm whether a hard guest-count cap (and any over-capacity fee) applies per space and/or per event; OEV enforced a 90-guest cap with a $500 over-cap penalty - D'Space values are unknown | [PENDING - Glendalys] | Guest-count split helper (Step B), validation, e-sign rules |
| Gallery default filter | Confirm whether `/gallery` defaults to All or Corporate | [PENDING - team] | /gallery filter chips |

**Notes for the builder:**
- Mon-Thu, 4-hour minimum on **Main Conference and Mezzanine**, hourly-only, no daily rate, no half-conference split - these are **locked**, not pending. Build calendars so Main Conference *can* be subdivided later, but do **not** expose subdivision now.
- Add-ons are **non-payable** (zero charge) - also locked. The only pending add-on detail is the outside-alcohol **policy/penalty** copy above, not whether alcohol is charged (it is not).
- The client-facing **80% deposit / 20% balance** split and the backend **Stripe Connect 80/20** platform-vs-venue payout split are locked and faithful to OEV's `deposit_percentage` config pattern - they are not pending.
- Every [PENDING] value must resolve through the config object from 8A row 1 once supplied - do not patch them in as literals.

---

## Appendix: Source references

This brief mirrors the OEV implementation. The dev team can compare against these key source files (from the OEV source digest) when wiring the D'Space backend.

**Booking wizard (6-step flow to replicate / restructure):**
- `/Users/cberrio04/Documents/OEV-PROJECT/src/pages/Book.tsx` - wizard orchestrator; `BookingFormData` interface
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/booking/BookingTypeStep.tsx` - date/time picker; hourly/daily toggle (toggle REMOVED for D'Space); 4-hr minimum; availability via `useBookedDates`
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/booking/GuestsEventStep.tsx` - guest count + event type (Step B basis)
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/booking/AddOnsStep.tsx` - add-on selection UX (made NON-PAYABLE for D'Space)
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/booking/SummaryStep.tsx` - pricing breakdown; `goToStep` edit pattern; deposit % display
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/booking/ContactPoliciesStep.tsx` - contact fields, rules scroll, consent checkboxes, canvas signature
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/booking/PaymentStep.tsx` - Stripe checkout, deposit + processing fee, post-payment confirmation

**Pricing, availability, and booking creation:**
- `/Users/cberrio04/Documents/OEV-PROJECT/src/hooks/usePricing.ts` - config-driven pricing (deposit_percentage default 50; D'Space sets 80)
- `/Users/cberrio04/Documents/OEV-PROJECT/src/hooks/useCreateBooking.ts` - creates booking `pending_review` / `pending`; availability validation
- `/Users/cberrio04/Documents/OEV-PROJECT/src/hooks/useBookedDates.ts` - `isTimeRangeAvailable()` / `isDateFullyBooked()` (scope per-space for D'Space)
- `/Users/cberrio04/Documents/OEV-PROJECT/src/hooks/useBarPackages.ts` - bar package rates (paid in OEV; alert-only in D'Space)

**State machine, approval gate, and automations:**
- `/Users/cberrio04/Documents/OEV-PROJECT/src/integrations/supabase/types.ts` - `booking_status` + `payment_status` enums
- `/Users/cberrio04/Documents/OEV-PROJECT/src/pages/admin/BookingDetail.tsx` - Confirmation Checklist approval gate
- `/Users/cberrio04/Documents/OEV-PROJECT/src/pages/admin/BookingsList.tsx` - lifecycle grouping, payment badges
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/trigger-booking-automation/index.ts` - fires host-report, guest-feedback, balance-payment on approval
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/schedule-balance-payment/index.ts` - balance reminder cadence (15d / 48h retries)
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/cancel-booking/index.ts` - decline path (no auto-refund / no alt-date in OEV; D'Space adds both)
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/sync-to-ghl/index.ts` - calendar invite + lead guard
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/ghl-update-booking-status/index.ts` - GHL bidirectional status webhook
- `/Users/cberrio04/Documents/OEV-PROJECT/src/pages/AccessCode.tsx` - self-service lockbox code retrieval

**Stripe deposit + 80/20 Connect split:**
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/create-checkout/index.ts` - deposit charge; 80/20 split; `setup_future_usage: off_session`
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/create-balance-payment-link/index.ts` - balance charge; same 80/20 split
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/stripe-webhook/index.ts` - deposit/balance webhook; internal admin email; add-on `booking_events` log
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/create-invoice/index.ts` and `create-addon-invoice/index.ts` - invoice payments; 80/20 split

**Add-on alert mechanism:**
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/AddOns.tsx`, `BarService.tsx`, `Production.tsx` - add-on marketing/selection components

**Lead capture + GHL integration:**
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/ContactForm.tsx` - homepage contact form (dual required consent in OEV; split for D'Space)
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/send-contact-form/index.ts` - internal email + GHL `/contacts/upsert` (D'Space lead-form analog)
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/DiscountPopup.tsx` and `supabase/functions/send-popup-lead/index.ts` - popup lead path

**Hardcoded venue identity (the config-driven debt to fix):**
- `/Users/cberrio04/Documents/OEV-PROJECT/src/components/Footer.tsx`, `Hero.tsx`, `SpaceHighlights.tsx`, `Pricing.tsx` - hardcoded NAP, capacity, rates
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/send-booking-confirmation/index.ts` - hardcoded rules, penalty matrix, fees in email/PDF
- `/Users/cberrio04/Documents/OEV-PROJECT/supabase/functions/send-discount-email/index.ts`, `send-guest-feedback/index.ts` - hardcoded venue details in email footers
