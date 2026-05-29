-- Drop the existing restrictive policy
DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;

-- Create a PERMISSIVE policy for public inserts
CREATE POLICY "Anyone can create bookings" 
ON public.bookings 
FOR INSERT 
TO anon, authenticated
WITH CHECK (true);