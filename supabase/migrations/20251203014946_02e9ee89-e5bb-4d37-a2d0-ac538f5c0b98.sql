-- Temporarily disable RLS on bookings to test
ALTER TABLE public.bookings DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies
DROP POLICY IF EXISTS "Public can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admin and staff can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Admin and staff can update bookings" ON public.bookings;

-- Re-enable RLS
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Create a single simple policy that allows ALL operations for anon role
CREATE POLICY "Allow anonymous inserts" 
ON public.bookings 
FOR INSERT 
TO anon
WITH CHECK (true);

-- Separate policy for authenticated users to insert
CREATE POLICY "Allow authenticated inserts" 
ON public.bookings 
FOR INSERT 
TO authenticated
WITH CHECK (true);

-- Admin/staff view policy
CREATE POLICY "Admin staff view" 
ON public.bookings 
FOR SELECT 
TO authenticated
USING (is_admin_or_staff(auth.uid()));

-- Admin/staff update policy
CREATE POLICY "Admin staff update" 
ON public.bookings 
FOR UPDATE 
TO authenticated
USING (is_admin_or_staff(auth.uid()));

-- Force schema cache reload
NOTIFY pgrst, 'reload schema';