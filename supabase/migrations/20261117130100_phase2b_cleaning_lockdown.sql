-- Phase 2B lockdown (ClickUp 86e40ach2). APPLY ONLY AFTER the frontend that
-- calls staff_submit_cleaning_report / staff_submit_standalone_cleaning_report
-- is published: the old staff portal wrote these tables directly.
--
-- Anyone with the public anon key could insert or rewrite any booking's
-- cleaning report ("Allow anon to insert/update", and an UPDATE policy whose
-- only condition was that the booking had any staff assignment). Writes now go
-- only through the submit functions (SECURITY DEFINER). Reads stay as they are
-- for the staff portal (anon session) until staff get real logins.

DROP POLICY IF EXISTS "Allow anon to insert cleaning reports" ON public.booking_cleaning_reports;
DROP POLICY IF EXISTS "Allow anon to update cleaning reports" ON public.booking_cleaning_reports;
DROP POLICY IF EXISTS "Staff can update their cleaning reports" ON public.booking_cleaning_reports;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.booking_cleaning_reports FROM anon;

DROP POLICY IF EXISTS "Staff can create own standalone cleaning reports" ON public.standalone_cleaning_reports;
DROP POLICY IF EXISTS "Staff can update own standalone cleaning reports" ON public.standalone_cleaning_reports;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.standalone_cleaning_reports FROM anon;
