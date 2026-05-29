-- Allow anonymous users to read booking_staff_assignments for staff login
CREATE POLICY "Allow anon to read assignments for staff lookup"
ON public.booking_staff_assignments
FOR SELECT
TO anon
USING (true);

-- Allow anonymous users to read bookings (already has a policy for reservation_number lookup)
-- But we need to ensure staff can also read their assigned bookings
CREATE POLICY "Allow anon to read bookings for staff portal"
ON public.booking_staff_assignments
FOR SELECT
TO anon
USING (true);

-- Allow anonymous to read booking data needed for staff portal
CREATE POLICY "Allow anon to read bookings data"
ON public.bookings
FOR SELECT
TO anon
USING (true);

-- Allow anon to read/update cleaning reports for staff
CREATE POLICY "Allow anon to read cleaning reports for staff"
ON public.booking_cleaning_reports
FOR SELECT
TO anon
USING (true);

CREATE POLICY "Allow anon to insert cleaning reports"
ON public.booking_cleaning_reports
FOR INSERT
TO anon
WITH CHECK (true);

CREATE POLICY "Allow anon to update cleaning reports"
ON public.booking_cleaning_reports
FOR UPDATE
TO anon
USING (true);

-- Allow anon to insert booking events (for staff unassign notifications)
CREATE POLICY "Allow anon to insert booking events"
ON public.booking_events
FOR INSERT
TO anon
WITH CHECK (true);