-- Meta Ads end-to-end attribution reporting for OEV (2026-09-02).
-- Additive only: views over the tracking tables. Nothing is dropped, no
-- existing policy changes, no booking column is touched.
--
-- Source of truth for revenue is ALWAYS the bookings table in this database.
-- Meta is an attribution / optimization layer, never the ledger. ROAS is not
-- computed here: this DB owns bookings and revenue, Meta Ads Manager owns
-- spend.
--
-- security_invoker = on means the caller's RLS applies. For the views built on
-- tracking_event / meta_event_delivery that is enough on its own: those tables
-- are admin-read-only.
--
-- v_paid_booking_attribution is different, and the difference matters:
-- public.bookings currently has RLS DISABLED, so leaning on the underlying
-- table would hand every authenticated user a pre-joined booking report. It
-- therefore carries its own has_role() guard in the WHERE clause, which is
-- evaluated once and short-circuits the whole view for a non-admin. The four
-- rollups select from it and inherit that guard.
--
-- This is a containment measure, not a fix: bookings RLS is tracked separately
-- in docs/security/. If it is ever enabled, this guard stays correct.

-- ---------------------------------------------------------------------------
-- 1) One row per booking whose deposit actually cleared, with the ad context
--    that acquired it.
--
--    Visitor lookup: a guest owns several tracking_visitor rows. Prefer the
--    one explicitly stitched to this booking; fall back to a row carrying the
--    same email (this is what makes attribution survive "clicked the ad on
--    Instagram Monday, booked from a laptop Thursday"). Newest touch wins.
-- ---------------------------------------------------------------------------
create or replace view public.v_paid_booking_attribution
with (security_invoker = on) as
select
  b.id                                            as booking_id,
  b.reservation_number,
  b.payment_status,
  b.status                                        as booking_status,
  b.booking_origin,
  b.event_type,
  b.event_date,
  b.number_of_guests,
  b.booking_type,
  -- money: what actually hit the card vs. the contract value
  b.deposit_total_charged                         as deposit_charged,
  b.deposit_amount                                as deposit_base,
  b.total_amount                                  as contract_total,
  b.balance_amount,
  'USD'::text                                     as currency,
  b.deposit_paid_at,
  b.created_at                                    as booking_created_at,
  -- first touch
  v.first_utm ->> 'utm_source'                    as first_touch_source,
  v.first_utm ->> 'utm_medium'                    as first_touch_medium,
  v.first_utm ->> 'utm_campaign'                  as first_touch_campaign,
  v.first_utm ->> 'utm_term'                      as first_touch_adset,
  v.first_utm ->> 'utm_content'                   as first_touch_ad,
  v.first_utm ->> 'meta_campaign_id'              as first_touch_campaign_id,
  v.first_utm ->> 'meta_adset_id'                 as first_touch_adset_id,
  v.first_utm ->> 'meta_ad_id'                    as first_touch_ad_id,
  v.first_utm ->> 'meta_placement'                as first_touch_placement,
  v.first_landing_page,
  v.first_referrer,
  v.first_touch_at,
  -- last paid touch
  v.last_utm ->> 'utm_source'                     as last_touch_source,
  v.last_utm ->> 'utm_medium'                     as last_touch_medium,
  v.last_utm ->> 'utm_campaign'                   as last_touch_campaign,
  v.last_utm ->> 'utm_term'                       as last_touch_adset,
  v.last_utm ->> 'utm_content'                    as last_touch_ad,
  v.last_utm ->> 'meta_campaign_id'               as last_touch_campaign_id,
  v.last_utm ->> 'meta_adset_id'                  as last_touch_adset_id,
  v.last_utm ->> 'meta_ad_id'                     as last_touch_ad_id,
  v.last_utm ->> 'meta_placement'                 as last_touch_placement,
  v.last_touch_at,
  -- reporting attribution = last paid touch, falling back to first touch
  coalesce(v.last_utm ->> 'utm_source',      v.first_utm ->> 'utm_source')      as channel,
  coalesce(v.last_utm ->> 'utm_campaign',    v.first_utm ->> 'utm_campaign')    as campaign,
  coalesce(v.last_utm ->> 'utm_content',     v.first_utm ->> 'utm_content')     as creative,
  coalesce(v.last_utm ->> 'utm_term',        v.first_utm ->> 'utm_term')        as geo_adset,
  coalesce(v.last_utm ->> 'meta_ad_id',      v.first_utm ->> 'meta_ad_id')      as meta_ad_id,
  coalesce(v.last_utm ->> 'meta_adset_id',   v.first_utm ->> 'meta_adset_id')   as meta_adset_id,
  coalesce(v.last_utm ->> 'meta_campaign_id',v.first_utm ->> 'meta_campaign_id') as meta_campaign_id,
  coalesce(v.last_utm ->> 'meta_placement',  v.first_utm ->> 'meta_placement')  as meta_placement,
  v.fbp,
  v.fbc,
  v.ad_consent,
  d.meta_event_id                                 as meta_purchase_event_id,
  d.status                                        as meta_delivery_status,
  case when d.status like 'skipped%' then d.status end as meta_skip_reason
from public.bookings b
left join lateral (
  select tv.*
    from public.tracking_visitor tv
   where tv.booking_id = b.id
      or (b.email is not null and tv.email = lower(btrim(b.email)))
   order by (tv.booking_id = b.id) desc,
            coalesce(tv.last_touch_at, tv.last_seen_at) desc
   limit 1
) v on true
left join public.meta_event_delivery d
       on d.booking_id = b.id and d.event_name = 'Purchase'
where b.deposit_paid_at is not null
  -- Admin gate. public.bookings has RLS disabled, so without this any
  -- authenticated user could read the whole attribution report.
  and public.has_role(auth.uid(), 'admin'::app_role);

comment on view public.v_paid_booking_attribution is
  'One row per booking with a cleared deposit, plus first/last Meta touch and CAPI Purchase delivery status. The bookings table is the financial truth; Meta is attribution only.';

-- ---------------------------------------------------------------------------
-- 2) Rollups. Grouped on the stable Meta object id when present (names change
--    mid-flight, ids never do) and labelled with the utm name.
-- ---------------------------------------------------------------------------
create or replace view public.v_meta_creative_performance
with (security_invoker = on) as
select
  coalesce(creative, '(none)')            as creative,
  meta_ad_id,
  count(*)                                as paid_bookings,
  sum(coalesce(deposit_charged, deposit_base, 0)) as deposit_revenue,
  sum(coalesce(contract_total, 0))        as contract_revenue,
  round(avg(coalesce(contract_total, 0)), 2) as avg_contract_value,
  min(deposit_paid_at)                    as first_paid_booking,
  max(deposit_paid_at)                    as most_recent_paid_booking
from public.v_paid_booking_attribution
group by 1, 2;

create or replace view public.v_meta_geo_performance
with (security_invoker = on) as
select
  coalesce(geo_adset, '(none)')           as geo_adset,
  meta_adset_id,
  count(*)                                as paid_bookings,
  sum(coalesce(deposit_charged, deposit_base, 0)) as deposit_revenue,
  sum(coalesce(contract_total, 0))        as contract_revenue,
  round(avg(coalesce(contract_total, 0)), 2) as avg_contract_value
from public.v_paid_booking_attribution
group by 1, 2;

create or replace view public.v_meta_creative_geo_performance
with (security_invoker = on) as
select
  coalesce(creative, '(none)')            as creative,
  coalesce(geo_adset, '(none)')           as geo_adset,
  count(*)                                as paid_bookings,
  sum(coalesce(contract_total, 0))        as contract_revenue
from public.v_paid_booking_attribution
group by 1, 2;

-- Channel rollup: answers "did this booking come from Meta, Google, or
-- organic". Meta is only one of the sources this pipeline captures.
create or replace view public.v_channel_performance
with (security_invoker = on) as
select
  coalesce(channel, '(direct/organic)')   as channel,
  coalesce(campaign, '(none)')            as campaign,
  count(*)                                as paid_bookings,
  sum(coalesce(contract_total, 0))        as contract_revenue,
  round(avg(coalesce(contract_total, 0)), 2) as avg_contract_value
from public.v_paid_booking_attribution
group by 1, 2;

-- ---------------------------------------------------------------------------
-- 3) Daily first-party funnel, straight off the internal ledger. These counts
--    are consent-independent and complete even when Meta sends are skipped.
-- ---------------------------------------------------------------------------
create or replace view public.v_booking_funnel_daily
with (security_invoker = on) as
select
  occurred_at::date as day,
  count(*) filter (where event_name = 'book_landing_viewed')      as book_landing_views,
  count(*) filter (where event_name = 'booking_started')          as booking_started,
  count(*) filter (where event_name = 'lead_submitted')           as leads,
  count(*) filter (where event_name = 'booking_created')          as bookings_created,
  count(*) filter (where event_name = 'checkout_session_created') as checkouts_started,
  count(*) filter (where event_name = 'payment_confirmed')        as deposits_paid
from public.tracking_event
group by 1;

-- ---------------------------------------------------------------------------
-- 4) CAPI health. A row here that is stuck on 'error' means Meta is missing
--    conversions and the campaign is optimizing blind.
-- ---------------------------------------------------------------------------
create or replace view public.v_meta_delivery_health
with (security_invoker = on) as
select
  created_at::date  as day,
  event_name,
  status,
  count(*)          as events,
  sum(coalesce(value, 0)) as reported_value
from public.meta_event_delivery
group by 1, 2, 3;

grant select on public.v_paid_booking_attribution,
                public.v_meta_creative_performance,
                public.v_meta_geo_performance,
                public.v_meta_creative_geo_performance,
                public.v_channel_performance,
                public.v_booking_funnel_daily,
                public.v_meta_delivery_health
  to authenticated;
