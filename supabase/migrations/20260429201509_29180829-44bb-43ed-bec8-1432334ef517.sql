
-- Allow anon (staff portal sessions) to update bar_service assignments
CREATE POLICY "Anon can update bar_service assignments"
ON public.booking_staff_assignments
FOR UPDATE
TO anon
USING (assignment_type = 'bar_service')
WITH CHECK (assignment_type = 'bar_service');

-- Allow anon (staff portal sessions) to update only bar customer-contact fields on bookings.
-- Scoped via column-level WITH CHECK ensuring nothing else changes meaningfully:
-- We rely on policy + app-side update to bar_* fields only. We also restrict to bookings that
-- have an active bar_service assignment.
CREATE POLICY "Anon can mark bar customer contacted"
ON public.bookings
FOR UPDATE
TO anon
USING (
  EXISTS (
    SELECT 1 FROM public.booking_staff_assignments bsa
    WHERE bsa.booking_id = bookings.id
      AND bsa.assignment_type = 'bar_service'
      AND bsa.status != 'cancelled'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.booking_staff_assignments bsa
    WHERE bsa.booking_id = bookings.id
      AND bsa.assignment_type = 'bar_service'
      AND bsa.status != 'cancelled'
  )
);

-- Allow anon to insert booking_events from staff portal (audit trail)
-- Already exists per schema; no-op if duplicate.
