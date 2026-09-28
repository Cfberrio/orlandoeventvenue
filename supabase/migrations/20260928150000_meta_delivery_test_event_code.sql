-- Meta Test Events, scoped to one controlled session.
--
-- A delivery sent with a Meta test_event_code shows up in Events Manager >
-- Test Events instead of counting as a production conversion. Recording the
-- code on the journal row is what lets anyone reading meta_event_delivery tell
-- a QA send from a real one. NULL = normal production delivery.
--
-- Additive and nullable: existing rows and existing writers are unaffected.
alter table public.meta_event_delivery
  add column if not exists test_event_code text;

comment on column public.meta_event_delivery.test_event_code is
  'Meta Test Events code this delivery was sent with (QA session only). NULL = production event.';
