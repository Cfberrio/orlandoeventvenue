-- Add GHL calendar appointment tracking fields to bookings table
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS ghl_appointment_id text,
ADD COLUMN IF NOT EXISTS ghl_calendar_id text,
ADD COLUMN IF NOT EXISTS ghl_assigned_user_id text,
ADD COLUMN IF NOT EXISTS ghl_contact_id text,
ADD COLUMN IF NOT EXISTS ghl_appointment_start_at timestamptz,
ADD COLUMN IF NOT EXISTS ghl_appointment_end_at timestamptz;

-- Add index for faster lookups by appointment_id
CREATE INDEX IF NOT EXISTS idx_bookings_ghl_appointment_id ON public.bookings(ghl_appointment_id) WHERE ghl_appointment_id IS NOT NULL;