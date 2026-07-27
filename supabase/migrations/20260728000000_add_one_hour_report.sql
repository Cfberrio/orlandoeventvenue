-- Add one_hour_report field to bookings.
-- Flipped to 'true' by process-scheduled-jobs exactly 1 hour before the
-- booking's end time (job scheduled by schedule-host-report-reminders).
-- Synced to GHL as a text custom field; GHL's Contact Changed workflow
-- sends the Guest Report closeout email + SMS when it changes to 'true'.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS one_hour_report TEXT NOT NULL DEFAULT 'false';

COMMENT ON COLUMN public.bookings.one_hour_report IS
  'Text flag (''false''/''true''). Set to ''true'' 1 hour before booking end time to trigger the GHL Guest Report closeout email/SMS via Contact Changed. One-shot: never reset.';
