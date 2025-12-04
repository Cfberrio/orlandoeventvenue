-- Add reservation_number column to bookings table
ALTER TABLE public.bookings 
ADD COLUMN reservation_number TEXT UNIQUE;

-- Create function to generate unique reservation number
CREATE OR REPLACE FUNCTION public.generate_reservation_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  new_number TEXT;
  exists_check BOOLEAN;
BEGIN
  LOOP
    -- Generate format: OEV-XXXXXX (6 alphanumeric characters)
    new_number := 'OEV-' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 6));
    
    -- Check if it already exists
    SELECT EXISTS(SELECT 1 FROM public.bookings WHERE reservation_number = new_number) INTO exists_check;
    
    EXIT WHEN NOT exists_check;
  END LOOP;
  
  RETURN new_number;
END;
$$;