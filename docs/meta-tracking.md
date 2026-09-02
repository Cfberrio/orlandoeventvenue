# Meta Ads conversion tracking — Orlando Event Venue

Source of truth for revenue is **always** the `bookings` table in this
database. Meta is an attribution / optimization layer, never the ledger.

This implementation is a port of the Discipline Rift one
(`~/Documents/DISCIPLINERIFT/disciplinerift`), re-anchored on the OEV funnel:
DR pivots on `parent → enrollment → payment`, OEV has no guest login and pivots
on `bookings.id` plus the guest email. **A bug fixed in one probably lives in
the other** — see the shared-lineage note in `CLAUDE.md`.

Setup instructions for the Pixel and the CAPI token: **`docs/META-PIXEL-CAPI-SETUP.md`**.

---

## Event map

| Event | Exact trigger | Browser | Server | Event id | DB source of truth | Value |
|---|---|---|---|---|---|---|
| `PageView` | Every SPA route change (`TrackingRoot`), except `/admin`, `/staff`, `/auth`, `/stripe/*` | ✅ | — | — | — | — |
| `ViewContent` | Booking type chosen on step 1 of `/book` | ✅ | — | random | `tracking_event` | package total |
| `Lead` | Contact form submitted (post-honeypot) | ✅ | ✅ | `evt_lead_<uuid>` | — | — |
| `Lead` | PLAN50 popup lead saved | ✅ | ✅ | `evt_lead_<popup_leads.id>` | `popup_leads` | — |
| `CompleteRegistration` | `bookings` row persisted (step 6 submit, before payment) | ✅ | ✅ | `evt_booking_<booking_id>` | `bookings` | deposit charged |
| `InitiateCheckout` | Stripe Checkout Session actually created | ✅ | ✅ | `evt_checkout_<booking_id>` | `bookings` | deposit charged |
| `Purchase` | `stripe-webhook` flipped `payment_status` to `deposit_paid` | ✅ | ✅ | `evt_purchase_<booking_id>` | `bookings.deposit_paid_at` | `deposit_total_charged` |

Browser `eventID` and server `event_id` are the **same string**, computed from
the business object — so a reload, a back-navigation, a webhook retry and a
success-page refresh all recompute one id and Meta deduplicates.

`CompleteRegistration` is a diagnostic milestone only. The campaign optimizes
for `Purchase`; a guest can complete the booking form and never pay.

### What is deliberately NOT a conversion

- **Balance payments** (`?type=balance`) and **add-on invoices**
  (`?type=addon`) land on the same confirmation page and send nothing. One
  booking is one conversion; counting the balance too would make every channel
  look twice as efficient as it is.
- **The reported value is the deposit actually charged** (base + processing
  fee), matching the existing GA4 `purchase` event in `src/lib/analytics.ts`.
  The contract total rides along in `custom_data.contract_total` for reporting,
  but it is not the conversion value.
- **Back-office traffic.** `TrackingRoot` excludes `/admin`, `/staff`, `/auth`
  and `/stripe/*`. Measuring the team's own navigation would pollute the funnel
  and build a retargeting audience out of staff devices.

---

## Idempotency

- `meta_event_delivery.meta_event_id` is `UNIQUE`, and claiming it happens
  **before** the network call. A resend is journaled as `duplicate` and never
  re-posted; only a previous `error` / `skipped_no_secrets` is retried.
- `stripe-webhook` already returns early when `deposit_paid_at` is set, so
  `sendPurchase` is reached only by the call that actually performed the flip.
- One `bookings` row per booking → one `evt_checkout_<booking_id>`, however
  many times the guest re-enters checkout.
- The confirmation page guards on `localStorage oev_meta_purchase_<booking_id>`.
- If the journal insert itself fails for any reason other than the unique
  violation, **nothing is sent**. A missed conversion is recoverable; a
  silently double-counted Purchase is not.

---

## Attribution

Captured on landing (`parseUtm`): `utm_source`, `utm_medium`, `utm_campaign`,
`utm_term` (Ad Set / GEO), `utm_content` (creative), `meta_campaign_id`,
`meta_adset_id`, `meta_ad_id`, `meta_placement`, `fbclid`, `gclid`, plus the
landing URL, referrer and timestamps.

- **First touch** (`tracking_visitor.first_utm` / `first_touch_at`) is written
  once and never overwritten.
- **Last touch** (`last_utm` / `last_touch_at`) moves only on a new *paid*
  click — a Meta object id, an `fbclid`/`gclid`, or a paid `utm_medium`
  (`isPaidTouch`). A direct or organic return never erases the ad that
  acquired the guest.
- **Identity chain:** `oev_aid` cookie → `tracking_visitor` → `booking_id` /
  `lead_id` / `email` (written server-side by `track-event` from the envelope)
  → `bookings`. Reporting joins booking → visitor on the booking id first and
  the email second, so attribution survives "clicked the ad on Instagram
  Monday, booked from a laptop Thursday".
- **`pickMatchSignals` refuses to inflate.** A guest owns several visitor rows
  (Instagram in-app browser, Safari, the row minted on the return from Stripe).
  Each signal is taken from the newest row that actually carries it — but the
  ad click id `fbc` is additionally filtered to rows whose visit *predates* the
  event being reported. Someone who clicks an ad the day after paying must
  never have that click reported as the cause. `fbp`/IP/UA are not
  time-filtered: they say who this is, not which ad caused anything.

---

## Privacy

- **Capture is not gated by the cookie banner.** The banner records a choice
  (cookie + `consent_record`), but analytics and the Meta Pixel run for every
  visitor. This is a deliberate product decision taken 2026-09-02. The single
  switch is `HONOR_AD_OPT_OUT` in `src/lib/tracking/consent.ts`; flipping it to
  `true` makes "Essential only" mean what it says, with no other code change.
  DR, by contrast, does gate the Pixel behind an explicit opt-in.
  **Known exposure:** an "Essential only" button that does not suppress
  advertising cookies is the specific pattern CCPA/CPRA and the EU ePrivacy
  rules treat as a deceptive control. The banner discloses this in its own
  copy while the switch is off.
- **What reaches Meta:** the guest's hashed email / phone / first name / last
  name, hashed city+state+country (always Orlando, FL, US — a fact about the
  venue, not a guess about the guest), hashed `external_id` (the booking or
  lead id), `fbp`/`fbc`, IP + user agent, the amount, and the event type /
  guest count of the booking.
- **What never reaches Meta:** card data, the signature image, the initials,
  the signed contract text, internal notes, staff notes, or any other guest's
  data.
- The internal ledger (`tracking_event`) is first-party and consent-independent,
  so the DB funnel is always complete even when a Meta send is skipped.

---

## Anti-abuse

`track-event` is public (`verify_jwt = false` in `supabase/config.toml`) because
it must accept events from anonymous visitors. Its defences:

- 30 KB payload cap, max 10 events per request.
- Strict event-name allowlist; anything else is dropped silently.
- Format-checked identifiers (`anon_*`, `sess_*`, UUIDs, email regex).
- Only `Lead` and `CompleteRegistration` may be mirrored to Meta from the
  browser. `InitiateCheckout` and `Purchase` are server-only, because only the
  edge functions know the amount actually charged.
- **Nothing reaches Meta unless the `bookings` or `popup_leads` row the event
  names actually exists.** The contact details sent to Meta are then read from
  that row, not from the request body — so a public endpoint cannot be used as
  a free channel into the ad account.

---

## Reporting

Migration `20260902140100_meta_attribution_reporting.sql`. All views are
`security_invoker`, so they are readable only by an admin
(`has_role(auth.uid(),'admin')`). Surfaced in the app at
**/admin/analytics → Ad Attribution**.

| View | Answers |
|---|---|
| `v_paid_booking_attribution` | one row per booking with a cleared deposit + first/last touch + CAPI delivery status |
| `v_channel_performance` | Meta vs Google vs organic, by campaign |
| `v_meta_creative_performance` | paid bookings + revenue by creative (`utm_content` / `meta_ad_id`) |
| `v_meta_geo_performance` | paid bookings + revenue by Ad Set / GEO (`utm_term` / `meta_adset_id`) |
| `v_meta_creative_geo_performance` | creative × GEO matrix |
| `v_booking_funnel_daily` | /book viewed → started → lead → booking created → checkout → deposit paid |
| `v_meta_delivery_health` | CAPI sends by day, event and status — a row stuck on `error` means Meta is optimizing blind |

ROAS is **not** computed here: this DB owns bookings and revenue, Meta Ads
Manager owns spend.

---

## Secrets (server only, never in the bundle)

| Secret | Purpose |
|---|---|
| `META_PIXEL_ID` | Dataset id. Must equal `META_PIXEL_ID` in `src/lib/tracking/config.ts` or the two halves report into different datasets and nothing deduplicates. |
| `META_CAPI_TOKEN` | Conversions API access token. |
| `META_TEST_EVENT_CODE` | **QA only.** While it is set, events show in Events Manager → Test Events and do **not** count as conversions. Remove after testing. |

Without `META_PIXEL_ID` + `META_CAPI_TOKEN`, every server send degrades to a
journaled no-op with status `skipped_no_secrets`. With
`META_PIXEL_ID = ""` in `src/lib/tracking/config.ts`, the browser Pixel never
loads at all. Both are safe states to deploy.

---

## Files

```
src/lib/tracking/config.ts        Pixel id + Supabase endpoint (public)
src/lib/tracking/core.ts          Pure helpers, dedup ids, UTM parsing   ← mirrors meta-core.ts
src/lib/tracking/consent.ts       Cookie + HONOR_AD_OPT_OUT switch
src/lib/tracking/identity.ts      oev_aid cookie, session id, fbclid capture
src/lib/tracking/pixel.ts         Meta Pixel loader
src/lib/tracking/track.ts         POST to track-event (keepalive)
src/lib/tracking/funnel.ts        One helper per funnel milestone
src/components/tracking/          TrackingRoot + ConsentBanner
src/components/admin/MetaAttributionPanel.tsx

supabase/functions/_shared/meta-core.ts    Pure: hashing, pickMatchSignals, dedup ids
supabase/functions/_shared/meta-capi.ts    Delivery journal + booking conversions
supabase/functions/track-event/            Public collector
supabase/functions/create-checkout/        → sendCheckoutStarted()
supabase/functions/stripe-webhook/         → sendPurchase()
supabase/functions/send-contact-form/      → sendLead()

supabase/migrations/20260902140000_meta_tracking.sql
supabase/migrations/20260902140100_meta_attribution_reporting.sql
```

Tests: `bun run test` (`src/lib/tracking/core.test.ts`) and
`bun run test:edge` (`supabase/functions/_tests/meta-core.test.ts`). The dedup
id format is pinned by both, on purpose: if the two sides drift, every
conversion silently doubles.
