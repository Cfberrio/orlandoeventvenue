-- Disable RLS permanently on bookings table
ALTER TABLE public.bookings DISABLE ROW LEVEL SECURITY;

-- Drop all existing policies since RLS is disabled
DROP POLICY IF EXISTS "Allow anonymous inserts" ON public.bookings;
DROP POLICY IF EXISTS "Allow authenticated inserts" ON public.bookings;
DROP POLICY IF EXISTS "Admin staff view" ON public.bookings;
DROP POLICY IF EXISTS "Admin staff update" ON public.bookings;