-- Change pre_event_ready from boolean to text
ALTER TABLE public.bookings 
ALTER COLUMN pre_event_ready TYPE text 
USING CASE WHEN pre_event_ready = true THEN 'true' ELSE 'false' END;

-- Set default to 'false' as text
ALTER TABLE public.bookings 
ALTER COLUMN pre_event_ready SET DEFAULT 'false';