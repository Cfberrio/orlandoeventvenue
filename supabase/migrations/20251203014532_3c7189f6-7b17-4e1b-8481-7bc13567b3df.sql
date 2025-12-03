-- Drop the existing INSERT policy
DROP POLICY IF EXISTS "Public can create bookings" ON public.bookings;

-- Create INSERT policy explicitly as PERMISSIVE (default but being explicit)
CREATE POLICY "Public can create bookings" 
ON public.bookings 
FOR INSERT 
TO anon, authenticated
WITH CHECK (true);

-- Also recreate view/update policies as PERMISSIVE
DROP POLICY IF EXISTS "Admin and staff can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admin and staff can update bookings" ON public.bookings;

CREATE POLICY "Admin and staff can view all bookings" 
ON public.bookings 
FOR SELECT 
TO authenticated
USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can update bookings" 
ON public.bookings 
FOR UPDATE 
TO authenticated
USING (is_admin_or_staff(auth.uid()));