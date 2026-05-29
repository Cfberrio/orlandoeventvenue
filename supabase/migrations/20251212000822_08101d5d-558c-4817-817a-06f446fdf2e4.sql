-- Add balance payment link fields to bookings table
ALTER TABLE public.bookings 
ADD COLUMN IF NOT EXISTS balance_payment_url text,
ADD COLUMN IF NOT EXISTS balance_link_expires_at timestamptz;