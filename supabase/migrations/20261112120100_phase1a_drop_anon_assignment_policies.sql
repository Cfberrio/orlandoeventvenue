-- =============================================================================
-- Phase 1A, step 2 — close the open anon UPDATE rules on staff assignments
-- ClickUp 86e40ach2, finding S-2 (and M-34 for bar vendors).
--
-- Applied AFTER the front end that uses staff_respond_to_assignment() and
-- staff_mark_bar_contacted() (migration 20261112120000) is published. Before
-- that, the live staff portal still wrote the table directly through these
-- policies.
--
-- "Anon can respond to own assignments": qual true / check true — any visitor
-- with the public key could change any column of any assignment, including
-- status = 'completed', which generates payroll.
-- "Anon can update bar_service assignments": same, for bar vendor rows.
--
-- S-9: the guest post-event report is written only by submit_guest_report()
-- now, so the public INSERT/UPDATE rules on booking_host_reports and the
-- public INSERT on booking_reviews go too. That makes "a report row exists"
-- a marker the RPC can trust for idempotency (no forged or stray rows).
-- Admin writes keep working through the "Admin and staff can manage ..."
-- policies.
-- =============================================================================

DROP POLICY IF EXISTS "Anon can respond to own assignments" ON public.booking_staff_assignments;
DROP POLICY IF EXISTS "Anon can update bar_service assignments" ON public.booking_staff_assignments;

DROP POLICY IF EXISTS "Anyone can submit host reports via reservation lookup" ON public.booking_host_reports;
DROP POLICY IF EXISTS "Anyone can submit host_reports" ON public.booking_host_reports;
DROP POLICY IF EXISTS "Anyone can update their host report" ON public.booking_host_reports;
DROP POLICY IF EXISTS "Anyone can submit reviews" ON public.booking_reviews;
