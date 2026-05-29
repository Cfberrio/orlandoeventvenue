-- =====================================================
-- FIX REVENUE REPORTING: DATE AND ORIGIN FILTERS
-- =====================================================
-- 1. Use created_at::date (booking creation date) for deposit items
--    instead of deposit_paid_at::date
-- 2. Filter only booking_origin = 'website_public'
--    (not just != 'internal_admin')
-- 3. Re-backfill all revenue data
-- =====================================================

-- =====================================================
-- 1) FIX populate_booking_revenue_items
-- =====================================================

CREATE OR REPLACE FUNCTION public.populate_booking_revenue_items(
  p_booking_id uuid, 
  p_is_historical boolean DEFAULT false
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_deposit_date DATE;
  v_balance_date DATE;
  v_cleaning_type text;
  v_cleaning_base decimal(10,2);
  v_celebration_surcharge decimal(10,2);
BEGIN
  -- Get booking data: use created_at for deposit date, balance_paid_at for balance date
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
  
  -- ONLY include website_public bookings in revenue tracking
  IF v_booking.booking_origin != 'website_public' THEN
    RAISE NOTICE 'Skipping revenue for non-website booking % (origin: %)', p_booking_id, v_booking.booking_origin;
    RETURN;
  END IF;
  
  -- Delete existing revenue items for this booking
  DELETE FROM public.booking_revenue_items WHERE booking_id = p_booking_id;
  
  v_deposit_date := v_booking.deposit_date;
  v_balance_date := v_booking.balance_date;
  
  -- Skip if no deposit date (created_at is always present, so this is a safety check)
  IF v_deposit_date IS NULL THEN
    RAISE NOTICE 'No created_at date for booking %, skipping revenue', p_booking_id;
    RETURN;
  END IF;
  
  -- ==========================================
  -- 1. BASELINE RENTAL (split 50/50)
  -- ==========================================
  IF v_booking.base_rental > 0 THEN
    -- Deposit portion (50%)
    INSERT INTO public.booking_revenue_items (
      booking_id, item_category, item_type, amount, 
      payment_date, payment_split, description, is_historical
    )
    VALUES (
      p_booking_id, 
      'baseline', 
      v_booking.booking_type::text,
      ROUND(v_booking.base_rental * 0.5, 2),
      v_deposit_date, 
      'deposit',
      CASE 
        WHEN v_booking.booking_type = 'daily' THEN 'Full Day Venue Rental (Deposit 50%)'
        ELSE 'Hourly Venue Rental (Deposit 50%)'
      END,
      p_is_historical
    );
    
    -- Balance portion (50%) - only if balance is paid
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount,
        payment_date, payment_split, description, is_historical
      )
      VALUES (
        p_booking_id, 
        'baseline', 
        v_booking.booking_type::text,
        ROUND(v_booking.base_rental * 0.5, 2),
        v_balance_date, 
        'balance',
        CASE 
          WHEN v_booking.booking_type = 'daily' THEN 'Full Day Venue Rental (Balance 50%)'
          ELSE 'Hourly Venue Rental (Balance 50%)'
        END,
        p_is_historical
      );
    END IF;
  END IF;
  
  -- ==========================================
  -- 2. CLEANING FEE BREAKDOWN (split 50/50)
  -- ==========================================
  IF v_booking.cleaning_fee > 0 THEN
    IF v_booking.cleaning_fee <= 40 THEN
      v_cleaning_type := 'touch_up';
      v_cleaning_base := 40;
      v_celebration_surcharge := v_booking.cleaning_fee - 40;
    ELSIF v_booking.cleaning_fee <= 80 THEN
      v_cleaning_type := 'regular';
      v_cleaning_base := 80;
      v_celebration_surcharge := 0;
    ELSIF v_booking.cleaning_fee <= 150 THEN
      IF v_booking.cleaning_fee = 150 THEN
        v_cleaning_type := 'deep';
        v_cleaning_base := 150;
        v_celebration_surcharge := 0;
      ELSE
        v_cleaning_type := 'regular';
        v_cleaning_base := 80;
        v_celebration_surcharge := v_booking.cleaning_fee - 80;
      END IF;
    ELSE
      v_cleaning_type := 'deep';
      v_cleaning_base := 150;
      v_celebration_surcharge := v_booking.cleaning_fee - 150;
    END IF;
    
    IF v_celebration_surcharge < 0 THEN
      v_celebration_surcharge := 0;
    END IF;
    
    -- Insert base cleaning (deposit 50%)
    INSERT INTO public.booking_revenue_items (
      booking_id, item_category, item_type, amount, 
      payment_date, payment_split, description, is_historical
    )
    VALUES (
      p_booking_id,
      'cleaning_base',
      v_cleaning_type,
      ROUND(v_cleaning_base * 0.5, 2),
      v_deposit_date,
      'deposit',
      CASE v_cleaning_type
        WHEN 'touch_up' THEN 'Touch-Up Cleaning (Deposit 50%)'
        WHEN 'regular' THEN 'Regular Cleaning (Deposit 50%)'
        WHEN 'deep' THEN 'Deep Cleaning (Deposit 50%)'
        ELSE 'Cleaning Service (Deposit 50%)'
      END,
      p_is_historical
    );
    
    -- Insert base cleaning (balance 50%)
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount,
        payment_date, payment_split, description, is_historical
      )
      VALUES (
        p_booking_id,
        'cleaning_base',
        v_cleaning_type,
        ROUND(v_cleaning_base * 0.5, 2),
        v_balance_date,
        'balance',
        CASE v_cleaning_type
          WHEN 'touch_up' THEN 'Touch-Up Cleaning (Balance 50%)'
          WHEN 'regular' THEN 'Regular Cleaning (Balance 50%)'
          WHEN 'deep' THEN 'Deep Cleaning (Balance 50%)'
          ELSE 'Cleaning Service (Balance 50%)'
        END,
        p_is_historical
      );
    END IF;
    
    -- Insert celebration surcharge if applicable (deposit 50%)
    IF v_celebration_surcharge > 0 THEN
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount, 
        payment_date, payment_split, description, is_historical, metadata
      )
      VALUES (
        p_booking_id,
        'cleaning_surcharge',
        'celebration',
        ROUND(v_celebration_surcharge * 0.5, 2),
        v_deposit_date,
        'deposit',
        'Celebration Surcharge (Deposit 50%)',
        p_is_historical,
        jsonb_build_object('guest_count', v_booking.number_of_guests)
      );
      
      -- Insert celebration surcharge (balance 50%)
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (
          booking_id, item_category, item_type, amount,
          payment_date, payment_split, description, is_historical, metadata
        )
        VALUES (
          p_booking_id,
          'cleaning_surcharge',
          'celebration',
          ROUND(v_celebration_surcharge * 0.5, 2),
          v_balance_date,
          'balance',
          'Celebration Surcharge (Balance 50%)',
          p_is_historical,
          jsonb_build_object('guest_count', v_booking.number_of_guests)
        );
      END IF;
    END IF;
  END IF;
  
  -- ==========================================
  -- 3. PRODUCTION PACKAGE (split 50/50)
  -- ==========================================
  IF v_booking.package_cost > 0 AND v_booking.package != 'none' THEN
    -- Deposit portion (50%)
    INSERT INTO public.booking_revenue_items (
      booking_id, item_category, item_type, amount, 
      payment_date, payment_split, description, is_historical
    )
    VALUES (
      p_booking_id,
      'production',
      v_booking.package::text,
      ROUND(v_booking.package_cost * 0.5, 2),
      v_deposit_date,
      'deposit',
      CASE v_booking.package
        WHEN 'basic' THEN 'Basic Production Package (Deposit 50%)'
        WHEN 'led' THEN 'LED Production Package (Deposit 50%)'
        WHEN 'workshop' THEN 'Workshop Production Package (Deposit 50%)'
        ELSE 'Production Package (Deposit 50%)'
      END,
      p_is_historical
    );
    
    -- Balance portion (50%)
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount,
        payment_date, payment_split, description, is_historical
      )
      VALUES (
        p_booking_id,
        'production',
        v_booking.package::text,
        ROUND(v_booking.package_cost * 0.5, 2),
        v_balance_date,
        'balance',
        CASE v_booking.package
          WHEN 'basic' THEN 'Basic Production Package (Balance 50%)'
          WHEN 'led' THEN 'LED Production Package (Balance 50%)'
          WHEN 'workshop' THEN 'Workshop Production Package (Balance 50%)'
          ELSE 'Production Package (Balance 50%)'
        END,
        p_is_historical
      );
    END IF;
  END IF;
  
  -- ==========================================
  -- 4. OPTIONAL SERVICES / ADD-ONS (split 50/50)
  -- ==========================================
  IF v_booking.optional_services > 0 THEN
    IF v_booking.tablecloths AND v_booking.tablecloth_quantity > 0 THEN
      -- Deposit portion (50%)
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount, quantity, unit_price,
        payment_date, payment_split, description, is_historical
      )
      VALUES (
        p_booking_id,
        'addon',
        'tablecloth',
        ROUND((v_booking.tablecloth_quantity * 5.00) * 0.5, 2),
        v_booking.tablecloth_quantity,
        5.00,
        v_deposit_date,
        'deposit',
        'Tablecloth Rental (Deposit 50%)',
        p_is_historical
      );
      
      -- Balance portion (50%)
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (
          booking_id, item_category, item_type, amount, quantity, unit_price,
          payment_date, payment_split, description, is_historical
        )
        VALUES (
          p_booking_id,
          'addon',
          'tablecloth',
          ROUND((v_booking.tablecloth_quantity * 5.00) * 0.5, 2),
          v_booking.tablecloth_quantity,
          5.00,
          v_balance_date,
          'balance',
          'Tablecloth Rental (Balance 50%)',
          p_is_historical
        );
      END IF;
      
      -- Remaining optional services (if any)
      IF v_booking.optional_services > (v_booking.tablecloth_quantity * 5.00) THEN
        DECLARE
          v_remaining_services DECIMAL(10,2);
        BEGIN
          v_remaining_services := v_booking.optional_services - (v_booking.tablecloth_quantity * 5.00);
          
          INSERT INTO public.booking_revenue_items (
            booking_id, item_category, item_type, amount,
            payment_date, payment_split, description, is_historical
          )
          VALUES (
            p_booking_id,
            'addon',
            'misc',
            ROUND(v_remaining_services * 0.5, 2),
            v_deposit_date,
            'deposit',
            'Additional Add-ons (Deposit 50%)',
            p_is_historical
          );
          
          IF v_balance_date IS NOT NULL THEN
            INSERT INTO public.booking_revenue_items (
              booking_id, item_category, item_type, amount,
              payment_date, payment_split, description, is_historical
            )
            VALUES (
              p_booking_id,
              'addon',
              'misc',
              ROUND(v_remaining_services * 0.5, 2),
              v_balance_date,
              'balance',
              'Additional Add-ons (Balance 50%)',
              p_is_historical
            );
          END IF;
        END;
      END IF;
    ELSE
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount,
        payment_date, payment_split, description, is_historical
      )
      VALUES (
        p_booking_id,
        'addon',
        'misc',
        ROUND(v_booking.optional_services * 0.5, 2),
        v_deposit_date,
        'deposit',
        'Optional Services (Deposit 50%)',
        p_is_historical
      );
      
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (
          booking_id, item_category, item_type, amount,
          payment_date, payment_split, description, is_historical
        )
        VALUES (
          p_booking_id,
          'addon',
          'misc',
          ROUND(v_booking.optional_services * 0.5, 2),
          v_balance_date,
          'balance',
          'Optional Services (Balance 50%)',
          p_is_historical
        );
      END IF;
    END IF;
  END IF;
  
  -- ==========================================
  -- 5. SETUP/BREAKDOWN FEE (split 50/50)
  -- ==========================================
  IF v_booking.setup_breakdown THEN
    INSERT INTO public.booking_revenue_items (
      booking_id, item_category, item_type, amount,
      payment_date, payment_split, description, is_historical
    )
    VALUES (
      p_booking_id,
      'addon',
      'setup_breakdown',
      75.00,
      v_deposit_date,
      'deposit',
      'Setup & Breakdown Service (Deposit 50%)',
      p_is_historical
    );
    
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount,
        payment_date, payment_split, description, is_historical
      )
      VALUES (
        p_booking_id,
        'addon',
        'setup_breakdown',
        75.00,
        v_balance_date,
        'balance',
        'Setup & Breakdown Service (Balance 50%)',
        p_is_historical
      );
    END IF;
  END IF;
  
  -- ==========================================
  -- 6. DISCOUNT (split 50/50, negative amounts)
  -- ==========================================
  IF COALESCE(v_booking.discount_amount, 0) > 0 THEN
    INSERT INTO public.booking_revenue_items (
      booking_id, item_category, item_type, amount,
      payment_date, payment_split, description, is_historical, metadata
    )
    VALUES (
      p_booking_id,
      'discount',
      COALESCE(v_booking.discount_code, 'manual'),
      ROUND(-1 * v_booking.discount_amount * 0.5, 2),
      v_deposit_date,
      'deposit',
      CASE 
        WHEN v_booking.discount_code IS NOT NULL THEN 'Discount: ' || v_booking.discount_code || ' (Deposit 50%)'
        ELSE 'Discount Applied (Deposit 50%)'
      END,
      p_is_historical,
      jsonb_build_object('code', v_booking.discount_code)
    );
    
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount,
        payment_date, payment_split, description, is_historical, metadata
      )
      VALUES (
        p_booking_id,
        'discount',
        COALESCE(v_booking.discount_code, 'manual'),
        ROUND(-1 * v_booking.discount_amount * 0.5, 2),
        v_balance_date,
        'balance',
        CASE 
          WHEN v_booking.discount_code IS NOT NULL THEN 'Discount: ' || v_booking.discount_code || ' (Balance 50%)'
          ELSE 'Discount Applied (Balance 50%)'
        END,
        p_is_historical,
        jsonb_build_object('code', v_booking.discount_code)
      );
    END IF;
  END IF;
  
  -- ==========================================
  -- 7. TAXES AND FEES (split 50/50)
  -- ==========================================
  IF v_booking.taxes_fees > 0 THEN
    INSERT INTO public.booking_revenue_items (
      booking_id, item_category, item_type, amount,
      payment_date, payment_split, description, is_historical
    )
    VALUES (
      p_booking_id,
      'tax',
      'taxes_fees',
      ROUND(v_booking.taxes_fees * 0.5, 2),
      v_deposit_date,
      'deposit',
      'Taxes & Fees (Deposit 50%)',
      p_is_historical
    );
    
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (
        booking_id, item_category, item_type, amount,
        payment_date, payment_split, description, is_historical
      )
      VALUES (
        p_booking_id,
        'tax',
        'taxes_fees',
        ROUND(v_booking.taxes_fees * 0.5, 2),
        v_balance_date,
        'balance',
        'Taxes & Fees (Balance 50%)',
        p_is_historical
      );
    END IF;
  END IF;
  
END;
$$;

-- =====================================================
-- 2) FIX get_daily_revenue - origin filter
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_daily_revenue(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  revenue_date date,
  total_revenue decimal,
  booking_count bigint,
  baseline_revenue decimal,
  cleaning_revenue decimal,
  production_revenue decimal,
  addon_revenue decimal,
  fee_revenue decimal,
  discount_amount decimal,
  tax_amount decimal
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    bri.payment_date as revenue_date,
    SUM(bri.amount) as total_revenue,
    COUNT(DISTINCT b.id) as booking_count,
    SUM(CASE WHEN bri.item_category = 'baseline' THEN bri.amount ELSE 0 END) as baseline_revenue,
    SUM(CASE WHEN bri.item_category IN ('cleaning_base', 'cleaning_surcharge') THEN bri.amount ELSE 0 END) as cleaning_revenue,
    SUM(CASE WHEN bri.item_category = 'production' THEN bri.amount ELSE 0 END) as production_revenue,
    SUM(CASE WHEN bri.item_category = 'addon' THEN bri.amount ELSE 0 END) as addon_revenue,
    SUM(CASE WHEN bri.item_category = 'fee' THEN bri.amount ELSE 0 END) as fee_revenue,
    SUM(CASE WHEN bri.item_category = 'discount' THEN bri.amount ELSE 0 END) as discount_amount,
    SUM(CASE WHEN bri.item_category = 'tax' THEN bri.amount ELSE 0 END) as tax_amount
  FROM public.booking_revenue_items bri
  JOIN public.bookings b ON b.id = bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date
    AND bri.payment_date IS NOT NULL
    AND b.booking_origin = 'website_public'
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY bri.payment_date
  ORDER BY bri.payment_date;
$$;

-- =====================================================
-- 3) FIX get_monthly_revenue - origin filter
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_monthly_revenue(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  revenue_month text,
  year_month date,
  total_revenue decimal,
  booking_count bigint,
  baseline_revenue decimal,
  cleaning_revenue decimal,
  production_revenue decimal,
  addon_revenue decimal
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    TO_CHAR(bri.payment_date, 'YYYY-MM') as revenue_month,
    DATE_TRUNC('month', bri.payment_date)::date as year_month,
    SUM(bri.amount) as total_revenue,
    COUNT(DISTINCT b.id) as booking_count,
    SUM(CASE WHEN bri.item_category = 'baseline' THEN bri.amount ELSE 0 END) as baseline_revenue,
    SUM(CASE WHEN bri.item_category IN ('cleaning_base', 'cleaning_surcharge') THEN bri.amount ELSE 0 END) as cleaning_revenue,
    SUM(CASE WHEN bri.item_category = 'production' THEN bri.amount ELSE 0 END) as production_revenue,
    SUM(CASE WHEN bri.item_category = 'addon' THEN bri.amount ELSE 0 END) as addon_revenue
  FROM public.booking_revenue_items bri
  JOIN public.bookings b ON b.id = bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date
    AND bri.payment_date IS NOT NULL
    AND b.booking_origin = 'website_public'
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY TO_CHAR(bri.payment_date, 'YYYY-MM'), DATE_TRUNC('month', bri.payment_date)
  ORDER BY year_month;
$$;

-- =====================================================
-- 4) FIX get_revenue_by_category - origin filter
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_revenue_by_category(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  category text,
  item_type text,
  total_amount decimal,
  item_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    bri.item_category as category,
    bri.item_type,
    SUM(bri.amount) as total_amount,
    COUNT(*) as item_count
  FROM public.booking_revenue_items bri
  JOIN public.bookings b ON b.id = bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date
    AND bri.payment_date IS NOT NULL
    AND b.booking_origin = 'website_public'
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY bri.item_category, bri.item_type
  ORDER BY bri.item_category, total_amount DESC;
$$;

-- =====================================================
-- 5) FIX get_revenue_by_segment - origin filter
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_revenue_by_segment(
  p_start_date date,
  p_end_date date,
  p_segment_by text DEFAULT 'booking_origin'
)
RETURNS TABLE(
  segment text,
  total_revenue decimal,
  booking_count bigint,
  avg_revenue decimal
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT 
      b.%I::text as segment,
      SUM(bri.amount) as total_revenue,
      COUNT(DISTINCT b.id) as booking_count,
      ROUND(SUM(bri.amount) / NULLIF(COUNT(DISTINCT b.id), 0), 2) as avg_revenue
    FROM public.booking_revenue_items bri
    JOIN public.bookings b ON b.id = bri.booking_id
    WHERE bri.payment_date BETWEEN $1 AND $2
      AND bri.payment_date IS NOT NULL
      AND b.booking_origin = ''website_public''
      AND b.status NOT IN (''cancelled'', ''declined'')
    GROUP BY b.%I
    ORDER BY total_revenue DESC',
    p_segment_by, p_segment_by
  ) USING p_start_date, p_end_date;
END;
$$;

-- =====================================================
-- 6) FIX get_revenue_line_items_export - origin filter
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_revenue_line_items_export(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  reservation_number text,
  event_date date,
  payment_date date,
  payment_split text,
  event_type text,
  booking_type text,
  booking_origin text,
  guest_name text,
  item_category text,
  item_type text,
  amount decimal,
  quantity integer,
  description text,
  created_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    b.reservation_number,
    b.event_date,
    bri.payment_date,
    bri.payment_split,
    b.event_type,
    b.booking_type::text,
    b.booking_origin::text,
    b.full_name as guest_name,
    bri.item_category,
    bri.item_type,
    bri.amount,
    bri.quantity,
    bri.description,
    bri.created_at
  FROM public.booking_revenue_items bri
  JOIN public.bookings b ON b.id = bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date
    AND bri.payment_date IS NOT NULL
    AND b.booking_origin = 'website_public'
    AND b.status NOT IN ('cancelled', 'declined')
  ORDER BY bri.payment_date, b.reservation_number, bri.item_category;
$$;

-- =====================================================
-- 7) FIX get_daily_generated_revenue - date + origin
-- =====================================================

CREATE OR REPLACE FUNCTION public.get_daily_generated_revenue(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  generated_date date,
  booking_count bigint,
  total_generated decimal,
  baseline_generated decimal,
  cleaning_generated decimal,
  production_generated decimal,
  addon_generated decimal,
  tax_generated decimal,
  discount_generated decimal
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    b.created_at::date AS generated_date,
    COUNT(*) AS booking_count,
    SUM(b.total_amount) AS total_generated,
    SUM(b.base_rental) AS baseline_generated,
    SUM(b.cleaning_fee) AS cleaning_generated,
    SUM(b.package_cost) AS production_generated,
    SUM(b.optional_services) AS addon_generated,
    SUM(b.taxes_fees) AS tax_generated,
    SUM(-1 * COALESCE(b.discount_amount, 0)) AS discount_generated
  FROM public.bookings b
  WHERE b.created_at::date BETWEEN p_start_date AND p_end_date
    AND b.booking_origin = 'website_public'
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY b.created_at::date
  ORDER BY b.created_at::date;
$$;

-- =====================================================
-- 8) CLEAN + RE-BACKFILL ALL REVENUE DATA
-- =====================================================

-- First, delete ALL existing revenue items to start fresh
DELETE FROM public.booking_revenue_items;

-- Re-populate for website_public bookings only
DO $$
DECLARE
  v_booking_id uuid;
  v_count integer := 0;
  v_errors integer := 0;
BEGIN
  RAISE NOTICE 'Starting clean re-backfill of revenue items (website_public only, created_at date)...';
  
  FOR v_booking_id IN 
    SELECT id 
    FROM bookings
    WHERE booking_origin = 'website_public'
      AND payment_status IN ('deposit_paid', 'fully_paid')
      AND status NOT IN ('cancelled', 'declined')
    ORDER BY created_at
  LOOP
    BEGIN
      PERFORM populate_booking_revenue_items(v_booking_id, true);
      v_count := v_count + 1;
    EXCEPTION
      WHEN OTHERS THEN
        v_errors := v_errors + 1;
        RAISE WARNING 'Error processing booking %: %', v_booking_id, SQLERRM;
    END;
  END LOOP;
  
  RAISE NOTICE '=== Re-backfill Complete ===';
  RAISE NOTICE 'Processed: % bookings', v_count;
  RAISE NOTICE 'Errors: %', v_errors;
END $$;
