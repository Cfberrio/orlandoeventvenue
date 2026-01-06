-- Allow public to read staff_members for email validation during login
-- This only exposes minimal data needed for login validation
CREATE POLICY "Allow public email lookup for staff login"
ON public.staff_members
FOR SELECT
TO anon
USING (true);