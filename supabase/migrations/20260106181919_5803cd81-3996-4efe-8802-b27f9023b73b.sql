-- Add discount fields to bookings table
ALTER TABLE public.bookings
ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN discount_code TEXT;

-- Add comment for documentation
COMMENT ON COLUMN public.bookings.discount_amount IS 'Discount amount applied to base rental (hourly bookings only)';
COMMENT ON COLUMN public.bookings.discount_code IS 'Discount code used for the booking';
