-- =========================================================================
-- Phase 4: Bar Service Revenue + Bar Vendor Payroll alignment
-- =========================================================================

-- 1) populate_booking_revenue_items: append bar_service line items (50/50 split)
CREATE OR REPLACE FUNCTION public.populate_booking_revenue_items(p_booking_id uuid, p_is_historical boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking RECORD;
  v_deposit_date DATE;
  v_balance_date DATE;
  v_cleaning_type text;
  v_cleaning_base decimal(10,2);
  v_celebration_surcharge decimal(10,2);
  v_bar_label text;
BEGIN
  SELECT 
    *,
    created_at::date as deposit_date,
    balance_paid_at::date as balance_date
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;
  
  IF v_booking.booking_origin != 'website' THEN
    RAISE NOTICE 'Skipping revenue for non-website booking % (origin: %)', p_booking_id, v_booking.booking_origin;
    RETURN;
  END IF;
  
  DELETE FROM public.booking_revenue_items WHERE booking_id = p_booking_id;
  
  v_deposit_date := v_booking.deposit_date;
  v_balance_date := v_booking.balance_date;
  
  IF v_deposit_date IS NULL THEN
    RAISE NOTICE 'No created_at date for booking %, skipping revenue', p_booking_id;
    RETURN;
  END IF;
  
  -- Baseline
  IF v_booking.base_rental > 0 THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
    VALUES (p_booking_id, 'baseline', v_booking.booking_type::text, ROUND(v_booking.base_rental * 0.5, 2), v_deposit_date, 'deposit',
      CASE WHEN v_booking.booking_type = 'daily' THEN 'Full Day Venue Rental (Deposit 50%)' ELSE 'Hourly Venue Rental (Deposit 50%)' END, p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'baseline', v_booking.booking_type::text, ROUND(v_booking.base_rental * 0.5, 2), v_balance_date, 'balance',
        CASE WHEN v_booking.booking_type = 'daily' THEN 'Full Day Venue Rental (Balance 50%)' ELSE 'Hourly Venue Rental (Balance 50%)' END, p_is_historical);
    END IF;
  END IF;
  
  -- Cleaning
  IF v_booking.cleaning_fee > 0 THEN
    IF v_booking.cleaning_fee <= 40 THEN v_cleaning_type := 'touch_up'; v_cleaning_base := 40; v_celebration_surcharge := v_booking.cleaning_fee - 40;
    ELSIF v_booking.cleaning_fee <= 80 THEN v_cleaning_type := 'regular'; v_cleaning_base := 80; v_celebration_surcharge := 0;
    ELSIF v_booking.cleaning_fee <= 150 THEN
      IF v_booking.cleaning_fee = 150 THEN v_cleaning_type := 'deep'; v_cleaning_base := 150; v_celebration_surcharge := 0;
      ELSE v_cleaning_type := 'regular'; v_cleaning_base := 80; v_celebration_surcharge := v_booking.cleaning_fee - 80; END IF;
    ELSE v_cleaning_type := 'deep'; v_cleaning_base := 150; v_celebration_surcharge := v_booking.cleaning_fee - 150; END IF;
    IF v_celebration_surcharge < 0 THEN v_celebration_surcharge := 0; END IF;
    
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
    VALUES (p_booking_id, 'cleaning_base', v_cleaning_type, ROUND(v_cleaning_base * 0.5, 2), v_deposit_date, 'deposit',
      CASE v_cleaning_type WHEN 'touch_up' THEN 'Touch-Up Cleaning (Deposit 50%)' WHEN 'regular' THEN 'Regular Cleaning (Deposit 50%)' WHEN 'deep' THEN 'Deep Cleaning (Deposit 50%)' ELSE 'Cleaning Service (Deposit 50%)' END, p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'cleaning_base', v_cleaning_type, ROUND(v_cleaning_base * 0.5, 2), v_balance_date, 'balance',
        CASE v_cleaning_type WHEN 'touch_up' THEN 'Touch-Up Cleaning (Balance 50%)' WHEN 'regular' THEN 'Regular Cleaning (Balance 50%)' WHEN 'deep' THEN 'Deep Cleaning (Balance 50%)' ELSE 'Cleaning Service (Balance 50%)' END, p_is_historical);
    END IF;
    IF v_celebration_surcharge > 0 THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical, metadata)
      VALUES (p_booking_id, 'cleaning_surcharge', 'celebration', ROUND(v_celebration_surcharge * 0.5, 2), v_deposit_date, 'deposit', 'Celebration Surcharge (Deposit 50%)', p_is_historical, jsonb_build_object('guest_count', v_booking.number_of_guests));
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical, metadata)
        VALUES (p_booking_id, 'cleaning_surcharge', 'celebration', ROUND(v_celebration_surcharge * 0.5, 2), v_balance_date, 'balance', 'Celebration Surcharge (Balance 50%)', p_is_historical, jsonb_build_object('guest_count', v_booking.number_of_guests));
      END IF;
    END IF;
  END IF;
  
  -- Production
  IF v_booking.package_cost > 0 AND v_booking.package != 'none' THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
    VALUES (p_booking_id, 'production', v_booking.package::text, ROUND(v_booking.package_cost * 0.5, 2), v_deposit_date, 'deposit',
      CASE v_booking.package WHEN 'basic' THEN 'Basic Production Package (Deposit 50%)' WHEN 'led' THEN 'LED Production Package (Deposit 50%)' WHEN 'workshop' THEN 'Workshop Production Package (Deposit 50%)' ELSE 'Production Package (Deposit 50%)' END, p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'production', v_booking.package::text, ROUND(v_booking.package_cost * 0.5, 2), v_balance_date, 'balance',
        CASE v_booking.package WHEN 'basic' THEN 'Basic Production Package (Balance 50%)' WHEN 'led' THEN 'LED Production Package (Balance 50%)' WHEN 'workshop' THEN 'Workshop Production Package (Balance 50%)' ELSE 'Production Package (Balance 50%)' END, p_is_historical);
    END IF;
  END IF;
  
  -- Add-ons (existing)
  IF v_booking.optional_services > 0 THEN
    IF v_booking.tablecloths AND v_booking.tablecloth_quantity > 0 THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, quantity, unit_price, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'addon', 'tablecloth', ROUND((v_booking.tablecloth_quantity * 5.00) * 0.5, 2), v_booking.tablecloth_quantity, 5.00, v_deposit_date, 'deposit', 'Tablecloth Rental (Deposit 50%)', p_is_historical);
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, quantity, unit_price, payment_date, payment_split, description, is_historical)
        VALUES (p_booking_id, 'addon', 'tablecloth', ROUND((v_booking.tablecloth_quantity * 5.00) * 0.5, 2), v_booking.tablecloth_quantity, 5.00, v_balance_date, 'balance', 'Tablecloth Rental (Balance 50%)', p_is_historical);
      END IF;
      IF v_booking.optional_services > (v_booking.tablecloth_quantity * 5.00) THEN
        INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
        VALUES (p_booking_id, 'addon', 'misc', ROUND((v_booking.optional_services - (v_booking.tablecloth_quantity * 5.00)) * 0.5, 2), v_deposit_date, 'deposit', 'Additional Add-ons (Deposit 50%)', p_is_historical);
        IF v_balance_date IS NOT NULL THEN
          INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
          VALUES (p_booking_id, 'addon', 'misc', ROUND((v_booking.optional_services - (v_booking.tablecloth_quantity * 5.00)) * 0.5, 2), v_balance_date, 'balance', 'Additional Add-ons (Balance 50%)', p_is_historical);
        END IF;
      END IF;
    ELSE
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'addon', 'misc', ROUND(v_booking.optional_services * 0.5, 2), v_deposit_date, 'deposit', 'Optional Services (Deposit 50%)', p_is_historical);
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
        VALUES (p_booking_id, 'addon', 'misc', ROUND(v_booking.optional_services * 0.5, 2), v_balance_date, 'balance', 'Optional Services (Balance 50%)', p_is_historical);
      END IF;
    END IF;
  END IF;
  
  IF v_booking.setup_breakdown THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
    VALUES (p_booking_id, 'addon', 'setup_breakdown', 75.00, v_deposit_date, 'deposit', 'Setup & Breakdown Service (Deposit 50%)', p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'addon', 'setup_breakdown', 75.00, v_balance_date, 'balance', 'Setup & Breakdown Service (Balance 50%)', p_is_historical);
    END IF;
  END IF;

  -- Bar Service (NEW: dedicated category, never under 'addon')
  IF COALESCE(v_booking.bar_package, 'none') <> 'none' AND COALESCE(v_booking.bar_subtotal, 0) > 0 THEN
    v_bar_label := COALESCE(v_booking.bar_package_label, public.get_bar_package_label(v_booking.bar_package), v_booking.bar_package);

    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, quantity, unit_price, payment_date, payment_split, description, is_historical, metadata)
    VALUES (
      p_booking_id, 'bar_service', v_booking.bar_package,
      ROUND(v_booking.bar_subtotal * 0.5, 2),
      v_booking.bar_guest_count,
      v_booking.bar_rate_per_guest,
      v_deposit_date, 'deposit',
      'Bar Service — ' || v_bar_label || ' (Deposit 50%)',
      p_is_historical,
      jsonb_build_object(
        'bar_package', v_booking.bar_package,
        'bar_package_label', v_bar_label,
        'guest_count', v_booking.bar_guest_count,
        'rate_per_guest', v_booking.bar_rate_per_guest
      )
    );

    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, quantity, unit_price, payment_date, payment_split, description, is_historical, metadata)
      VALUES (
        p_booking_id, 'bar_service', v_booking.bar_package,
        ROUND(v_booking.bar_subtotal * 0.5, 2),
        v_booking.bar_guest_count,
        v_booking.bar_rate_per_guest,
        v_balance_date, 'balance',
        'Bar Service — ' || v_bar_label || ' (Balance 50%)',
        p_is_historical,
        jsonb_build_object(
          'bar_package', v_booking.bar_package,
          'bar_package_label', v_bar_label,
          'guest_count', v_booking.bar_guest_count,
          'rate_per_guest', v_booking.bar_rate_per_guest
        )
      );
    END IF;
  END IF;
  
  -- Discount
  IF COALESCE(v_booking.discount_amount, 0) > 0 THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical, metadata)
    VALUES (p_booking_id, 'discount', COALESCE(v_booking.discount_code, 'manual'), ROUND(-1 * v_booking.discount_amount * 0.5, 2), v_deposit_date, 'deposit',
      CASE WHEN v_booking.discount_code IS NOT NULL THEN 'Discount: ' || v_booking.discount_code || ' (Deposit 50%)' ELSE 'Discount Applied (Deposit 50%)' END, p_is_historical, jsonb_build_object('code', v_booking.discount_code));
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical, metadata)
      VALUES (p_booking_id, 'discount', COALESCE(v_booking.discount_code, 'manual'), ROUND(-1 * v_booking.discount_amount * 0.5, 2), v_balance_date, 'balance',
        CASE WHEN v_booking.discount_code IS NOT NULL THEN 'Discount: ' || v_booking.discount_code || ' (Balance 50%)' ELSE 'Discount Applied (Balance 50%)' END, p_is_historical, jsonb_build_object('code', v_booking.discount_code));
    END IF;
  END IF;
  
  -- Tax
  IF v_booking.taxes_fees > 0 THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
    VALUES (p_booking_id, 'tax', 'taxes_fees', ROUND(v_booking.taxes_fees * 0.5, 2), v_deposit_date, 'deposit', 'Taxes & Fees (Deposit 50%)', p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'tax', 'taxes_fees', ROUND(v_booking.taxes_fees * 0.5, 2), v_balance_date, 'balance', 'Taxes & Fees (Balance 50%)', p_is_historical);
    END IF;
  END IF;
END;
$function$;

-- 2) get_daily_revenue: add bar_revenue column
DROP FUNCTION IF EXISTS public.get_daily_revenue(date, date);
CREATE OR REPLACE FUNCTION public.get_daily_revenue(p_start_date date, p_end_date date)
 RETURNS TABLE(revenue_date date, total_revenue numeric, booking_count bigint, baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric, addon_revenue numeric, bar_revenue numeric, fee_revenue numeric, discount_amount numeric, tax_amount numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT bri.payment_date as revenue_date, SUM(bri.amount) as total_revenue, COUNT(DISTINCT b.id) as booking_count,
    SUM(CASE WHEN bri.item_category = 'baseline' THEN bri.amount ELSE 0 END) as baseline_revenue,
    SUM(CASE WHEN bri.item_category IN ('cleaning_base', 'cleaning_surcharge') THEN bri.amount ELSE 0 END) as cleaning_revenue,
    SUM(CASE WHEN bri.item_category = 'production' THEN bri.amount ELSE 0 END) as production_revenue,
    SUM(CASE WHEN bri.item_category = 'addon' THEN bri.amount ELSE 0 END) as addon_revenue,
    SUM(CASE WHEN bri.item_category = 'bar_service' THEN bri.amount ELSE 0 END) as bar_revenue,
    SUM(CASE WHEN bri.item_category = 'fee' THEN bri.amount ELSE 0 END) as fee_revenue,
    SUM(CASE WHEN bri.item_category = 'discount' THEN bri.amount ELSE 0 END) as discount_amount,
    SUM(CASE WHEN bri.item_category = 'tax' THEN bri.amount ELSE 0 END) as tax_amount
  FROM public.booking_revenue_items bri
  JOIN public.bookings b ON b.id = bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date AND bri.payment_date IS NOT NULL
    AND b.booking_origin = 'website' AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY bri.payment_date ORDER BY bri.payment_date;
$function$;

-- 3) get_monthly_revenue: add bar_revenue column
DROP FUNCTION IF EXISTS public.get_monthly_revenue(date, date);
CREATE OR REPLACE FUNCTION public.get_monthly_revenue(p_start_date date, p_end_date date)
 RETURNS TABLE(revenue_month text, year_month date, total_revenue numeric, booking_count bigint, baseline_revenue numeric, cleaning_revenue numeric, production_revenue numeric, addon_revenue numeric, bar_revenue numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT TO_CHAR(bri.payment_date, 'YYYY-MM') as revenue_month, DATE_TRUNC('month', bri.payment_date)::date as year_month,
    SUM(bri.amount) as total_revenue, COUNT(DISTINCT b.id) as booking_count,
    SUM(CASE WHEN bri.item_category = 'baseline' THEN bri.amount ELSE 0 END) as baseline_revenue,
    SUM(CASE WHEN bri.item_category IN ('cleaning_base', 'cleaning_surcharge') THEN bri.amount ELSE 0 END) as cleaning_revenue,
    SUM(CASE WHEN bri.item_category = 'production' THEN bri.amount ELSE 0 END) as production_revenue,
    SUM(CASE WHEN bri.item_category = 'addon' THEN bri.amount ELSE 0 END) as addon_revenue,
    SUM(CASE WHEN bri.item_category = 'bar_service' THEN bri.amount ELSE 0 END) as bar_revenue
  FROM public.booking_revenue_items bri
  JOIN public.bookings b ON b.id = bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date AND bri.payment_date IS NOT NULL
    AND b.booking_origin = 'website' AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY TO_CHAR(bri.payment_date, 'YYYY-MM'), DATE_TRUNC('month', bri.payment_date) ORDER BY year_month;
$function$;

-- 4) get_daily_generated_revenue: add bar_generated column (uses booking columns directly)
DROP FUNCTION IF EXISTS public.get_daily_generated_revenue(date, date);
CREATE OR REPLACE FUNCTION public.get_daily_generated_revenue(p_start_date date, p_end_date date)
 RETURNS TABLE(generated_date date, booking_count bigint, total_generated numeric, baseline_generated numeric, cleaning_generated numeric, production_generated numeric, addon_generated numeric, bar_generated numeric, tax_generated numeric, discount_generated numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT (b.created_at AT TIME ZONE 'America/New_York')::date AS generated_date, COUNT(*) AS booking_count,
    SUM(b.total_amount) AS total_generated, SUM(b.base_rental) AS baseline_generated,
    SUM(b.cleaning_fee) AS cleaning_generated, SUM(b.package_cost) AS production_generated,
    SUM(b.optional_services) AS addon_generated,
    SUM(COALESCE(b.bar_subtotal, 0)) AS bar_generated,
    SUM(b.taxes_fees) AS tax_generated,
    SUM(-1 * COALESCE(b.discount_amount, 0)) AS discount_generated
  FROM public.bookings b
  WHERE (b.created_at AT TIME ZONE 'America/New_York')::date BETWEEN p_start_date AND p_end_date
    AND b.booking_origin = 'website' AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY (b.created_at AT TIME ZONE 'America/New_York')::date ORDER BY (b.created_at AT TIME ZONE 'America/New_York')::date;
$function$;

-- 5) populate_staff_payroll_items: add Bar Vendor branches
CREATE OR REPLACE FUNCTION public.populate_staff_payroll_items(p_assignment_id uuid, p_is_historical boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_assignment RECORD;
  v_staff RECORD;
  v_booking RECORD;
  v_hourly_rate DECIMAL(10,2);
  v_hours DECIMAL(5,2);
  v_base_pay DECIMAL(10,2);
  v_flat_rate DECIMAL(10,2);
BEGIN
  SELECT * INTO v_assignment
  FROM public.booking_staff_assignments
  WHERE id = p_assignment_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Assignment not found: %', p_assignment_id;
  END IF;
  
  SELECT * INTO v_staff
  FROM public.staff_members
  WHERE id = v_assignment.staff_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Staff member not found: %', v_assignment.staff_id;
  END IF;
  
  IF v_staff.payroll_type = 'none' THEN
    RAISE NOTICE 'Staff % has payroll_type=none, skipping payroll calculation', v_staff.full_name;
    RETURN;
  END IF;
  
  IF v_assignment.booking_id IS NOT NULL THEN
    SELECT * INTO v_booking
    FROM public.bookings
    WHERE id = v_assignment.booking_id;
  END IF;
  
  -- Duplicate prevention: clear existing items for this assignment
  DELETE FROM public.staff_payroll_items WHERE assignment_id = p_assignment_id;
  
  IF v_staff.payroll_type = 'hourly' THEN
    v_hourly_rate := COALESCE(v_staff.hourly_rate, 50.00);
    v_hours := COALESCE(v_assignment.hours_worked, 0);
    
    IF v_hours = 0 AND v_booking.package_start_time IS NOT NULL AND v_booking.package_end_time IS NOT NULL THEN
      v_hours := EXTRACT(EPOCH FROM (v_booking.package_end_time - v_booking.package_start_time)) / 3600.0;
    END IF;
    
    IF v_hours > 0 THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type, 
        amount, hours, rate, description, is_historical
      )
      VALUES (
        p_assignment_id,
        v_assignment.staff_id,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'hourly_bar_vendor' ELSE 'hourly_production' END,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'bar_vendor' ELSE 'production' END,
        v_hours * v_hourly_rate,
        v_hours,
        v_hourly_rate,
        CASE WHEN v_assignment.assignment_role = 'Bar Vendor' THEN 'Bar Vendor Services' ELSE 'Production Services' END,
        p_is_historical
      );
    END IF;
    
  ELSIF v_staff.payroll_type = 'per_assignment' THEN
    -- BAR VENDOR: flat per-assignment rate equal to staff hourly_rate (reused as flat fee).
    -- Check FIRST so it takes precedence over Assistant/cleaning_type branches.
    IF v_assignment.assignment_role = 'Bar Vendor' THEN
      v_flat_rate := COALESCE(v_staff.hourly_rate, 0);
      IF v_flat_rate > 0 THEN
        INSERT INTO public.staff_payroll_items (
          assignment_id, staff_id, pay_category, pay_type,
          amount, description, is_historical
        )
        VALUES (
          p_assignment_id,
          v_assignment.staff_id,
          'bar_vendor_flat',
          'fixed',
          v_flat_rate,
          'Bar Vendor Assignment – Flat Rate ($' || v_flat_rate::text || ')',
          p_is_historical
        );
      END IF;
    -- ASSISTANT: Fixed $80 flat rate
    ELSIF v_assignment.assignment_role = 'Assistant' THEN
      INSERT INTO public.staff_payroll_items (
        assignment_id, staff_id, pay_category, pay_type,
        amount, description, is_historical
      )
      VALUES (
        p_assignment_id,
        v_assignment.staff_id,
        'base_pay',
        'fixed',
        80.00,
        'Assistant Assignment – Flat Rate ($80)',
        p_is_historical
      );
    -- CUSTODIAL: Cleaning type-based pay
    ELSIF v_assignment.cleaning_type IS NOT NULL THEN
      v_base_pay := CASE v_assignment.cleaning_type
        WHEN 'touch_up' THEN 40.00
        WHEN 'regular' THEN 80.00
        WHEN 'deep' THEN 150.00
        ELSE 0
      END;
      
      IF v_base_pay > 0 THEN
        INSERT INTO public.staff_payroll_items (
          assignment_id, staff_id, pay_category, pay_type,
          amount, description, is_historical
        )
        VALUES (
          p_assignment_id,
          v_assignment.staff_id,
          'cleaning_base',
          v_assignment.cleaning_type,
          v_base_pay,
          CASE v_assignment.cleaning_type
            WHEN 'touch_up' THEN 'Touch-Up Cleaning'
            WHEN 'regular' THEN 'Regular Cleaning'
            WHEN 'deep' THEN 'Deep Cleaning'
          END,
          p_is_historical
        );
      END IF;
      
      IF COALESCE(v_assignment.celebration_surcharge, 0) > 0 THEN
        INSERT INTO public.staff_payroll_items (
          assignment_id, staff_id, pay_category, pay_type,
          amount, description, is_historical
        )
        VALUES (
          p_assignment_id,
          v_assignment.staff_id,
          'cleaning_surcharge',
          'celebration',
          v_assignment.celebration_surcharge,
          'Celebration Surcharge',
          p_is_historical
        );
      END IF;
    END IF;
  END IF;
  
  RAISE NOTICE 'Payroll items populated for assignment % (staff: %)', p_assignment_id, v_staff.full_name;
END;
$function$;