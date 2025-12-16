-- Add host_report_step column to bookings table
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS host_report_step text DEFAULT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.bookings.host_report_step IS 'Tracks the current host report reminder step: pre_start, during_event, post_event, or completed';