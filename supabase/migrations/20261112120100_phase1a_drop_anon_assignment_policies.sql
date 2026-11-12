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
-- =============================================================================

DROP POLICY IF EXISTS "Anon can respond to own assignments" ON public.booking_staff_assignments;
DROP POLICY IF EXISTS "Anon can update bar_service assignments" ON public.booking_staff_assignments;
