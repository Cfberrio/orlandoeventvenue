
-- Delete related data for Norexy Carrasquero internal bookings
DELETE FROM public.availability_block_reminders WHERE block_id IN (
  SELECT id FROM public.availability_blocks WHERE booking_id IN ('07e7784f-4111-4fdc-a375-a5d221f6a4fd', '8d0f0ff9-f270-4575-9e70-2c91624d14a8')
);

DELETE FROM public.availability_blocks WHERE booking_id IN ('07e7784f-4111-4fdc-a375-a5d221f6a4fd', '8d0f0ff9-f270-4575-9e70-2c91624d14a8');

DELETE FROM public.booking_events WHERE booking_id IN ('07e7784f-4111-4fdc-a375-a5d221f6a4fd', '8d0f0ff9-f270-4575-9e70-2c91624d14a8');

DELETE FROM public.bookings WHERE id IN ('07e7784f-4111-4fdc-a375-a5d221f6a4fd', '8d0f0ff9-f270-4575-9e70-2c91624d14a8');
