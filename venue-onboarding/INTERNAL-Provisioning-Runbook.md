# INTERNAL — Venue Provisioning Runbook & Improvements

> **Audience:** Reliable Venues dev/ops team only. **Do NOT send to clients.**
> The client-facing intake is `Venue-Partner-Onboarding.pdf`. This note maps that intake to the
> real OEV system and lists the engineering changes that make "clone a venue" a *data* task, not a
> *code* task.

---

## 1. How a new venue gets stood up (target model)

Per-venue isolation = cleanest rev-share and zero data bleed:

| Layer | Per venue? | Notes |
|---|---|---|
| App source code | **Shared** | One codebase, feature-flagged per tier. Never fork per venue. |
| Supabase project | **1 per venue** | Fresh project; run migrations; seed `venue_config`. |
| GoHighLevel | **See decision below** | Boss's call: keep all venues under the **one shared account** (Reliable/"Relauvening", shared w/ Cheese-To-Share) + **separate phone number per owner** to avoid the $297 unlimited-accounts tier. Organize with **folders + labels per venue**. Revisit only if contact/pipeline soup gets unmanageable — everything is migratable later. |
| Stripe | **1 connected account per venue** | Deposits/balances/add-ons land in the venue's account; platform takes rev-share via application fee. |
| Domain | **1 per venue** | `book.<venue>.com` or their root domain. |

**Tiers (feature flags in `venue_config`):**
- **Tier A — Full Platform:** `booking_enabled` + `payments_enabled` + `crm_enabled` + `operations_enabled`.
- **Tier B — Landing page:** all flags off except lead capture (`contact_form`, `discount_popup`); inquiries route to GHL/email. No booking lifecycle, no Stripe, no ops modules.

---

## 2. Intake section → where it lands

| Intake section (client PDF) | Lands in |
|---|---|
| 1. Business Basics | `venue_config` (name, address, phone, email, tz, socials) → replaces hardcoded `Hero.tsx`, `Footer.tsx`, SEO/meta, email signatures |
| 2. Brand & Look | design tokens (`hsl(var(--primary))` etc.), logo/favicon assets, hero image, gallery |
| 3. Your Space | `venue_config` (max_guests, chairs, tables, sqft, amenities), hero stat cards |
| 4. Availability & Booking Rules | `venue_config` (booking types, min hours, hours, days, buffer, lead time) + `blackout_dates` |
| 5. Pricing & Payments | `venue_config` / `venue_pricing` (hourly, daily, cleaning, deposit %, balance_due_days, tax, fees) |
| 6. Packages & Add-Ons | package types + add-ons tables |
| 7. Bar & Alcohol | `bar_packages` + bar policy text |
| 8. Team & Cleaning | `staff_members`, payroll rates, cleaning type rates |
| 9. Guest Entry & Access | `venue_access_code` config + AccessCode flow |
| 10. Messages to Clients | which GHL automations/edge-function comms to enable |
| 11. Getting Paid | Stripe Connect onboarding (statement descriptor, billing email) |
| 12. Website & Email | domain / `FRONTEND_URL`; transactional sender identity |
| 13. Promotions & Discounts | `DiscountPopup`, `discount_coupons`, `popup_leads` drip |
| 14. House Rules & Policies | `booking_policies`, templated Privacy/Terms (inject venue name), `contract_version` (namespace per venue, e.g. `lakeside-v1.0`) |
| 15. Goals & Launch | internal CRM/project; deploy + sign-off |

---

## 3. Engineering improvements to bake in (the "better than OEV" part)

These came out of reading the real code. Do these **before** cloning the 2nd venue so the clone is config-driven.

1. **Kill hardcoded identity.** Name, address `3847 E Colonial Dr, Orlando, FL`, phone `407-974-5979`, logo `oev-logo-full.png`, hero copy (`90 chairs + 10 tables`, `Near Downtown Orlando`), footer/copyright are literal in components. → Single branding/config provider sourced from `venue_config`. Intake maps 1:1 to these keys.
2. **Capacity to config.** `bookings` has `CHECK (number_of_guests BETWEEN 1 AND 90)` and `90 chairs` in the hero. → Move max to `venue_config.max_guests`; validate in app logic so no migration per venue.
3. **Pricing as a required, validated object.** `venue_config` ships OEV defaults (140/hr, 899/day, 199 cleaning, 50% deposit, 15-day balance). → Provisioning refuses go-live until every pricing/fee/tax/deposit key is explicitly set for the venue. No inherited OEV numbers.
4. **Secrets manifest with canonical names.** Today inconsistent: `Stripe_Secret_Key` vs `STRIPE_*`, `GHL_API_KEY` vs `GHL_PRIVATE_INTEGRATION_TOKEN` vs `GHL_BACKEND_TOKEN`. → One documented manifest; provisioning checklist verifies all set + correctly named per project.
5. **Email sender off personal Gmail.** ~23 functions use `GMAIL_USER`/`GMAIL_APP_PASSWORD` (fragile, rate-limited, not domain-authenticated → spam risk; ties all venues to one mailbox). → Standardize on domain-authenticated provider (SendGrid is partially wired) with per-venue From + SPF/DKIM.
6. **Tier feature flags.** Codebase assumes full platform; a Tier B venue would carry dead booking/payment/ops code. → `booking_enabled`/`payments_enabled`/`operations_enabled`/`crm_enabled` in `venue_config`, set by intake Section 0/tier.
7. **Per-venue legal.** Privacy/Terms/house-rules are OEV-specific PDFs and `contract_version 'v1.0'` is global → a clone would show OEV's legal text. → Templated docs that inject venue name; namespace `contract_version`.
8. **Document the multi-tenancy decision** (Section 1 table). Current model is effectively single-tenant (one `VITE_SUPABASE_URL`). Recommended now: one project per venue.
9. **Replace ad-hoc setup docs.** Repo root is a sprawl of one-off ES/EN guides (`GUIA-VERIFICACION`, `INSTRUCCIONES-IMPLEMENTACION`, deploy notes) = tribal knowledge. → This intake + a provisioning checklist = anyone can stand up a venue identically.

---

## 4. Owner-facing flow improvements (already folded into the intake)

From the owner meeting — these are in the client PDF as friendly options, no jargon:

- **"One week before" reminder** (Section 10): nudges the owner to reconnect with the client. New lifecycle touchpoint the boss asked for.
- **Post-event review fix** (Section 10): today the review request auto-fires ~1 min after the event but *nobody fills it*. Intake offers a one-tap request + optional small incentive to lift completion.
- **Booking lifecycle made explicit & configurable**: `pending_review → confirmed → completed` (+ cancelled/needs_info/needs_payment); payments `pending → deposit_paid → fully_paid`. GHL pipeline: Pending → Confirmed → Pre-Event Ready → In Progress → Post-Event → Closed.

---

## 5. Provisioning checklist (per venue)

- [ ] Intake received + reviewed; all `*` fields present; prices are the venue's, not examples
- [ ] New Supabase project; migrations run; `venue_config` + pricing seeded from intake
- [ ] Feature flags set for chosen tier
- [ ] Branding loaded: logo, favicon, colors/tokens, hero, gallery
- [ ] Copy loaded: hero/headline, FAQ, how-it-works, event types
- [ ] GHL: folder/labels + dedicated phone number for this owner; automations cloned + scoped
- [ ] Stripe Connect linked (statement descriptor, payout email); rev-share application fee set
- [ ] Transactional email: domain-authenticated From + SPF/DKIM
- [ ] Legal: templated Privacy/Terms with venue name; house rules + cancellation loaded; `contract_version` namespaced
- [ ] Domain / `FRONTEND_URL` wired; analytics IDs
- [ ] Private preview to owner → sign-off → go live
- [ ] Daily cron health check confirmed green
