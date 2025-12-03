-- Add package time columns for logistics tracking
ALTER TABLE public.bookings 
ADD COLUMN package_start_time time without time zone,
ADD COLUMN package_end_time time without time zone;