-- Add discount columns to bookings table
ALTER TABLE public.bookings
ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0,
ADD COLUMN discount_code TEXT;