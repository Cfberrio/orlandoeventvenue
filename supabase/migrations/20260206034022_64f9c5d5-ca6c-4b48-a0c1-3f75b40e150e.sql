
-- Add paid_status and paid_at columns to staff_payroll_items
ALTER TABLE public.staff_payroll_items 
ADD COLUMN IF NOT EXISTS paid_status text NOT NULL DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS paid_at timestamptz;

-- Migrate any existing paid data from metadata
UPDATE public.staff_payroll_items
SET 
  paid_status = 'paid',
  paid_at = (metadata->>'paid_at')::timestamptz
WHERE metadata->>'paid' = 'true';

-- Drop and recreate the function with new return type
DROP FUNCTION IF EXISTS public.get_payroll_line_items_export(date, date);

CREATE OR REPLACE FUNCTION public.get_payroll_line_items_export(p_start_date date, p_end_date date)
 RETURNS TABLE(
   staff_name text, 
   staff_role text, 
   payroll_type text, 
   assignment_date date, 
   booking_id uuid, 
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
   paid_at timestamptz,
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
  WHERE (
    COALESCE(bsa.scheduled_date, bsa.completed_at::DATE, b.event_date) BETWEEN p_start_date AND p_end_date
  )
    AND bsa.status != 'cancelled'
  ORDER BY assignment_date DESC, sm.full_name, spi.created_at;
$function$;
