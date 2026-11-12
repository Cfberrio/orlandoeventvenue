-- =============================================================================
-- Phase 1A — security and silent data loss
-- ClickUp 86e40ach2 (platform audit), approved by Luis 2026-11-11.
-- Audit doc: docs/audit/2026-11-platform-audit/README.md, findings S-1..S-9.
--
-- S-1  Admin-only payroll / revenue RPCs were executable by the public anon
--      key (staff pay, guest names, "recalculate" that deletes lines).
--      -> anon loses EXECUTE; every admin RPC checks admin-or-service inside.
--      The two RPCs the staff portal calls (get_payroll_by_staff with a
--      staff id, get_staff_payroll_line_items) stay callable by anon until
--      the signed staff session ships (S-10); the all-staff form of
--      get_payroll_by_staff (p_staff_id NULL) now requires admin.
-- S-2  "Anon can respond to own assignments" let anon UPDATE any column of
--      any assignment (status='completed' creates payroll). Replaced by
--      staff_respond_to_assignment(), which only writes the response.
--      The bar-vendor anon UPDATE policy is replaced the same way by
--      staff_mark_bar_contacted(), which no longer marks the assignment
--      completed (M-34: S-7 would otherwise start paying bar vendors the
--      moment they texted the guest, before the event).
-- S-5  booking_revenue_items rejected payment_split='addon', so every paid
--      add-on invoice lost its revenue line (error only logged). Constraint
--      widened, unique guard per invoice line, 4 paid invoices backfilled.
-- S-6  populate_booking_revenue_items deleted ALL lines of a booking before
--      rewriting, add-on lines included. Now deletes only the deposit /
--      balance lines it owns.
-- S-7  staff_payroll_items rejected base_pay / bar_vendor_flat /
--      hourly_bar_vendor, which populate_staff_payroll_items inserts.
-- S-8  Recalculating payroll deleted every line of the assignment (bonuses,
--      deductions, paid lines) and reinserted it as pending; two triggers
--      ran it twice per completion. Now: manual and paid lines survive, a
--      direct recalculation of a paid assignment is refused, one trigger.
-- S-9  The guest post-event report wrote bookings.lifecycle_status from the
--      browser, and its scheduled_jobs / maintenance_tickets writes were
--      silently blocked by RLS. Now one RPC, submit_guest_report(), does it
--      server-side with a compare-and-set transition that skips cancelled
--      bookings and reads the event end in America/New_York.
--
-- S-3 (invoice functions) and S-4 (test-trigger-automation) are edge
-- function changes in the same commit.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 0. Guard used by every admin RPC
-- -----------------------------------------------------------------------------
-- Allowed: the admin login (role 'admin' in user_roles), edge functions with
-- the service-role key, and DB-side callers with no request JWT (pg_cron,
-- migrations, SQL console). PostgREST always sets request.jwt.claims, so an
-- anon or plain authenticated request can never take the "no JWT" branch.
CREATE OR REPLACE FUNCTION public._assert_admin_or_service()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_role text := COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'
  );
BEGIN
  IF v_role IS NULL OR v_role = 'service_role' THEN
    RETURN;
  END IF;
  IF v_role = 'authenticated' AND public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'admin access required' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION public._assert_admin_or_service() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 1. S-1 — admin-only read RPCs: keep the vetted bodies, put a guard in front
-- -----------------------------------------------------------------------------
-- Each original SQL function is renamed to *_unchecked (body untouched, no
-- grants) and a plpgsql wrapper with the original name and signature checks
-- the caller first. NOTE for future migrations: a CREATE OR REPLACE of the
-- public name must keep the PERFORM public._assert_admin_or_service() line.

ALTER FUNCTION public.get_daily_generated_revenue(date, date) RENAME TO get_daily_generated_revenue_unchecked;
ALTER FUNCTION public.get_daily_revenue(date, date) RENAME TO get_daily_revenue_unchecked;
ALTER FUNCTION public.get_monthly_revenue(date, date) RENAME TO get_monthly_revenue_unchecked;
ALTER FUNCTION public.get_payroll_by_role(date, date) RENAME TO get_payroll_by_role_unchecked;
ALTER FUNCTION public.get_payroll_by_staff(date, date, uuid) RENAME TO get_payroll_by_staff_unchecked;
ALTER FUNCTION public.get_payroll_line_items_export(date, date) RENAME TO get_payroll_line_items_export_unchecked;
ALTER FUNCTION public.get_revenue_by_category(date, date) RENAME TO get_revenue_by_category_unchecked;
ALTER FUNCTION public.get_revenue_by_segment(date, date, text) RENAME TO get_revenue_by_segment_unchecked;
ALTER FUNCTION public.get_revenue_line_items_export(date, date) RENAME TO get_revenue_line_items_export_unchecked;

REVOKE ALL ON FUNCTION public.get_daily_generated_revenue_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_daily_revenue_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_monthly_revenue_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payroll_by_role_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payroll_by_staff_unchecked(date, date, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_payroll_line_items_export_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_revenue_by_category_unchecked(date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_revenue_by_segment_unchecked(date, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_revenue_line_items_export_unchecked(date, date) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_daily_generated_revenue(p_start_date date, p_end_date date)
RETURNS TABLE(generated_date date, booking_count bigint, total_generated numeric, baseline_generated numeric, cleaning_generated numeric, production_generated numeric, addon_generated numeric, bar_generated numeric, tax_generated numeric, discount_generated numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_daily_generated_revenue_unchecked(p_start_date, p_end_date);
END;
$$;

CREATE FUNCTION public.get_daily_revenue(p_start_date date, p_end_date date)
RETURNS TABLE(revenue_date date, total_revenue numeric, booking_count bigint, baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric, addon_revenue numeric, bar_revenue numeric, fee_revenue numeric, discount_amount numeric, tax_amount numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_daily_revenue_unchecked(p_start_date, p_end_date);
END;
$$;

CREATE FUNCTION public.get_monthly_revenue(p_start_date date, p_end_date date)
RETURNS TABLE(revenue_month text, year_month date, total_revenue numeric, booking_count bigint, baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric, addon_revenue numeric, bar_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_monthly_revenue_unchecked(p_start_date, p_end_date);
END;
$$;

CREATE FUNCTION public.get_payroll_by_role(p_start_date date, p_end_date date)
RETURNS TABLE(staff_role text, payroll_type text, staff_count bigint, total_amount numeric, assignment_count bigint, hours_worked numeric, avg_per_staff numeric, avg_per_assignment numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_payroll_by_role_unchecked(p_start_date, p_end_date);
END;
$$;

-- Staff portal ("My Payments") calls this with its own staff id as anon.
-- Only the all-staff form (p_staff_id NULL) is admin-only. Per-staff reads
-- by id stay open until S-10 (signed staff session) replaces the id check.
CREATE FUNCTION public.get_payroll_by_staff(p_start_date date, p_end_date date, p_staff_id uuid DEFAULT NULL::uuid)
RETURNS TABLE(staff_id uuid, staff_name text, staff_role text, payroll_type text, total_amount numeric, assignment_count bigint, hours_worked numeric, avg_per_assignment numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF p_staff_id IS NULL THEN
    PERFORM public._assert_admin_or_service();
  END IF;
  RETURN QUERY SELECT * FROM public.get_payroll_by_staff_unchecked(p_start_date, p_end_date, p_staff_id);
END;
$$;

CREATE FUNCTION public.get_payroll_line_items_export(p_start_date date, p_end_date date)
RETURNS TABLE(staff_name text, staff_role text, payroll_type text, assignment_date date, booking_id uuid, assignment_id uuid, reservation_number text, assignment_type text, pay_category text, pay_type text, amount numeric, hours numeric, rate numeric, description text, assignment_status text, paid_status text, paid_at timestamp with time zone, payroll_item_id uuid, created_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_payroll_line_items_export_unchecked(p_start_date, p_end_date);
END;
$$;

CREATE FUNCTION public.get_revenue_by_category(p_start_date date, p_end_date date)
RETURNS TABLE(category text, item_type text, total_amount numeric, item_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_revenue_by_category_unchecked(p_start_date, p_end_date);
END;
$$;

CREATE FUNCTION public.get_revenue_by_segment(p_start_date date, p_end_date date, p_segment_by text DEFAULT 'booking_origin'::text)
RETURNS TABLE(segment text, total_revenue numeric, booking_count bigint, avg_revenue numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_revenue_by_segment_unchecked(p_start_date, p_end_date, p_segment_by);
END;
$$;

CREATE FUNCTION public.get_revenue_line_items_export(p_start_date date, p_end_date date)
RETURNS TABLE(reservation_number text, event_date date, payment_date date, payment_split text, event_type text, booking_type text, booking_origin text, guest_name text, item_category text, item_type text, amount numeric, quantity integer, description text, created_at timestamp with time zone)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  PERFORM public._assert_admin_or_service();
  RETURN QUERY SELECT * FROM public.get_revenue_line_items_export_unchecked(p_start_date, p_end_date);
END;
$$;

REVOKE ALL ON FUNCTION public.get_daily_generated_revenue(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_daily_revenue(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_monthly_revenue(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payroll_by_role(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_payroll_by_staff(date, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_payroll_line_items_export(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_revenue_by_category(date, date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_revenue_by_segment(date, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_revenue_line_items_export(date, date) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.get_daily_generated_revenue(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_revenue(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_monthly_revenue(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_by_role(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_by_staff(date, date, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_payroll_line_items_export(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_category(date, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_by_segment(date, date, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_revenue_line_items_export(date, date) TO authenticated, service_role;

-- get_staff_payroll_line_items already requires a staff id; it stays as is
-- (anon, staff portal) until S-10.

-- Other SECURITY DEFINER functions anon could run with no caller in the app:
-- auto_fix_missing_jobs (creates scheduled jobs; pg_cron runs it as
-- postgres), add_internal_note (no caller), count_* (health metrics).
REVOKE ALL ON FUNCTION public.auto_fix_missing_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_internal_note(uuid, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_bookings_without_balance_jobs() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.count_bookings_without_host_jobs() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.auto_fix_missing_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.add_internal_note(uuid, text, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_bookings_without_balance_jobs() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_bookings_without_host_jobs() TO authenticated, service_role;

-- Trigger functions are not callable as RPCs, but they should not be listed
-- as executable for anon either.
REVOKE ALL ON FUNCTION public.trigger_populate_payroll_on_completion() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. S-1 + S-6 + S-8 — the two generators that write money rows
-- -----------------------------------------------------------------------------
-- These bodies are long and already reviewed; the migration edits the live
-- definition in place and fails if any expected fragment is missing, so a
-- drifted definition can never be half-patched.

DO $migration$
DECLARE
  v_def text;
  v_new text;
  v_old_delete text := 'DELETE FROM public.booking_revenue_items WHERE booking_id = p_booking_id;';
BEGIN
  v_def := pg_get_functiondef('public.populate_booking_revenue_items(uuid, boolean)'::regprocedure);

  IF position(v_old_delete IN v_def) = 0 THEN
    RAISE EXCEPTION 'populate_booking_revenue_items: expected DELETE statement not found';
  END IF;
  IF position('_assert_admin_or_service' IN v_def) > 0 THEN
    RAISE EXCEPTION 'populate_booking_revenue_items: already patched';
  END IF;

  -- S-6: only the deposit/balance lines this generator writes are replaced.
  -- Add-on invoice lines (payment_split='addon', written by stripe-webhook)
  -- and anything else survive a regeneration.
  v_new := replace(
    v_def,
    v_old_delete,
    'DELETE FROM public.booking_revenue_items WHERE booking_id = p_booking_id AND payment_split IN (''deposit'', ''balance'');'
  );

  -- S-1: direct RPC callers must be admin or service role. Calls made from
  -- inside a trigger are already authorised by the statement that fired it.
  v_new := regexp_replace(
    v_new,
    E'\nBEGIN\n',
    E'\nBEGIN\n  IF pg_trigger_depth() = 0 THEN\n    PERFORM public._assert_admin_or_service();\n  END IF;\n'
  );

  IF position('_assert_admin_or_service' IN v_new) = 0 THEN
    RAISE EXCEPTION 'populate_booking_revenue_items: guard injection failed';
  END IF;

  EXECUTE v_new;
END
$migration$;

DO $migration$
DECLARE
  v_def text;
  v_new text;
  v_old_delete text := E'  -- Duplicate prevention: clear existing items for this assignment\n  DELETE FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id;';
BEGIN
  v_def := pg_get_functiondef('public.populate_staff_payroll_items(uuid, boolean)'::regprocedure);

  IF position(v_old_delete IN v_def) = 0 THEN
    RAISE EXCEPTION 'populate_staff_payroll_items: expected DELETE statement not found';
  END IF;
  IF position('_assert_admin_or_service' IN v_def) > 0 THEN
    RAISE EXCEPTION 'populate_staff_payroll_items: already patched';
  END IF;

  -- S-8: recalculation replaces only the calculated, unpaid lines.
  --   * bonus / deduction lines are added by hand in the Payroll modal and
  --     are never recreated by this function, so they are kept;
  --   * once any calculated line is paid the assignment is frozen: a direct
  --     recalculation (Payroll modal) is refused with a clear error; a
  --     trigger-driven one (status change) leaves the paid lines alone
  --     instead of aborting the booking update that fired it.
  v_new := replace(
    v_def,
    v_old_delete,
    $patch$  -- Recalculation keeps manual lines (bonus/deduction) and never rewrites a
  -- paid assignment (ClickUp 86e40ach2, S-8).
  IF EXISTS (
    SELECT 1 FROM public.staff_payroll_items
    WHERE assignment_id = p_assignment_id
      AND paid_status = 'paid'
      AND pay_category NOT IN ('bonus', 'deduction')
  ) THEN
    IF pg_trigger_depth() = 0 THEN
      RAISE EXCEPTION 'Payroll for assignment % is already paid; add a bonus or deduction instead of recalculating', p_assignment_id
        USING ERRCODE = 'P0001';
    END IF;
    RAISE NOTICE 'Payroll for assignment % already paid; not recalculated', p_assignment_id;
    RETURN;
  END IF;

  DELETE FROM public.staff_payroll_items
  WHERE assignment_id = p_assignment_id
    AND pay_category NOT IN ('bonus', 'deduction');$patch$
  );

  -- S-1: same guard as the revenue generator (first BEGIN = function body).
  v_new := regexp_replace(
    v_new,
    E'\nBEGIN\n',
    E'\nBEGIN\n  IF pg_trigger_depth() = 0 THEN\n    PERFORM public._assert_admin_or_service();\n  END IF;\n'
  );

  IF position('_assert_admin_or_service' IN v_new) = 0
     OR position('NOT IN (''bonus'', ''deduction'')' IN v_new) = 0 THEN
    RAISE EXCEPTION 'populate_staff_payroll_items: patch failed';
  END IF;

  EXECUTE v_new;
END
$migration$;

-- Trigger callers run as the function owner, so revoking anon/PUBLIC does not
-- affect the completion trigger. The admin UI calls these as authenticated.
REVOKE ALL ON FUNCTION public.populate_booking_revenue_items(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.populate_staff_payroll_items(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.populate_booking_revenue_items(uuid, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.populate_staff_payroll_items(uuid, boolean) TO authenticated, service_role;

-- S-8: two triggers ran the same function on every completion. Keep the one
-- scoped to UPDATE OF status.
DROP TRIGGER IF EXISTS trg_populate_payroll_on_completion ON public.booking_staff_assignments;

-- -----------------------------------------------------------------------------
-- 3. S-7 — payroll categories the generator already writes
-- -----------------------------------------------------------------------------
ALTER TABLE public.staff_payroll_items DROP CONSTRAINT staff_payroll_items_pay_category_check;
ALTER TABLE public.staff_payroll_items ADD CONSTRAINT staff_payroll_items_pay_category_check
  CHECK (pay_category = ANY (ARRAY[
    'hourly_production'::text, 'cleaning_base'::text, 'cleaning_surcharge'::text,
    'bonus'::text, 'deduction'::text,
    'base_pay'::text, 'bar_vendor_flat'::text, 'hourly_bar_vendor'::text
  ]));

-- -----------------------------------------------------------------------------
-- 4. S-5 — add-on revenue lines
-- -----------------------------------------------------------------------------
ALTER TABLE public.booking_revenue_items DROP CONSTRAINT booking_revenue_items_payment_split_check;
ALTER TABLE public.booking_revenue_items ADD CONSTRAINT booking_revenue_items_payment_split_check
  CHECK (payment_split = ANY (ARRAY['deposit'::text, 'balance'::text, 'full'::text, 'addon'::text]));

-- One line per (add-on invoice, category, type): the webhook writes at most
-- one of each, and this keeps a backfill re-run or a replay from doubling it.
CREATE UNIQUE INDEX IF NOT EXISTS booking_revenue_items_addon_invoice_line_uidx
  ON public.booking_revenue_items ((metadata ->> 'addon_invoice_id'), item_category, item_type)
  WHERE payment_split = 'addon';

-- Backfill: every paid add-on invoice with no revenue line. Production is the
-- only component on the 4 paid invoices today (OEV-CDYXE2 $396, WRSPVF $316,
-- 93UDYH $495, 2LASUD $594 = $1,801); the guard below fails the migration if
-- a paid invoice carries any other component, so nothing is silently skipped.
DO $migration$
DECLARE
  v_other int;
BEGIN
  SELECT count(*) INTO v_other
  FROM public.booking_addon_invoices i
  WHERE i.payment_status = 'paid'
    AND NOT EXISTS (
      SELECT 1 FROM public.booking_revenue_items r
      WHERE r.payment_split = 'addon' AND r.metadata ->> 'addon_invoice_id' = i.id::text
    )
    AND (
      COALESCE(i.setup_breakdown, false)
      OR (COALESCE(i.tablecloths, false) AND COALESCE(i.tablecloth_quantity, 0) > 0)
      OR COALESCE(i.optional_services_cost, 0) > 0
      OR (COALESCE(i.bar_package, 'none') <> 'none' AND COALESCE(i.bar_subtotal, 0) > 0)
    );
  IF v_other > 0 THEN
    RAISE EXCEPTION 'S-5 backfill: % paid add-on invoice(s) have non-production components; backfill them explicitly', v_other;
  END IF;
END
$migration$;

INSERT INTO public.booking_revenue_items
  (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical, metadata)
SELECT
  i.booking_id,
  'production',
  i.package,
  i.package_cost,
  (i.paid_at AT TIME ZONE 'America/New_York')::date,
  'addon',
  CASE i.package
    WHEN 'basic' THEN 'Basic Production Package'
    WHEN 'led' THEN 'LED Production Package'
    WHEN 'workshop' THEN 'Workshop Production Package'
    ELSE 'Production Package'
  END || ' (Add-on, paid in full)',
  false,
  jsonb_build_object(
    'source', 'addon_invoice',
    'addon_invoice_id', i.id::text,
    'split', '80_20',
    'package', i.package,
    'backfilled', '86e40ach2'
  )
FROM public.booking_addon_invoices i
WHERE i.payment_status = 'paid'
  AND i.paid_at IS NOT NULL
  AND COALESCE(i.package, 'none') <> 'none'
  AND COALESCE(i.package_cost, 0) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.booking_revenue_items r
    WHERE r.payment_split = 'addon'
      AND r.metadata ->> 'addon_invoice_id' = i.id::text
      AND r.item_category = 'production'
  );

-- -----------------------------------------------------------------------------
-- 5. S-2 — staff responses go through RPCs, not an open UPDATE policy
-- -----------------------------------------------------------------------------
-- The staff id check stops a staff member from answering for someone else in
-- the normal UI. It is not authentication: anyone holding both ids can still
-- call it. S-10 (signed staff session) replaces p_staff_id with a token.
CREATE OR REPLACE FUNCTION public.staff_respond_to_assignment(
  p_assignment_id uuid,
  p_staff_id uuid,
  p_response text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.booking_staff_assignments%ROWTYPE;
  v_staff_name text;
BEGIN
  IF p_response IS NULL OR p_response NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'invalid response: %', p_response USING ERRCODE = '22023';
  END IF;

  UPDATE public.booking_staff_assignments
  SET response_status = p_response,
      response_at = now(),
      updated_at = now()
  WHERE id = p_assignment_id
    AND staff_id = p_staff_id
    AND status <> 'cancelled'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assignment not found for this staff member' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.booking_id IS NOT NULL THEN
    SELECT full_name INTO v_staff_name FROM public.staff_members WHERE id = p_staff_id;
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      v_row.booking_id,
      CASE WHEN p_response = 'accepted' THEN 'staff_assignment_accepted' ELSE 'staff_assignment_rejected' END,
      'staff_portal',
      jsonb_build_object(
        'assignment_id', v_row.id,
        'staff_id', p_staff_id,
        'staff_name', v_staff_name,
        'assignment_role', v_row.assignment_role,
        'responded_at', v_row.response_at
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'assignment_id', v_row.id,
    'booking_id', v_row.booking_id,
    'response_status', v_row.response_status,
    'response_at', v_row.response_at
  );
END;
$$;

-- M-34 (pulled into 1A because S-7 makes bar-vendor payroll real): contacting
-- the guest is not finishing the work, so it no longer completes the
-- assignment. Completion (and payroll) follows the event like every role.
CREATE OR REPLACE FUNCTION public.staff_mark_bar_contacted(
  p_assignment_id uuid,
  p_staff_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_row public.booking_staff_assignments%ROWTYPE;
  v_staff_name text;
  v_now timestamptz := now();
BEGIN
  UPDATE public.booking_staff_assignments
  SET customer_contacted = true,
      customer_contacted_at = v_now,
      customer_contacted_by = p_staff_id,
      updated_at = v_now
  WHERE id = p_assignment_id
    AND staff_id = p_staff_id
    AND assignment_type = 'bar_service'
    AND status <> 'cancelled'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bar assignment not found for this staff member' USING ERRCODE = 'P0002';
  END IF;

  IF v_row.booking_id IS NOT NULL THEN
    UPDATE public.bookings
    SET bar_customer_contacted = true,
        bar_customer_contacted_at = v_now,
        bar_customer_contacted_by = p_staff_id
    WHERE id = v_row.booking_id;

    SELECT full_name INTO v_staff_name FROM public.staff_members WHERE id = p_staff_id;
    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      v_row.booking_id,
      'bar_customer_contacted',
      'staff_portal',
      jsonb_build_object('staff_id', p_staff_id, 'staff_name', v_staff_name, 'contacted_at', v_now)
    );
  END IF;

  RETURN jsonb_build_object('assignment_id', v_row.id, 'booking_id', v_row.booking_id, 'contacted_at', v_now);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_respond_to_assignment(uuid, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_mark_bar_contacted(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_respond_to_assignment(uuid, uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.staff_mark_bar_contacted(uuid, uuid) TO anon, authenticated, service_role;

-- The two open anon UPDATE policies are dropped in the follow-up migration
-- 20261112120100, applied only after the front end that calls these RPCs is
-- published (dropping them first would break accept/reject in the staff
-- portal for the length of the deploy).

-- -----------------------------------------------------------------------------
-- 6. S-9 — guest post-event report, server-side
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_guest_report(
  p_booking_id uuid,
  p_reservation_number text,
  p_report jsonb,
  p_review jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_booking RECORD;
  v_issue text := NULLIF(btrim(COALESCE(p_report ->> 'issue_description', '')), '');
  v_has_issue boolean := COALESCE((p_report ->> 'has_issue')::boolean, false);
  v_rating int;
  v_event_end timestamptz;
  v_transitioned boolean := false;
BEGIN
  IF p_booking_id IS NULL OR p_reservation_number IS NULL OR p_report IS NULL THEN
    RAISE EXCEPTION 'booking, reservation number and report are required' USING ERRCODE = '22023';
  END IF;

  -- The guest found the booking by reservation number; both must match.
  SELECT id, reservation_number, event_date, end_time, event_type
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
    AND reservation_number = upper(btrim(p_reservation_number));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'booking not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.booking_host_reports (
    booking_id, guest_name, guest_email, guest_phone,
    guest_confirm_area_clean, guest_confirm_trash_bagged,
    guest_confirm_bathrooms_ok, guest_confirm_door_closed,
    notes, issue_description, has_issue, status, submitted_at
  ) VALUES (
    p_booking_id,
    p_report ->> 'guest_name',
    p_report ->> 'guest_email',
    p_report ->> 'guest_phone',
    COALESCE((p_report ->> 'guest_confirm_area_clean')::boolean, false),
    COALESCE((p_report ->> 'guest_confirm_trash_bagged')::boolean, false),
    COALESCE((p_report ->> 'guest_confirm_bathrooms_ok')::boolean, false),
    COALESCE((p_report ->> 'guest_confirm_door_closed')::boolean, false),
    v_issue,
    v_issue,
    v_has_issue AND v_issue IS NOT NULL,
    'submitted',
    now()
  );

  UPDATE public.bookings
  SET host_report_step = 'completed', updated_at = now()
  WHERE id = p_booking_id;

  UPDATE public.scheduled_jobs
  SET status = 'cancelled',
      last_error = 'host_report_completed_before_job_run',
      updated_at = now()
  WHERE booking_id = p_booking_id
    AND job_type IN ('host_report_pre_start', 'host_report_during', 'host_report_post')
    AND status = 'pending';

  INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
  VALUES (
    p_booking_id,
    'host_report_completed',
    'host',
    jsonb_build_object(
      'submitted_at', now(),
      'guest_name', p_report ->> 'guest_name',
      'guest_email', p_report ->> 'guest_email'
    )
  );

  IF v_has_issue AND v_issue IS NOT NULL THEN
    INSERT INTO public.maintenance_tickets (
      booking_id, title, description, issue_type, reported_by_role, priority, status
    ) VALUES (
      p_booking_id,
      'Guest issue reported: reservation ' || v_booking.reservation_number,
      v_issue,
      'guest_report',
      'host',
      'medium',
      'open'
    );
  END IF;

  v_rating := NULLIF(p_review ->> 'rating', '')::int;
  IF v_rating BETWEEN 1 AND 5 THEN
    INSERT INTO public.booking_reviews (booking_id, rating, comment, reviewer_name, source)
    VALUES (
      p_booking_id,
      v_rating,
      NULLIF(btrim(COALESCE(p_review ->> 'comment', '')), ''),
      p_report ->> 'guest_name',
      'guest_report'
    );
  END IF;

  -- Same rule the browser applied (in_progress + event end + 24h), now with
  -- the event end read in Orlando time and a compare-and-set that never
  -- moves a cancelled booking.
  v_event_end := ((v_booking.event_date + COALESCE(v_booking.end_time, time '23:59'))
                  AT TIME ZONE 'America/New_York');

  UPDATE public.bookings
  SET lifecycle_status = 'post_event', updated_at = now()
  WHERE id = p_booking_id
    AND lifecycle_status = 'in_progress'
    AND status <> 'cancelled'::booking_status
    AND v_event_end + interval '24 hours' <= now();

  IF FOUND THEN
    v_transitioned := true;

    UPDATE public.scheduled_jobs
    SET status = 'cancelled',
        last_error = 'host_report_submitted_triggered_transition',
        updated_at = now()
    WHERE booking_id = p_booking_id
      AND job_type = 'set_lifecycle_post_event'
      AND status = 'pending';

    INSERT INTO public.booking_events (booking_id, event_type, channel, metadata)
    VALUES (
      p_booking_id,
      'auto_lifecycle_post_event',
      'host',
      jsonb_build_object(
        'from_lifecycle', 'in_progress',
        'to_lifecycle', 'post_event',
        'triggered_by', 'host_report_submission',
        'event_end_plus_24h', v_event_end + interval '24 hours',
        'timestamp', now()
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'transitioned', v_transitioned,
    'event_date', v_booking.event_date,
    'event_type', v_booking.event_type
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_guest_report(uuid, text, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_guest_report(uuid, text, jsonb, jsonb) TO anon, authenticated, service_role;

COMMIT;
