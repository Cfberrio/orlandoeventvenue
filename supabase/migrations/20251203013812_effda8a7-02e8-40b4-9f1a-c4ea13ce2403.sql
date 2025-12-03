-- Temporarily disable RLS to reset
ALTER TABLE public.bookings DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies on bookings
DROP POLICY IF EXISTS "Anyone can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admin and staff can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admin and staff can update bookings" ON public.bookings;

-- Re-enable RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Create fresh INSERT policy for everyone (anonymous users can book)
CREATE POLICY "Public can create bookings" 
ON public.bookings 
FOR INSERT 
TO public
WITH CHECK (true);

-- Recreate admin/staff view policy
CREATE POLICY "Admin and staff can view all bookings" 
ON public.bookings 
FOR SELECT 
TO authenticated
USING (is_admin_or_staff(auth.uid()));

-- Recreate admin/staff update policy
CREATE POLICY "Admin and staff can update bookings" 
ON public.bookings 
FOR UPDATE 
TO authenticated
USING (is_admin_or_staff(auth.uid()));