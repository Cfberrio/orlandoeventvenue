# OEV — Booking Master Dataset: Schema & Methodology Report

**Generated:** 2026-09-03
**Database:** Supabase Postgres, project ref `vsvsgesgqjtwutadcshi` (Lovable Cloud), schema `public`
**Access mode:** READ ONLY. Only `SELECT` and catalog introspection were executed. No DDL, no DML, no migrations, no writes of any kind.
**Deliverables:** `oev_bookings_master.csv` (75 rows × 155 cols), `oev_bookings_export.sql`, this report.

---

## 1. What is actually in this database

51 objects in `public` (43 tables, 8 views). Only a subset is relevant to bookings.

### 1.1 Core booking surface

| Table | Rows | Role |
|---|---|---|
| `bookings` | 75 | **The booking. Source of truth.** Also carries the customer inline. |
| `booking_revenue_items` | 416 | Revenue **allocation ledger**, 1:N. Split 50/50 deposit/balance. **Does not reconcile** (§6.2). |
| `booking_events` | 2,272 | Append-only lifecycle event log, 1:N. Only place several timestamps exist. |
| `booking_addon_invoices` | 15 | Extra add-on invoices raised **after** the original booking, 1:N. Own Stripe payment. |
| `stripe_event_log` | 109 | Provider-confirmed `checkout.session.completed` webhooks. Idempotency table doubling as a payment log. |
| `booking_policies` | 3 | `WEBSITE_FULL_FLOW`, `EXTERNAL_BLOCK_FLOW`, `INTERNAL_BLOCK_FLOW`. FK from `bookings.policy_id`. |
| `availability_blocks` | 18 | Admin calendar blocks. Only `internal_admin` source. Not a booking hold. |
| `discount_coupons` | 28 | Coupon catalog. **No FK to bookings** — the code is copied into `bookings.discount_code`. |
| `venue_pricing` | 14 | Price catalog. Not versioned per booking. |
| `invoices` | 18 | **Standalone invoices, NOT linked to any booking.** No `booking_id` column. |
| `popup_leads` | 187 | Lead-magnet capture (PLAN50 popup). Started 2026-02-18. |
| `tracking_visitor` / `tracking_session` / `tracking_event` | 26 / 28 / 84 | First-party ad attribution. **Went live 2026-09-02.** Effectively empty for history. |
| `meta_event_delivery` | 3 | Meta CAPI send journal. 3 rows, all from testing. |

Not relevant to bookings and excluded: staff/payroll (`staff_members`, `staff_payroll_items`, `booking_staff_assignments`), inventory, maintenance, cleaning/host reports, GHL SMS + Gmail draft logs, `scheduled_jobs`, `brand*`, `consent_record`, `venue_access_code`, `recurring_access_codes`, `_cron_backup_20260803`.

### 1.2 Keys and relationships

All FKs point at `bookings(id)`:

```
bookings (PK id, UNIQUE reservation_number)
  ├─< booking_revenue_items.booking_id      ON DELETE CASCADE
  ├─< booking_events.booking_id             ON DELETE CASCADE
  ├─< booking_addon_invoices.booking_id     ON DELETE CASCADE
  ├─< stripe_event_log.booking_id           (nullable — standalone invoices have none)
  ├─< availability_blocks.booking_id        ON DELETE SET NULL
  ├─< tracking_visitor.booking_id           ON DELETE SET NULL
  ├─< tracking_event.booking_id
  ├─< meta_event_delivery.booking_id
  ├─> booking_policies.id                   (bookings.policy_id, NOT NULL)
  └─> staff_members.id                      (bar vendor fields)

popup_leads (PK id) ─< tracking_visitor.lead_id
```

**There is no `customers`, `contacts`, `clients`, `payments`, `transactions`, `refunds`, `rooms`, or `event_dates` table.** Nothing was renamed — those concepts simply do not exist as tables here.

### 1.3 Enums (`pg_enum`, verbatim)

| Enum | Values |
|---|---|
| `booking_status` | `pending_review`, `confirmed`, `cancelled`, `completed`, `needs_info`, `needs_payment`, `declined` |
| `payment_status` | `pending`, `deposit_paid`, `fully_paid`, `failed`, `refunded`, `invoiced` |
| `booking_origin` | `website`, `internal`, `external` |
| `booking_type` | `hourly`, `daily` |
| `package_type` | `none`, `basic`, `led`, `workshop` |
| `discount_type` | `percentage`, `fixed_amount` |
| `app_role` | `admin`, `staff` |

`lifecycle_status` is a plain `text` column, not an enum. Observed values: `pending`, `confirmed`, `pre_event_ready`, `in_progress`, `post_event`, `cancelled`.

**Values actually present in 75 bookings:**
- `status`: confirmed 54, cancelled 19, pending_review 2. (`completed`, `needs_info`, `needs_payment`, `declined` are **never used** — completion lives in `lifecycle_status`.)
- `payment_status`: fully_paid 39, deposit_paid 20, invoiced 9, pending 6, refunded 1. (`failed` never used.)
- `lifecycle_status`: post_event 45, cancelled 21, pre_event_ready 5, confirmed 2, in_progress 2.
- `booking_origin`: website 66, external 7, internal 2.

---

## 2. Answers to the 16 discovery questions

| # | Question | Answer |
|---|---|---|
| 1 | Relevant tables | §1.1 |
| 2 | Primary keys | All `uuid id` except `tracking_session.id` (text). `bookings.reservation_number` is a second UNIQUE key (`OEV-XXXXXX`). |
| 3 | Foreign keys | §1.2 |
| 4 | Status enums | §1.3 |
| 5 | **What IS the booking** | `public.bookings`. One row per reservation. 75 rows. |
| 6 | **What IS the customer** | Nothing. The customer is denormalized onto `bookings` (`full_name`, `email`, `phone`, `company`). Identity across bookings must be reconstructed by `lower(trim(email))`. That is what `customer_id` in the CSV is — a **derived** key, clearly labeled. |
| 7 | **What IS a payment** | Two layers. (a) **State on the booking**: `deposit_paid_at` / `balance_paid_at` + `deposit_amount` / `balance_amount` + `deposit_total_charged` / `balance_total_charged`. (b) **Provider confirmation**: `stripe_event_log` rows with `metadata.payment_type ∈ {deposit, balance, addon_invoice, standalone_invoice}` and `metadata.amount_cents`. Layer (a) is complete; layer (b) is complete only from 2026-01-17 forward. Add-on payments are a third stream in `booking_addon_invoices`. |
| 8 | **How you know it was paid** | `deposit_paid_at IS NOT NULL` (written by `stripe-webhook` on `checkout.session.completed`, and by admin for off-platform payments). Cross-checked against `stripe_event_log`; discrepancies surfaced in `paid_without_stripe_webhook_record`. |
| 9 | **How a date is held** | There is no hold table. The booking row itself is the hold, mirrored into GoHighLevel: `ghl_appointment_id` (74/75 rows) and the `ghl_appointment_created` entry in `booking_events`. Exposed as `date_hold_created_at` (derived, labeled). `bookings.confirmed_at` exists but is **NULL for 100% of rows** — never populated. `availability_blocks` are admin blocks, not customer holds. |
| 10 | **Cancelled / refunded** | Cancelled: `status='cancelled'` (19) and/or `lifecycle_status='cancelled'` (21 — the two disagree by 2). `cancelled_at` is set on only 13 of 19; the rest are recovered from `booking_events.event_type='booking_cancelled'`. Refunded: `payment_status='refunded'` — **1 row**. There is **no refund amount, no refund timestamp, no refund table.** |
| 11 | **Test vs real** | No `is_test` column. Derived by name/email pattern: 3 rows (`test1234` / grouptrellis@gmail.com, `orlandoeventTEST` / orlandoeventvenue@gmail.com, `Meta CAPI QA Test`). Internal/external ops bookings are separately flagged via `booking_origin`. |
| 12 | **Total booking value** | `bookings.total_amount`. Verified formula: `base_rental + cleaning_fee + package_cost + optional_services + taxes_fees − discount_amount`. This is **net of discount and excludes the Stripe processing fee**. |
| 13 | **Money actually collected** | `total_amount_paid` = `deposit_amount` (if `deposit_paid_at`) + `balance_amount` (if `balance_paid_at`) + paid `booking_addon_invoices.total_amount`. A gross variant `total_amount_charged` uses `deposit_total_charged`/`balance_total_charged` (includes the 3.5% processing fee). |
| 14 | **Multiple payments per booking** | Fixed two-installment model: deposit ≈ 50%, then balance. Stored as **columns, not rows**. Additional money arrives via `booking_addon_invoices` (7 bookings have one; 3 paid). `payment_count` in the CSV counts all three streams. |
| 15 | **Add-ons** | Booleans + rolled-up amounts on `bookings` (`setup_breakdown`, `tablecloths`, `tablecloth_quantity`, `package`/`package_cost`, `bar_package`/`bar_subtotal`, `optional_services`). `optional_services` is a **single rolled-up number** — setup, tablecloths and misc are not itemized on the booking. Itemization exists only in `booking_revenue_items`, which does not reconcile (§6.2), so those columns are suffixed `_ledger`. |
| 16 | **Attribution that actually exists** | For history: essentially none. `bookings.lead_source` has 3 mechanical values (`direct_site` 66, `external_admin` 7, `internal_admin` 2) and `bookings.source` is the literal string `'website'` on all 75. The real attribution stack (`tracking_visitor` with UTM/fbc/fbp/gclid) was deployed **2026-09-02** and links to exactly **1 booking**. `popup_leads` (from 2026-02-18) gives a soft inquiry timestamp for 19 bookings by email match. |

---

## 3. The Purchase definition used

> **PURCHASE = the first payment required to secure the date was successfully collected.**

Implemented as:

```sql
is_first_payment_paid = (deposit_paid_at IS NOT NULL AND deposit_amount > 0)
is_paid_booking       = is_first_payment_paid
is_valid_purchase     = is_first_payment_paid AND NOT is_test_booking
is_confirmed_paid_booking  = is_valid_purchase AND status = 'confirmed'
is_valid_website_purchase  = is_valid_purchase AND booking_origin = 'website'
```

What this deliberately does **not** do:
- does not treat booking creation as a purchase (75 created, 60 paid);
- does not treat checkout start as a purchase (`stripe_session_id` is written before payment);
- does not treat invoice creation as a purchase (the 9 `invoiced` bookings have `deposit_amount = 0` and never paid through the platform);
- does not remove cancelled or refunded bookings from `is_valid_purchase` — the payment *did* happen. Filter with `is_cancelled_booking` / `is_refunded_booking` if you want net-of-churn purchases.

The distinguishable funnel states, kept separate in the CSV:

| Stage | Column(s) | Count |
|---|---|---|
| Inquiry (popup lead) | `inquiry_created_at` | 19 of 75 (lead table starts 2026-02-18) |
| Booking created | `booking_created_at` | 75 |
| Payment initiated | `stripe_session_id` non-null | present on most rows; **not a purchase** |
| **First payment received** | `first_payment_at`, `is_paid_booking` | **60** |
| Date confirmed / held | `date_hold_created_at` (GHL appointment) | 74 |
| Fully paid | `fully_paid_at`, `is_fully_paid` | 39 |
| Event completed | `event_completed_at` (derived), `is_completed` | 45 by lifecycle; 25 have a timestamp |
| Cancelled | `cancelled_at`, `is_cancelled` | 19 |
| Refunded | `is_refunded` | 1 |

`booking_confirmed_at` is emitted but **always empty** — see §6.1.

---

## 4. Column provenance (the ones that matter)

| CSV column | Source |
|---|---|
| `booking_id`, `reservation_number`, `booking_reference` | `bookings.id`, `bookings.reservation_number` |
| `customer_id` | **DERIVED** `lower(trim(bookings.email))` — no customer table exists |
| `first_name`, `last_name` | **DERIVED** by splitting `bookings.full_name` on the first space. Only `full_name` is stored. |
| `primary_email/phone`, `full_name`, `company_name` | `bookings.*` |
| `customer_city/state/zip/country` | **EMPTY — not stored anywhere.** No billing address, no venue ZIP substituted. |
| `lead_id`, `inquiry_created_at`, `popup_lead_source` | `popup_leads`, matched by lowercased email |
| `booking_lead_source`, `booking_source`, `booking_origin` | `bookings.lead_source`, `.source`, `.booking_origin` |
| `utm_*`, `fbclid`, `fbc`, `fbp`, `gclid`, `landing_page`, `referrer` | `tracking_visitor` (first-touch). Effectively empty — §6.3 |
| `booking_created_at`, `event_date`, `event_start_local`, `event_end_local` | `bookings` |
| `date_hold_created_at` | **DERIVED** `min(booking_events.created_at)` where `event_type='ghl_appointment_created'` |
| `first_payment_at` | `bookings.deposit_paid_at`, falling back to first `stripe_event_log` deposit |
| `fully_paid_at` | `bookings.balance_paid_at` |
| `cancelled_at` | `bookings.cancelled_at`, falling back to `booking_events` `booking_cancelled` |
| `event_completed_at` | **DERIVED** `booking_events` `auto_lifecycle_post_event(_forced)` |
| `refunded_at`, `refunded_amount`, `cancellation_reason` | **EMPTY — not stored** |
| `total_booking_value` | `bookings.total_amount` (canonical) |
| `total_amount_paid` | deposit + balance (gated on their `*_paid_at`) + paid add-on invoices |
| `total_amount_charged` | same, using `*_total_charged` (incl. 3.5% processing fee) |
| `balance_remaining` | `total_booking_value + addon_paid − total_amount_paid` |
| `production_amount`, `production_package` | `bookings.package_cost`, `bookings.package` |
| `av_amount`, `has_av` | **EMPTY — no AV field exists.** The `package` enum (`basic`/`led`/`workshop`) is production, not AV. Not repurposed. |
| `bar_*` | `bookings.bar_*` |
| `optional_services_amount` | `bookings.optional_services` — rolled up, not itemized |
| `*_amount_ledger` | `booking_revenue_items`, **unreconciled** — §6.2 |
| `security_amount`, `has_security`, `room`, `setup_type`, `final_guest_count` | **EMPTY — not stored** |
| `stripe_deposit_events`, `stripe_balance_events`, `stripe_amount_charged` | `stripe_event_log` |
| `customer_*` history columns | Window functions over `lower(trim(email))` within `bookings` |

---

## 5. Validation counts

| Metric | Value |
|---|---|
| Total bookings (rows) | **75** |
| Unique customers (distinct email) | **65** |
| Unique phones | 65 |
| Paid bookings (`is_paid_booking`) | **60** |
| Valid purchases (`is_valid_purchase`, excl. test) | **58** |
| Confirmed + paid | 46 |
| Website-origin valid purchases | 58 |
| Confirmed bookings | 54 |
| Completed (`lifecycle_status='post_event'`) | 45 |
| Cancelled | 19 |
| Refunded | 1 |
| Zero-dollar | 9 |
| Test bookings | 3 |
| Internal/external ops bookings | 9 |
| Duplicate suspects (same email + same event_date) | 5 |
| Repeat-customer rows | 16 |
| Rows with a data-quality flag | 34 |
| **Total booking value** | **$63,138.67** |
| **Total amount paid (net)** | **$48,311.67** |
| Total amount charged (gross, incl. fees) | $50,038.55 |
| Outstanding balance | $16,034.00 |
| Refunded amount | **unknown — not stored** |
| Net collected revenue | **not derivable** (refund amount missing) |
| Booking date range | 2025-12-30 → 2026-09-03 |
| Event date range | 2026-01-17 → 2026-11-17 |

### Null rates

| Field | Filled |
|---|---|
| email | 100% |
| phone | 100% |
| first_name | 100% |
| last_name | 96% (3 single-token names) |
| email AND phone | **100%** |
| event_type | 100% |
| guest_count | 100% |
| booking_status | 100% |
| payment_status | 100% |
| total_booking_value | 100% |
| total_amount_paid | 100% |
| lead_source | 100% (but only 3 mechanical values) |
| reservation_number | 97.3% (2 internal bookings have none) |
| date_hold_created_at | 98.7% |
| company_name | 40% |
| inquiry_created_at | 25.3% |
| cancelled_at | 25.3% |
| event_completed_at | 33.3% |
| **customer_zip / city / state / country** | **0%** |
| **utm_source / fbclid / fbc / gclid** | **0%** |
| fbp | 1.3% (1 row) |
| booking_confirmed_at | **0%** |

---

## 6. Data quality issues

### 6.1 `confirmed_at` is never written
NULL on 75/75 rows. The column exists, the app never sets it. `booking_confirmed_at` is therefore empty in the CSV, and `date_hold_created_at` (GHL appointment creation) is supplied as a labeled proxy. **Requires a human decision** on which timestamp should mean "confirmed" going forward.

### 6.2 `booking_revenue_items` does not reconcile
The ledger holds 416 rows for 57 bookings, split into deposit/balance halves. `SUM(amount)` per booking equals `bookings.total_amount` for only **30 of 57**. Aggregate: ledger $47,042.70 vs bookings $54,084.67 over the same 57 bookings — a **$7,042 gap**. Deposit-half sums match `deposit_amount` on only 20 of 57.

Consequence: the ledger was **not** used as financial truth. Ledger-derived itemization (`setup_breakdown_amount_ledger`, `tablecloth_amount_ledger`, `other_addons_amount_ledger`) is exported with a `_ledger` suffix and flagged per row by `ledger_does_not_reconcile` (27 rows). **Requires a human decision** before anyone treats these as line-item revenue.

### 6.3 Ad attribution does not exist for the historical period
`tracking_visitor` / `tracking_session` / `tracking_event` first wrote data on **2026-09-02** — the day before this extract. Across all 75 bookings: 0 UTM, 0 fbclid, 0 fbc, 0 gclid, 1 fbp. `meta_event_delivery` holds 3 test rows.

**Implication for the Meta work: there is no historical click-ID or campaign attribution to model on.** What exists is first-party PII (email + phone on 100% of rows, name on 100%), which is what a Customer List audience needs. Campaign-level historical ROAS cannot be reconstructed from this database.

### 6.4 Stripe webhook log is incomplete before 2026-01-17
7 bookings have `deposit_paid_at` set but no corresponding `stripe_event_log` deposit row — flagged as `paid_without_stripe_webhook_record`. Five are from 2025-12-30 → 2026-01-14 (before webhook logging existed); two are later and unexplained.

Reconciliation: `stripe_event_log` booking-linked total is **$44,285.50** vs CSV `total_amount_charged` **$50,038.55**. The **$5,753.05** gap is those pre-log and off-platform payments. The booking-state columns are the more complete source; the webhook log is the more trustworthy one where it exists. Both are exported so the difference stays visible.

### 6.5 `standalone_invoice` revenue is outside this dataset
`stripe_event_log` also holds 17 `standalone_invoice` payments totalling **$10,523.74**, from the `invoices` table (18 rows, 16 paid). `invoices` has **no `booking_id` column** — that revenue cannot be attributed to a booking. Total Stripe collections across everything are $54,809.24; this booking dataset accounts for $44,285.50 of the webhook-logged portion. The $10,523.74 is not missing, it is **not booking revenue**.

### 6.6 Nine zero-dollar bookings
All 9 have `total_amount = 0`, `payment_status = 'invoiced'`, `booking_origin ∈ {internal, external}` — Peerspace-style and partner bookings settled off-platform. Flagged `is_zero_dollar_booking` + `is_internal_booking`. Kept, not deleted. **They are real events with unknown revenue.**

### 6.7 `status` and `lifecycle_status` disagree
19 rows have `status='cancelled'`, 21 have `lifecycle_status='cancelled'`. Both raw values are exported; `is_cancelled` follows `status`. Also: one booking (`OEV-Y4UP6Y`) is `status='cancelled'` while `payment_status='fully_paid'` with both payment timestamps set — cancelled after full payment, with no refund record.

### 6.8 Cancellation reason is not captured
No column, no consistent event metadata. `booking_events.booking_cancelled` metadata carries only `previous_status`, `previous_lifecycle`, `jobs_deleted`, `cancelled_at`. `cancellation_reason` is empty in the CSV.

### 6.9 `event_type` is not normalized at the source
13 distinct raw values mixing slug and title case (`Corporate Event` vs `corporate-meeting`, `other` 22 vs `Other` 2). `event_type_raw` is preserved verbatim; `event_type_normalized` lowercases, hyphenates, and substitutes `event_type_other` where the raw value is `other`. Both columns are in the CSV.

### 6.10 Duplicate suspects
5 rows share `(email, event_date)` with another row. Not deleted — flagged `is_duplicate_booking` for human review.

### 6.11 `cancelled_at` missing on 6 cancelled bookings
Recovered from `booking_events` where possible. Rows where neither source has it are caught by `possible_data_quality_issue`.

---

## 7. Fields requested that do not exist

Left empty, never inferred:

- `customer_city`, `customer_state`, `customer_zip`, `customer_country` — no address is collected anywhere. The venue's own ZIP was **not** substituted.
- Age, DOB, gender, income, household — absent, and no event attribute was converted into a demographic.
- `refunded_at`, `refunded_amount` — no refund table, column, or event.
- `cancellation_reason` — not captured.
- `final_guest_count` — only the booked estimate exists.
- `av_amount`, `has_av` — no AV concept. `package` is production.
- `security_amount`, `has_security` — no security service.
- `room`, `space`, `venue_location`, `setup_type`, `layout_type` — single-space venue, none stored.
- `net_revenue_if_available` — no cost data anywhere.
- `is_payment_failed` — `payment_status='failed'` exists in the enum but is never used and failed attempts are not persisted.
- Per-booking `av_package`, `production_package` names beyond the enum, `bar_package` label — `production_package` and `bar_package`/`bar_package_label` are exported; there is no AV package.

---

## 8. Reconciliation

| Check | Source | CSV | Match |
|---|---|---|---|
| `COUNT(DISTINCT bookings.id)` | 75 | 75 rows | ✅ |
| Bookings with `deposit_paid_at` and `deposit_amount>0` | 60 | `is_paid_booking = true` → 60 | ✅ |
| `SUM(bookings.total_amount)` | $63,138.67 | `SUM(total_booking_value)` $63,138.67 | ✅ |
| Paid deposit+balance, net | $47,104.67 | — | — |
| Paid add-on invoices | $1,207.00 | `SUM(addon_invoice_paid_amount)` $1,207.00 | ✅ |
| Combined net collected | $48,311.67 | `SUM(total_amount_paid)` $48,311.67 | ✅ |
| Cancelled | 19 | 19 | ✅ |
| `lifecycle_status='post_event'` | 45 | `is_completed` 45 | ✅ |
| Refunded | 1 | 1 | ✅ |
| Zero-dollar | 9 | 9 | ✅ |
| Distinct lowercased email | 65 | 65 | ✅ |
| Stripe webhook, booking-linked | $44,285.50 | `SUM(stripe_amount_charged)` $44,285.50 | ✅ |
| Stripe webhook vs gross charged | $44,285.50 | `SUM(total_amount_charged)` $50,038.55 | ❌ **−$5,753.05**, explained in §6.4 |
| Stripe, all payment types | $54,809.24 | out of scope | $10,523.74 is `standalone_invoice` (§6.5) |

No row was dropped, deduplicated, or silently filtered. The CSV contains all 75 booking rows including test, internal, zero-dollar, cancelled and refunded — every one flagged rather than removed.

---

## 9. Decisions a human still needs to make

1. **What "confirmed" means.** `confirmed_at` is dead. Is the GHL appointment the hold, or should confirmation be the deposit payment?
2. **Whether `booking_revenue_items` is trustworthy.** 27 of 57 bookings do not reconcile. Either the ledger has a write bug or it is intentionally an allocation view. Nobody should use the `_ledger` columns until this is settled.
3. **The 9 zero-dollar bookings.** Real events, revenue settled off-platform, unrecorded. Should they carry an imputed value, be excluded from revenue analysis, or be backfilled?
4. **The single refunded booking.** Amount and date unknown. Needs to be pulled from the Stripe dashboard by hand if the number matters.
5. **`OEV-Y4UP6Y`** — cancelled while fully paid, no refund record. Real refund, or a status error?
6. **The 5 duplicate suspects.** Genuine repeat events on the same day, or double entries?
7. **The 2 later `paid_without_stripe_webhook_record` rows** (after webhook logging existed) — manual/off-platform payments, or a webhook that was dropped?

---

## 10. Privacy note

The CSV contains raw first-party PII (email, phone, name, company) because the brief asks for an assessment of whether a Meta Customer Audience is feasible. **Nothing was sent anywhere.** No Meta API was called, no audience was created, no upload was performed. The file is a local internal artifact.

If it is later used for a Customer List audience, the usable identifiers are: email (100%), phone (100%), first name (100%), last name (96%). Country is **not** stored and must not be assumed from the venue's location. Event type, guest count and package were not converted into demographic attributes.
