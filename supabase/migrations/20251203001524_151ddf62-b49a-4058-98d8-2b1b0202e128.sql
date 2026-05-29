-- Drop the restrictive policy and create a permissive one
DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;

CREATE POLICY "Anyone can create bookings" 
ON public.bookings 
FOR INSERT 
TO public
WITH CHECK (true);