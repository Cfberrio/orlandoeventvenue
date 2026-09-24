-- Persist the checkout-time advertising choice so the asynchronous Stripe
-- webhook can honor an explicit opt-out even when analytics identity is off.
-- NULL preserves the historical behavior for visitors who have not answered.
alter table public.bookings
  add column if not exists ad_consent boolean;

comment on column public.bookings.ad_consent is
  'Checkout-time advertising consent snapshot. FALSE skips Meta CAPI; NULL means unknown and preserves sending.';
