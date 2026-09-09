-- ============================================================================
-- oev_bookings_export.sql
-- Orlando Event Venue — historical booking master extract (READ ONLY)
-- Grain: ONE ROW PER BOOKING (public.bookings.id)
-- Generated 2026-09-03. Supabase project ref vsvsgesgqjtwutadcshi.
--
-- Nothing in this script writes. No DDL, no DML, no temp objects.
--
-- Source-of-truth decisions (see oev_bookings_schema_report.md):
--   booking      -> public.bookings
--   customer     -> denormalized on public.bookings (NO customers/contacts table exists)
--   payment      -> public.bookings.deposit_paid_at / balance_paid_at (webhook-written)
--                   cross-checked against public.stripe_event_log (provider-confirmed)
--   add-on money -> public.booking_addon_invoices (paid rows only)
--   ledger       -> public.booking_revenue_items (allocation ledger, NOT reconciled — see report)
-- ============================================================================

WITH
-- Provider-confirmed Stripe payments (checkout.session.completed webhooks only).
-- Incomplete before 2026-01-17: logging started then. Used for reconciliation, not truth.
stripe AS (
  SELECT booking_id,
         count(*) FILTER (WHERE metadata->>'payment_type' = 'deposit')            AS stripe_deposit_events,
         count(*) FILTER (WHERE metadata->>'payment_type' = 'balance')            AS stripe_balance_events,
         count(*) FILTER (WHERE metadata->>'payment_type' = 'addon_invoice')      AS stripe_addon_events,
         min(processed_at) FILTER (WHERE metadata->>'payment_type' = 'deposit')   AS stripe_first_deposit_at,
         sum((metadata->>'amount_cents')::numeric)/100.0                          AS stripe_amount_charged
  FROM public.stripe_event_log
  WHERE booking_id IS NOT NULL
  GROUP BY booking_id
),

-- Paid add-on invoices attached to a booking (extra revenue after the original booking).
addons AS (
  SELECT booking_id,
         count(*)                                                     AS addon_invoice_count,
         count(*) FILTER (WHERE payment_status = 'paid')              AS addon_invoice_paid_count,
         sum(total_amount)  FILTER (WHERE payment_status = 'paid')    AS addon_paid_net,
         sum(total_charged) FILTER (WHERE payment_status = 'paid')    AS addon_paid_gross,
         max(paid_at)       FILTER (WHERE payment_status = 'paid')    AS addon_last_paid_at,
         bool_or(bar_package <> 'none')                               AS addon_has_bar,
         bool_or(setup_breakdown)                                     AS addon_has_setup,
         bool_or(tablecloths)                                         AS addon_has_tablecloth
  FROM public.booking_addon_invoices
  GROUP BY booking_id
),

-- Allocation ledger. Split 50/50 deposit/balance, written when each half is paid.
-- DOES NOT reconcile to bookings.total_amount for 27 of 57 bookings — flagged, not used as truth.
ledger AS (
  SELECT booking_id,
         count(*)                                                                       AS revenue_item_count,
         sum(amount)                                                                    AS ledger_total,
         sum(amount) FILTER (WHERE item_category = 'addon' AND item_type = 'setup_breakdown') AS ledger_setup_breakdown,
         sum(amount) FILTER (WHERE item_category = 'addon' AND item_type = 'tablecloth')      AS ledger_tablecloth,
         sum(amount) FILTER (WHERE item_category = 'addon' AND item_type = 'misc')            AS ledger_other_addons,
         sum(amount) FILTER (WHERE item_category = 'production')                              AS ledger_production,
         bool_or(is_historical)                                                               AS ledger_has_historical_rows
  FROM public.booking_revenue_items
  GROUP BY booking_id
),

-- Lifecycle timestamps that the bookings table does not persist.
evt AS (
  SELECT booking_id,
         min(created_at) FILTER (WHERE event_type = 'ghl_appointment_created')  AS ghl_appointment_created_at,
         min(created_at) FILTER (WHERE event_type = 'booking_cancelled')        AS event_cancelled_at,
         min(created_at) FILTER (WHERE event_type IN ('auto_lifecycle_post_event','auto_lifecycle_post_event_forced')) AS post_event_at,
         count(*) FILTER (WHERE event_type = 'booking_rescheduled')             AS reschedule_count
  FROM public.booking_events
  GROUP BY booking_id
),

-- Popup lead capture (started 2026-02-18). Matched to bookings by lowercased email ONLY.
lead AS (
  SELECT lower(email) AS email_key,
         min(id::text)         AS lead_id_any,
         min(created_at)       AS lead_created_at,
         min(lead_source)      AS lead_source,
         min(coupon_code)      AS lead_coupon_code
  FROM public.popup_leads
  GROUP BY lower(email)
),

-- First-party ad attribution. Table went live 2026-09-02: effectively empty for history.
attr AS (
  SELECT v.booking_id,
         v.fbp, v.fbc,
         v.first_utm->>'utm_source'   AS utm_source,
         v.first_utm->>'utm_medium'   AS utm_medium,
         v.first_utm->>'utm_campaign' AS utm_campaign,
         v.first_utm->>'utm_content'  AS utm_content,
         v.first_utm->>'utm_term'     AS utm_term,
         v.first_utm->>'gclid'        AS gclid,
         v.first_utm->>'fbclid'       AS fbclid,
         v.first_landing_page, v.first_referrer
  FROM public.tracking_visitor v
  WHERE v.booking_id IS NOT NULL
),

base AS (
  SELECT
    b.*,
    lower(trim(b.email))                                     AS customer_key,
    -- money actually received, NET of Stripe processing fee (what the customer owed)
    (CASE WHEN b.deposit_paid_at IS NOT NULL THEN b.deposit_amount ELSE 0 END)
      + (CASE WHEN b.balance_paid_at IS NOT NULL THEN b.balance_amount ELSE 0 END)
      + COALESCE(a.addon_paid_net, 0)                        AS amount_paid_net,
    -- money actually charged to the card, GROSS (includes processing fee), where recorded
    (CASE WHEN b.deposit_paid_at IS NOT NULL THEN COALESCE(b.deposit_total_charged, b.deposit_amount) ELSE 0 END)
      + (CASE WHEN b.balance_paid_at IS NOT NULL THEN COALESCE(b.balance_total_charged, b.balance_amount) ELSE 0 END)
      + COALESCE(a.addon_paid_gross, a.addon_paid_net, 0)    AS amount_charged_gross,
    s.stripe_deposit_events, s.stripe_balance_events, s.stripe_addon_events,
    s.stripe_first_deposit_at, s.stripe_amount_charged,
    a.addon_invoice_count, a.addon_invoice_paid_count, a.addon_paid_net, a.addon_paid_gross,
    a.addon_last_paid_at, a.addon_has_bar, a.addon_has_setup, a.addon_has_tablecloth,
    l.revenue_item_count, l.ledger_total, l.ledger_setup_breakdown, l.ledger_tablecloth,
    l.ledger_other_addons, l.ledger_production, l.ledger_has_historical_rows,
    e.ghl_appointment_created_at, e.event_cancelled_at, e.post_event_at, e.reschedule_count,
    at.fbp, at.fbc, at.utm_source, at.utm_medium, at.utm_campaign, at.utm_content,
    at.utm_term, at.gclid, at.fbclid, at.first_landing_page, at.first_referrer,
    ld.lead_id_any, ld.lead_created_at, ld.lead_source AS popup_lead_source, ld.lead_coupon_code
  FROM public.bookings b
  LEFT JOIN stripe s  ON s.booking_id  = b.id
  LEFT JOIN addons a  ON a.booking_id  = b.id
  LEFT JOIN ledger l  ON l.booking_id  = b.id
  LEFT JOIN evt    e  ON e.booking_id  = b.id
  LEFT JOIN attr   at ON at.booking_id = b.id
  LEFT JOIN lead   ld ON ld.email_key  = lower(trim(b.email))
),

flagged AS (
  SELECT
    x.*,
    -- ---- exclusion / quality flags -----------------------------------------
    (x.email ILIKE '%test%' OR x.full_name ILIKE '%test%'
     OR x.email IN ('grouptrellis@gmail.com','orlandoeventvenue@gmail.com'))      AS is_test_booking,
    (x.booking_origin::text IN ('internal','external'))                            AS is_internal_booking,
    (x.total_amount = 0)                                                           AS is_zero_dollar_booking,
    (x.status::text = 'cancelled')                                                 AS is_cancelled_booking,
    (x.payment_status::text = 'refunded')                                          AS is_refunded_booking,
    -- ---- purchase definition ------------------------------------------------
    -- PURCHASE = the first payment required to hold the date was successfully collected.
    (x.deposit_paid_at IS NOT NULL AND x.deposit_amount > 0)                       AS is_first_payment_paid,
    (x.balance_paid_at IS NOT NULL)                                                AS is_fully_paid_flag
  FROM base x
)

SELECT
  -- A. IDENTIFIERS ----------------------------------------------------------
  f.id                                                    AS booking_id,
  f.reservation_number,
  f.reservation_number                                    AS booking_reference,
  f.customer_key                                          AS customer_id,      -- derived: lower(email). No customers table exists.
  f.ghl_contact_id                                        AS crm_contact_id,
  f.policy_id,

  -- B. CUSTOMER -------------------------------------------------------------
  f.email                                                 AS primary_email,
  f.phone                                                 AS primary_phone,
  split_part(trim(f.full_name), ' ', 1)                   AS first_name,       -- DERIVED from full_name
  NULLIF(regexp_replace(trim(f.full_name), '^\S+\s*', ''), '') AS last_name,   -- DERIVED from full_name
  f.full_name,
  f.company                                               AS company_name,
  f.signer_name                                           AS contract_signer_name,
  NULL::text AS customer_city,      -- NOT STORED
  NULL::text AS customer_state,     -- NOT STORED
  NULL::text AS customer_zip,       -- NOT STORED
  NULL::text AS customer_country,   -- NOT STORED

  -- C. LEAD / ACQUISITION ---------------------------------------------------
  f.lead_id_any                                           AS lead_id,
  f.lead_created_at                                       AS inquiry_created_at,
  f.lead_source                                           AS booking_lead_source,   -- bookings.lead_source
  f.popup_lead_source                                     AS popup_lead_source,     -- popup_leads.lead_source
  f.source                                                AS booking_source,
  f.booking_origin::text                                  AS booking_origin,
  f.utm_source, f.utm_medium, f.utm_campaign, f.utm_content, f.utm_term,
  f.fbclid, f.fbc, f.fbp, f.gclid,
  f.first_landing_page                                    AS landing_page,
  f.first_referrer                                        AS referrer,

  -- D. TIMELINE -------------------------------------------------------------
  f.created_at                                            AS booking_created_at,
  f.confirmed_at                                          AS booking_confirmed_at,     -- ALWAYS NULL in prod
  f.ghl_appointment_created_at                            AS date_hold_created_at,     -- DERIVED proxy for "date held"
  f.event_date,
  (f.event_date::text || ' ' || COALESCE(f.start_time::text,''))  AS event_start_local,
  (f.event_date::text || ' ' || COALESCE(f.end_time::text,''))    AS event_end_local,
  COALESCE(f.deposit_paid_at, f.stripe_first_deposit_at)  AS first_payment_at,
  f.balance_paid_at                                       AS fully_paid_at,
  f.addon_last_paid_at                                    AS last_addon_paid_at,
  COALESCE(f.cancelled_at, f.event_cancelled_at)          AS cancelled_at,
  NULL::timestamptz                                       AS refunded_at,             -- NOT STORED
  f.post_event_at                                         AS event_completed_at,
  f.updated_at                                            AS record_updated_at,
  (f.event_date - f.created_at::date)                     AS booking_lead_time_days,
  (f.created_at::date - f.lead_created_at::date)          AS inquiry_to_booking_days,
  (COALESCE(f.deposit_paid_at, f.stripe_first_deposit_at)::date - f.created_at::date) AS booking_to_first_payment_days,

  -- E. EVENT ----------------------------------------------------------------
  f.event_type                                            AS event_type_raw,
  lower(replace(COALESCE(NULLIF(f.event_type,'other'), f.event_type_other, f.event_type), ' ', '-')) AS event_type_normalized,
  f.event_type_other,
  f.number_of_guests                                      AS expected_guest_count,
  NULL::int                                               AS final_guest_count,        -- NOT STORED
  CASE WHEN f.start_time IS NOT NULL AND f.end_time IS NOT NULL
       THEN round(EXTRACT(epoch FROM (f.end_time - f.start_time))/3600.0, 2) END       AS event_duration_hours,
  f.booking_type::text                                    AS rental_basis,             -- hourly | daily
  to_char(f.event_date, 'Dy')                             AS event_day_of_week,
  (EXTRACT(isodow FROM f.event_date) IN (6,7))            AS is_weekend,
  NULL::text                                              AS room,                     -- single-space venue; NOT STORED
  NULL::text                                              AS setup_type,               -- NOT STORED

  -- F. BOOKING STATUS -------------------------------------------------------
  f.status::text                                          AS booking_status_raw,
  f.lifecycle_status                                      AS booking_lifecycle_status,
  (f.status::text = 'pending_review')                     AS is_pending,
  (f.status::text = 'confirmed')                          AS is_confirmed,
  (f.lifecycle_status = 'post_event')                     AS is_completed,
  f.is_cancelled_booking                                  AS is_cancelled,
  NULL::text                                              AS cancellation_reason,      -- NOT STORED

  -- G. PAYMENT --------------------------------------------------------------
  f.payment_status::text                                  AS payment_status_raw,
  CASE WHEN f.deposit_paid_at IS NOT NULL THEN 'paid'
       WHEN f.payment_status::text = 'invoiced' THEN 'invoiced_offline'
       ELSE 'unpaid' END                                  AS first_payment_status,
  f.is_first_payment_paid,
  f.is_fully_paid_flag                                    AS is_fully_paid,
  NULL::boolean                                           AS is_payment_failed,        -- no failure records retained
  f.is_refunded_booking                                   AS is_refunded,
  ( (CASE WHEN f.deposit_paid_at IS NOT NULL THEN 1 ELSE 0 END)
  + (CASE WHEN f.balance_paid_at IS NOT NULL THEN 1 ELSE 0 END)
  + COALESCE(f.addon_invoice_paid_count, 0) )             AS payment_count,
  CASE WHEN f.deposit_paid_at IS NOT NULL THEN f.deposit_amount END        AS first_payment_amount,
  CASE WHEN f.deposit_paid_at IS NOT NULL THEN f.deposit_total_charged END AS first_payment_amount_charged,
  round(f.amount_paid_net, 2)                             AS total_amount_paid,
  round(f.amount_charged_gross, 2)                        AS total_amount_charged,
  round(f.total_amount + COALESCE(f.addon_paid_net,0) - f.amount_paid_net, 2) AS balance_remaining,
  NULL::numeric                                           AS refunded_amount,          -- NOT STORED
  'stripe'                                                AS payment_provider,
  f.stripe_session_id,
  f.stripe_payment_intent_id,

  -- H. ECONOMICS ------------------------------------------------------------
  f.base_rental                                           AS base_rental_amount,
  CASE WHEN f.booking_type::text = 'hourly' THEN f.base_rental END AS hourly_rental_amount,
  CASE WHEN f.booking_type::text = 'daily'  THEN f.base_rental END AS daily_rental_amount,
  f.cleaning_fee,
  NULL::numeric                                           AS av_amount,                -- no separate AV field
  f.package_cost                                          AS production_amount,
  f.package::text                                         AS production_package,
  f.bar_subtotal                                          AS bar_service_amount,
  f.bar_package,
  f.bar_package_label,
  f.bar_guest_count,
  f.bar_rate_per_guest,
  f.optional_services                                     AS optional_services_amount, -- setup + tablecloths + misc, NOT itemized on bookings
  f.ledger_setup_breakdown                                AS setup_breakdown_amount_ledger,
  f.ledger_tablecloth                                     AS tablecloth_amount_ledger,
  f.ledger_other_addons                                   AS other_addons_amount_ledger,
  NULL::numeric                                           AS security_amount,          -- NOT STORED
  f.discount_amount,
  f.discount_code                                         AS coupon_code,
  f.taxes_fees                                            AS tax_amount,
  (f.base_rental + f.cleaning_fee + f.package_cost + f.optional_services + f.bar_subtotal) AS subtotal,
  f.total_amount                                          AS total_booking_value,
  f.deposit_amount,
  f.balance_amount,
  f.deposit_fee, f.balance_fee, f.processing_fee_pct,
  f.deposit_total_charged, f.balance_total_charged,
  round(COALESCE(f.addon_paid_net,0), 2)                  AS addon_invoice_paid_amount,

  -- I. ADD-ONS --------------------------------------------------------------
  (f.package::text <> 'none')                             AS has_production,
  NULL::boolean                                           AS has_av,                   -- NOT STORED
  (f.bar_package <> 'none' OR f.beer_wine_service OR COALESCE(f.addon_has_bar,false)) AS has_bar_service,
  (f.setup_breakdown OR COALESCE(f.addon_has_setup,false))     AS has_setup_breakdown,
  (f.tablecloths OR COALESCE(f.addon_has_tablecloth,false))    AS has_tablecloth,
  f.tablecloth_quantity,
  NULL::boolean                                           AS has_security,             -- NOT STORED
  (f.optional_services > 0)                               AS has_other_addons,
  ( (CASE WHEN f.package::text <> 'none' THEN 1 ELSE 0 END)
  + (CASE WHEN f.bar_package <> 'none' OR f.beer_wine_service THEN 1 ELSE 0 END)
  + (CASE WHEN f.setup_breakdown THEN 1 ELSE 0 END)
  + (CASE WHEN f.tablecloths THEN 1 ELSE 0 END) )         AS addon_count,
  (f.package_cost + f.optional_services + f.bar_subtotal) AS addon_total,
  COALESCE(f.addon_invoice_count, 0)                      AS addon_invoice_count,

  -- J. META PURCHASE QUALITY ------------------------------------------------
  f.is_first_payment_paid                                 AS is_paid_booking,
  (f.is_first_payment_paid AND NOT f.is_test_booking)     AS is_valid_purchase,
  (f.is_first_payment_paid AND NOT f.is_test_booking
     AND f.status::text = 'confirmed')                    AS is_confirmed_paid_booking,
  (f.is_first_payment_paid AND NOT f.is_test_booking
     AND f.booking_origin::text = 'website')              AS is_valid_website_purchase,

  -- K. DATA QUALITY ---------------------------------------------------------
  f.is_test_booking,
  f.is_internal_booking,
  (count(*) OVER (PARTITION BY f.customer_key, f.event_date) > 1) AS is_duplicate_booking,
  f.is_zero_dollar_booking,
  f.is_cancelled_booking,
  f.is_refunded_booking,
  -- NOTE: confirmed_at is NULL for 100% of rows (column never populated in prod).
  -- That is a systemic schema issue, documented in the report, not a per-row anomaly,
  -- so it is deliberately NOT part of this flag.
  (f.reservation_number IS NULL
   OR (f.is_cancelled_booking AND f.cancelled_at IS NULL AND f.event_cancelled_at IS NULL)
   OR (f.deposit_paid_at IS NOT NULL AND COALESCE(f.stripe_deposit_events,0) = 0)
   OR (f.revenue_item_count IS NOT NULL AND abs(COALESCE(f.ledger_total,0) - f.total_amount) > 0.05)
  )                                                       AS possible_data_quality_issue,
  (f.deposit_paid_at IS NOT NULL AND COALESCE(f.stripe_deposit_events,0) = 0) AS paid_without_stripe_webhook_record,
  (f.revenue_item_count IS NOT NULL AND abs(COALESCE(f.ledger_total,0) - f.total_amount) > 0.05) AS ledger_does_not_reconcile,
  COALESCE(f.stripe_deposit_events,0)                     AS stripe_deposit_events,
  COALESCE(f.stripe_balance_events,0)                     AS stripe_balance_events,
  round(COALESCE(f.stripe_amount_charged,0), 2)           AS stripe_amount_charged,
  COALESCE(f.reschedule_count, 0)                         AS reschedule_count,

  -- L. CUSTOMER-LEVEL HISTORY (window over lower(email)) ---------------------
  count(*)      OVER w                                    AS customer_total_bookings,
  count(*)      FILTER (WHERE f.is_first_payment_paid) OVER w AS customer_paid_bookings,
  sum(f.total_amount)   OVER w                            AS customer_lifetime_booking_value,
  round(sum(f.amount_paid_net) OVER w, 2)                 AS customer_lifetime_amount_paid,
  min(f.created_at)     OVER w                            AS first_customer_booking_date,
  max(f.created_at)     OVER w                            AS most_recent_customer_booking_date,
  (count(*) OVER w > 1)                                   AS is_repeat_customer,

  -- M. ANALYSIS FIELDS ------------------------------------------------------
  EXTRACT(year  FROM f.created_at)::int                   AS booking_year,
  to_char(f.created_at, 'YYYY-MM')                        AS booking_month,
  EXTRACT(year  FROM f.event_date)::int                   AS event_year,
  to_char(f.event_date, 'YYYY-MM')                        AS event_month,
  CASE WHEN f.number_of_guests > 0 THEN round(f.total_amount / f.number_of_guests, 2) END AS revenue_per_guest,
  CASE WHEN f.start_time IS NOT NULL AND f.end_time IS NOT NULL
            AND EXTRACT(epoch FROM (f.end_time - f.start_time)) > 0
       THEN round(f.total_amount / (EXTRACT(epoch FROM (f.end_time - f.start_time))/3600.0), 2) END AS revenue_per_hour

FROM flagged f
WINDOW w AS (PARTITION BY f.customer_key)
ORDER BY f.created_at;
