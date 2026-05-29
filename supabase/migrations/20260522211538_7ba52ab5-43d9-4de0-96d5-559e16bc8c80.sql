
-- Update payroll RPCs so the displayed/grouping date is the BOOKING EVENT DATE
-- (not the balance-paid / completed_at date). Standalone assignments fall back
-- to scheduled_date then completed_at.

CREATE OR REPLACE FUNCTION public.get_payroll_by_staff(p_start_date date, p_end_date date, p_staff_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(staff_id uuid, staff_name text, staff_role text, payroll_type text, total_amount numeric, assignment_count bigint, hours_worked numeric, avg_per_assignment numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    sm.id AS staff_id,
    sm.full_name AS staff_name,
    sm.role AS staff_role,
    sm.payroll_type,
    SUM(spi.amount) AS total_amount,
    COUNT(DISTINCT spi.assignment_id) AS assignment_count,
    SUM(spi.hours) AS hours_worked,
    ROUND(SUM(spi.amount) / NULLIF(COUNT(DISTINCT spi.assignment_id), 0), 2) AS avg_per_assignment
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
  )
    AND (p_staff_id IS NULL OR sm.id = p_staff_id)
    AND bsa.status != 'cancelled'
  GROUP BY sm.id, sm.full_name, sm.role, sm.payroll_type
  ORDER BY total_amount DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_payroll_by_role(p_start_date date, p_end_date date)
 RETURNS TABLE(staff_role text, payroll_type text, staff_count bigint, total_amount numeric, assignment_count bigint, hours_worked numeric, avg_per_staff numeric, avg_per_assignment numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    sm.role AS staff_role,
    sm.payroll_type,
    COUNT(DISTINCT sm.id) AS staff_count,
    SUM(spi.amount) AS total_amount,
    COUNT(DISTINCT spi.assignment_id) AS assignment_count,
    SUM(spi.hours) AS hours_worked,
    ROUND(SUM(spi.amount) / NULLIF(COUNT(DISTINCT sm.id), 0), 2) AS avg_per_staff,
    ROUND(SUM(spi.amount) / NULLIF(COUNT(DISTINCT spi.assignment_id), 0), 2) AS avg_per_assignment
  FROM public.staff_payroll_items spi
  JOIN public.booking_staff_assignments bsa ON bsa.id = spi.assignment_id
  JOIN public.staff_members sm ON sm.id = spi.staff_id
  LEFT JOIN public.bookings b ON b.id = bsa.booking_id
  WHERE (
    COALESCE(b.event_date, bsa.scheduled_date, bsa.completed_at::DATE) BETWEEN p_start_date AND p_end_date
  )
    AND bsa.status != 'cancelled'
  GROUP BY sm.role, sm.payroll_type
  ORDER BY total_amount DESC;
$function$;

CREATE OR REPLACE FUNCTION public.get_payroll_line_items_export(p_start_date date, p_end_date date)
 RETURNS TABLE(staff_name text, staff_role text, payroll_type text, assignment_date date, booking_id uuid, reservation_number text, assignment_type text, pay_category text, pay_type text, amount numeric, hours numeric, rate numeric, description text, assignment_status text, paid_status text, paid_at timestamp with time zone, payroll_item_id uuid, created_at timestamp with time zone)
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
 RETURNS TABLE(staff_name text, staff_role text, payroll_type text, assignment_date date, booking_id uuid, reservation_number text, assignment_type text, pay_category text, pay_type text, amount numeric, hours numeric, rate numeric, description text, assignment_status text, paid_status text, paid_at timestamp with time zone, payroll_item_id uuid, created_at timestamp with time zone)
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
