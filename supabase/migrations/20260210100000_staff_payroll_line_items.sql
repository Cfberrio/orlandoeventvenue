-- Staff-specific payroll line items function
-- Returns payroll line items filtered by a REQUIRED staff_id parameter.
-- Used in the staff portal so each staff member can only see their own data.

CREATE OR REPLACE FUNCTION public.get_staff_payroll_line_items(
  p_staff_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS TABLE(
  staff_name TEXT,
  staff_role TEXT,
  payroll_type TEXT,
  assignment_date DATE,
  booking_id UUID,
  reservation_number TEXT,
  assignment_type TEXT,
  pay_category TEXT,
  pay_type TEXT,
  amount NUMERIC,
  hours NUMERIC,
  rate NUMERIC,
  description TEXT,
  assignment_status TEXT,
  paid_status TEXT,
  paid_at TIMESTAMPTZ,
  payroll_item_id UUID,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date) AS assignment_date,
    bsa.booking_id,
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
  WHERE spi.staff_id = p_staff_id
    AND (
      COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date)
      BETWEEN p_start_date AND p_end_date
    )
    AND bsa.status != 'cancelled'
  ORDER BY assignment_date DESC, spi.created_at;
$function$;
