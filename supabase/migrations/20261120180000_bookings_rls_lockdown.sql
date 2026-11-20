-- X2-06: bookings had RLS disabled, so the public (anon) key could UPDATE,
-- DELETE or TRUNCATE any booking. Enable RLS and allow only the writers that
-- exist:
--   * admin / staff signed in with Supabase auth (is_admin_or_staff)
--   * the public /book flow: INSERT a new pending booking, and UPDATE its own
--     still-pending, unpaid booking created in the last 2 days (dedupe path in
--     useCreateBooking)
--   * service_role (edge functions) and SECURITY DEFINER functions bypass RLS
-- Existing SELECT policies and the scoped anon bar-contacted UPDATE policy stay.

BEGIN;

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

REVOKE DELETE, TRUNCATE ON public.bookings FROM anon;
REVOKE TRUNCATE ON public.bookings FROM authenticated;

DROP POLICY IF EXISTS "Admin and staff manage bookings" ON public.bookings;
CREATE POLICY "Admin and staff manage bookings" ON public.bookings
  FOR ALL TO authenticated
  USING (public.is_admin_or_staff(auth.uid()))
  WITH CHECK (public.is_admin_or_staff(auth.uid()));

DROP POLICY IF EXISTS "Public can create pending booking" ON public.bookings;
CREATE POLICY "Public can create pending booking" ON public.bookings
  FOR INSERT TO anon
  WITH CHECK (payment_status = 'pending' AND lifecycle_status = 'pending');

DROP POLICY IF EXISTS "Public can update own fresh pending booking" ON public.bookings;
CREATE POLICY "Public can update own fresh pending booking" ON public.bookings
  FOR UPDATE TO anon
  USING (payment_status = 'pending' AND lifecycle_status = 'pending'
         AND created_at > now() - interval '2 days')
  WITH CHECK (payment_status = 'pending' AND lifecycle_status = 'pending');

COMMIT;
