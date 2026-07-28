-- Backfill external bookings so GHL dynamic fields populate correctly.
--
-- Context (ClickUp 86e2he9n5): automated messages for external bookings said
-- "Hi External" with an empty Reservation #.
--   1. ExternalBookingWizard stored full_name as "External - {name}"; GHL
--      derives contact firstName from the first word, so every customer
--      automation greeted "External".
--   2. The wizard never generated reservation_number (the normal flow does it
--      client-side in useCreateBooking), so the field was NULL.
-- The wizard is fixed going forward; this migration repairs existing rows.
--
-- NOTE: after running, re-sync each affected booking to GHL (sync-to-ghl) so
-- contact fields update. Existing GHL contacts created with firstName
-- "External" may also need a manual rename in GHL if the webhook workflow
-- does not overwrite contact names.

-- 1) Assign reservation numbers to external bookings that lack one
UPDATE public.bookings
SET reservation_number = public.generate_reservation_number()
WHERE (booking_origin = 'external' OR lead_source = 'external_admin')
  AND reservation_number IS NULL;

-- 2) Flip "External - {name}" to "{name} - External" so the real first name
--    leads (feeds GHL contact firstName / {{contact.first_name}})
UPDATE public.bookings
SET full_name = regexp_replace(full_name, '^External - (.+)$', '\1 - External')
WHERE (booking_origin = 'external' OR lead_source = 'external_admin')
  AND full_name LIKE 'External - %';
