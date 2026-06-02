-- Add assignment_id to payroll export RPCs so PayrollItemEditModal can target the exact assignment
-- Previously the modal performed a reverse-lookup by (staff_name + scheduled_date), which silently
-- picked the wrong row whenever a staff member had multiple assignments on the same day.

DROP FUNCTION IF EXISTS public.get_payroll_line_items_export(date, date);
DROP FUNCTION IF EXISTS public.get_staff_payroll_line_items(uuid, date, date);

CREATE OR REPLACE FUNCTION public.get_payroll_line_items_export(p_start_date date, p_end_date date)
RETURNS TABLE(
  staff_name text,
  staff_role text,
  payroll_type text,
  assignment_date date,
  booking_id uuid,
  assignment_id uuid,
  reservation_number text,
  assignment_type text,
  pay_category text,
  pay_type text,
  amount numeric,
  hours numeric,
  rate numeric,
  description text,
  assignment_status text,
  paid_status text,
  paid_at timestamp with time zone,
  payroll_item_id uuid,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) AS assignment_date,
    bsa.booking_id,
    bsa.id AS assignment_id,
    b.reservation_number,
    bsa.assignment_type,
    spi.pay_category,
    spi.pay_type,
    spi.amount,
    spi.hours,
    spi.rate,
    spi.description,
    bsa.status AS assignment_status,
    spi.paid_status,
    spi.paid_at,
    spi.id AS payroll_item_id,
    spi.created_at
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
  )
    AND bsa.status != 'cancelled'
  ORDER BY assignment_date DESC, sm.full_name, spi.created_at;
$function$;

CREATE OR REPLACE FUNCTION public.get_staff_payroll_line_items(p_staff_id uuid, p_start_date date, p_end_date date)
RETURNS TABLE(
  staff_name text,
  staff_role text,
  payroll_type text,
  assignment_date date,
  booking_id uuid,
  assignment_id uuid,
  reservation_number text,
  assignment_type text,
  pay_category text,
  pay_type text,
  amount numeric,
  hours numeric,
  rate numeric,
  description text,
  assignment_status text,
  paid_status text,
  paid_at timestamp with time zone,
  payroll_item_id uuid,
  created_at timestamp with time zone
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) AS assignment_date,
    bsa.booking_id,
    bsa.id AS assignment_id,
    b.reservation_number,
    bsa.assignment_type,
    spi.pay_category,
    spi.pay_type,
    spi.amount,
    spi.hours,
    spi.rate,
    spi.description,
    bsa.status AS assignment_status,
    spi.paid_status,
    spi.paid_at,
    spi.id AS payroll_item_id,
    spi.created_at
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE sm.id = p_staff_id
    AND COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
    AND bsa.status != 'cancelled'
  ORDER BY assignment_date DESC, spi.created_at;
$function$;
