-- E-1 (ClickUp 86e40ach2): services added after booking reach the staff.
-- When the office adds a service later (e.g. LED wall), it bills it with an
-- add-on invoice. The booking row is NOT changed on purpose: bookings.package
-- feeds reschedule repricing, revenue and payroll hours, so writing the add-on
-- there would double count it. The staff portal (anon + staff_id) cannot read
-- booking_addon_invoices (RLS: admin/staff auth only), so this read-only RPC
-- returns the PAID add-ons of a booking to a staff member assigned to it.
-- No writes, no money paths.

CREATE OR REPLACE FUNCTION public.staff_get_paid_addons(p_staff_id uuid, p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.staff_members WHERE id = p_staff_id AND is_active) THEN
    RAISE EXCEPTION 'Your staff session is not valid; sign in again' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.booking_staff_assignments
     WHERE booking_id = p_booking_id AND staff_id = p_staff_id
       AND status <> 'cancelled' AND COALESCE(response_status, 'pending') <> 'rejected'
  ) THEN
    RAISE EXCEPTION 'You are not assigned to this booking' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'id', i.id,
             'paid_at', i.paid_at,
             'package', i.package,
             'package_start_time', i.package_start_time,
             'package_end_time', i.package_end_time,
             'setup_breakdown', i.setup_breakdown,
             'tablecloths', i.tablecloths,
             'tablecloth_quantity', i.tablecloth_quantity,
             'bar_package', i.bar_package,
             'bar_package_label', i.bar_package_label
           ) ORDER BY i.paid_at)
      FROM public.booking_addon_invoices i
     WHERE i.booking_id = p_booking_id
       AND i.payment_status = 'paid'
       AND i.voided_at IS NULL
  ), '[]'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.staff_get_paid_addons(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.staff_get_paid_addons(uuid, uuid) TO anon, authenticated, service_role;
