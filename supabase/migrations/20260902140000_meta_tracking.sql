-- Meta Conversions API + first-party tracking foundation for OEV (2026-09-02).
-- Ported from the Discipline Rift implementation and re-anchored on the OEV
-- funnel: DR pivots on parent -> enrollment -> payment, OEV has no guest auth
-- so everything pivots on bookings.id plus the guest email.
--
-- These tables are written ONLY by edge functions holding the service role
-- (track-event, create-checkout, stripe-webhook). The browser never inserts
-- directly. Admins read through RLS via public.has_role(auth.uid(),'admin').
--
-- The "tracking_" prefix keeps these clear of booking_events, which is the
-- operational audit log for a reservation and unrelated to ad measurement.

-- ---------------------------------------------------------------------------
-- One row per browser context (first-party anonymous_id cookie, oev_aid).
-- A single guest owns several: the Instagram in-app browser, Safari, and the
-- row minted on the return from Stripe are three different visitors, and only
-- one of them ever carried the ad click. booking_id / email are what stitch
-- them back into one person.
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_visitor (
  id uuid primary key default gen_random_uuid(),
  anonymous_id text not null unique,
  -- Identity anchors. Written by track-event once the guest reaches a step
  -- that produces one; never overwritten with a null.
  booking_id uuid references public.bookings(id) on delete set null,
  lead_id uuid references public.popup_leads(id) on delete set null,
  email text,
  -- Meta browser identifiers, mirrored from the _fbp/_fbc cookies.
  fbp text,
  fbc text,
  -- Attribution. first_* is written once and never overwritten; last_* moves
  -- only on a new paid/ad touch (see isPaidTouch in track-event).
  first_utm jsonb,
  last_utm jsonb,
  first_landing_page text,
  first_referrer text,
  first_touch_at timestamptz,
  last_touch_at timestamptz,
  last_ip text,
  last_user_agent text,
  -- Consent snapshot for the audit trail. NOT a gate: OEV captures regardless
  -- of the banner choice (see src/lib/tracking/consent.ts HONOR_AD_OPT_OUT).
  ad_consent boolean,
  analytics_consent boolean,
  consent_updated_at timestamptz,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists tracking_visitor_booking_idx on public.tracking_visitor (booking_id);
create index if not exists tracking_visitor_email_idx on public.tracking_visitor (email);
create index if not exists tracking_visitor_lead_idx on public.tracking_visitor (lead_id);
create index if not exists tracking_visitor_last_touch_idx on public.tracking_visitor (last_touch_at desc);

-- ---------------------------------------------------------------------------
-- One row per tab session (sessionStorage oev_sid).
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_session (
  id text primary key,
  anonymous_id text not null,
  visitor_id uuid references public.tracking_visitor(id) on delete cascade,
  landing_page text,
  referrer text,
  utm jsonb,
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now()
);
create index if not exists tracking_session_visitor_idx on public.tracking_session (visitor_id);

-- ---------------------------------------------------------------------------
-- Internal first-party event ledger. This is the funnel truth and it is
-- consent-independent, so the DB funnel stays complete even when a Meta send
-- is skipped for want of secrets.
-- event_id doubles as the Meta dedup id for the events mirrored to Pixel/CAPI.
-- ---------------------------------------------------------------------------
create table if not exists public.tracking_event (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  event_id text unique,
  anonymous_id text,
  session_id text,
  visitor_id uuid references public.tracking_visitor(id) on delete set null,
  booking_id uuid,
  lead_id uuid,
  email text,
  page_url text,
  referrer text,
  props jsonb,
  client_ip text,
  user_agent text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists tracking_event_name_time_idx on public.tracking_event (event_name, occurred_at desc);
create index if not exists tracking_event_anon_idx on public.tracking_event (anonymous_id);
create index if not exists tracking_event_booking_idx on public.tracking_event (booking_id);
create index if not exists tracking_event_email_idx on public.tracking_event (email);

-- ---------------------------------------------------------------------------
-- Versioned consent audit log (accept_all / reject_all / custom / revoke).
-- Recorded for every banner interaction so there is a dated record of what the
-- visitor was shown and what they chose, independent of what the site does
-- with that choice.
-- ---------------------------------------------------------------------------
create table if not exists public.consent_record (
  id uuid primary key default gen_random_uuid(),
  anonymous_id text,
  visitor_id uuid references public.tracking_visitor(id) on delete set null,
  policy_version text not null,
  action text not null,
  essential boolean not null default true,
  preferences boolean not null default false,
  analytics boolean not null default false,
  advertising boolean not null default false,
  page_url text,
  user_agent text,
  client_ip text,
  created_at timestamptz not null default now()
);
create index if not exists consent_record_anon_idx on public.consent_record (anonymous_id);
create index if not exists consent_record_created_idx on public.consent_record (created_at desc);

-- ---------------------------------------------------------------------------
-- One row per server event sent (or deliberately skipped) to Meta CAPI.
-- meta_event_id is UNIQUE, and that constraint IS the idempotency anchor: a
-- Stripe webhook retry or a double-submit claims the id, fails with 23505 and
-- is journaled as a duplicate instead of producing a second Purchase.
-- ---------------------------------------------------------------------------
create table if not exists public.meta_event_delivery (
  id uuid primary key default gen_random_uuid(),
  meta_event_id text not null unique,
  event_name text not null,
  channel text not null default 'capi',
  booking_id uuid,
  lead_id uuid,
  status text not null default 'pending',
  attempts integer not null default 0,
  event_time timestamptz,
  value numeric,
  currency text,
  request jsonb,
  response jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists meta_event_delivery_status_idx on public.meta_event_delivery (status, created_at desc);
create index if not exists meta_event_delivery_booking_idx on public.meta_event_delivery (booking_id);

-- ---------------------------------------------------------------------------
-- RLS. The service role bypasses it entirely, which is how the edge functions
-- write. Admins get read access for the attribution dashboard; nobody else,
-- and no anon insert path, so the browser cannot forge tracking rows.
-- ---------------------------------------------------------------------------
alter table public.tracking_visitor enable row level security;
alter table public.tracking_session enable row level security;
alter table public.tracking_event enable row level security;
alter table public.consent_record enable row level security;
alter table public.meta_event_delivery enable row level security;

drop policy if exists tracking_visitor_admin_read on public.tracking_visitor;
create policy tracking_visitor_admin_read on public.tracking_visitor
  for select using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists tracking_session_admin_read on public.tracking_session;
create policy tracking_session_admin_read on public.tracking_session
  for select using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists tracking_event_admin_read on public.tracking_event;
create policy tracking_event_admin_read on public.tracking_event
  for select using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists consent_record_admin_read on public.consent_record;
create policy consent_record_admin_read on public.consent_record
  for select using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists meta_event_delivery_admin_read on public.meta_event_delivery;
create policy meta_event_delivery_admin_read on public.meta_event_delivery
  for select using (public.has_role(auth.uid(), 'admin'::app_role));

comment on table public.tracking_visitor is
  'One row per browser context. Anchored to a booking/lead/email so ad attribution survives a guest returning days later in a different browser. No card data, no signature, no contract text.';
comment on table public.meta_event_delivery is
  'Journal of every Meta CAPI send. meta_event_id UNIQUE is the idempotency anchor against webhook retries.';
