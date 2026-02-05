-- =====================================================
-- BOOKING REVENUE ITEMS - Line Item Ledger for Revenue Reports
-- =====================================================

-- Create the main revenue line items table
CREATE TABLE public.booking_revenue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  
  -- Categorization
  item_category text NOT NULL CHECK (item_category IN (
    'baseline',           -- Base venue rental
    'cleaning_base',      -- Base cleaning fee
    'cleaning_surcharge', -- Celebration/guest count surcharge
    'production',         -- Production packages (basic, led, workshop)
    'addon',              -- Optional add-ons (tablecloths, etc.)
    'fee',                -- Additional fees (overtime, damage, etc.)
    'discount',           -- Discounts (negative amounts)
    'tax'                 -- Taxes and fees
  )),
  
  item_type text, -- Specific type within category (e.g., 'touch_up', 'regular', 'deep', 'overtime', 'damage')
  
  -- Financial
  amount decimal(10,2) NOT NULL,
  quantity integer DEFAULT 1,
  unit_price decimal(10,2), -- Optional: for items with quantity
  
  -- Description
  description text,
  
  -- Flexible metadata for item-specific data
  metadata jsonb DEFAULT '{}'::jsonb,
  
  -- Audit fields
  is_historical boolean DEFAULT false, -- True if created from backfill
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX idx_revenue_items_booking ON public.booking_revenue_items(booking_id);
CREATE INDEX idx_revenue_items_category ON public.booking_revenue_items(item_category);
CREATE INDEX idx_revenue_items_type ON public.booking_revenue_items(item_type);
CREATE INDEX idx_revenue_items_created ON public.booking_revenue_items(created_at);

-- Enable RLS
ALTER TABLE public.booking_revenue_items ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admin and staff can view revenue items"
ON public.booking_revenue_items
FOR SELECT
USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can manage revenue items"
ON public.booking_revenue_items
FOR ALL
USING (has_role(auth.uid(), 'admin'));

-- Trigger for updated_at
CREATE TRIGGER update_revenue_items_updated_at
  BEFORE UPDATE ON public.booking_revenue_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- FUNCTION: Populate revenue items from a booking
-- =====================================================
CREATE OR REPLACE FUNCTION public.populate_booking_revenue_items(p_booking_id uuid, p_is_historical boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking RECORD;
  v_cleaning_type text;
  v_cleaning_base decimal(10,2);
  v_celebration_surcharge decimal(10,2);
BEGIN
  -- Get booking data
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found: %', p_booking_id;
  END IF;
  
  -- Delete existing revenue items for this booking (to allow re-generation)
  DELETE FROM public.booking_revenue_items WHERE booking_id = p_booking_id;
  
  -- 1. BASELINE RENTAL
  IF v_booking.base_rental > 0 THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
    VALUES (
      p_booking_id,
      'baseline',
      v_booking.booking_type::text, -- 'daily' or 'hourly'
      v_booking.base_rental,
      CASE 
        WHEN v_booking.booking_type = 'daily' THEN 'Full Day Venue Rental'
        ELSE 'Hourly Venue Rental'
      END,
      p_is_historical
    );
  END IF;
  
  -- 2. CLEANING FEE BREAKDOWN
  -- Determine cleaning type based on fee amount (best effort for historical)
  IF v_booking.cleaning_fee > 0 THEN
    -- Standard cleaning prices: Touch-up $40, Regular $80, Deep $150
    -- Celebration surcharges: $20-$70 based on guest count
    
    IF v_booking.cleaning_fee <= 40 THEN
      v_cleaning_type := 'touch_up';
      v_cleaning_base := 40;
      v_celebration_surcharge := v_booking.cleaning_fee - 40;
    ELSIF v_booking.cleaning_fee <= 80 THEN
      v_cleaning_type := 'regular';
      v_cleaning_base := 80;
      v_celebration_surcharge := 0;
    ELSIF v_booking.cleaning_fee <= 150 THEN
      -- Could be regular with surcharge or deep cleaning
      IF v_booking.cleaning_fee = 150 THEN
        v_cleaning_type := 'deep';
        v_cleaning_base := 150;
        v_celebration_surcharge := 0;
      ELSE
        -- Regular cleaning with celebration surcharge
        v_cleaning_type := 'regular';
        v_cleaning_base := 80;
        v_celebration_surcharge := v_booking.cleaning_fee - 80;
      END IF;
    ELSE
      -- Deep cleaning with celebration surcharge
      v_cleaning_type := 'deep';
      v_cleaning_base := 150;
      v_celebration_surcharge := v_booking.cleaning_fee - 150;
    END IF;
    
    -- Ensure non-negative surcharge
    IF v_celebration_surcharge < 0 THEN
      v_celebration_surcharge := 0;
    END IF;
    
    -- Insert base cleaning
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
    VALUES (
      p_booking_id,
      'cleaning_base',
      v_cleaning_type,
      v_cleaning_base,
      CASE v_cleaning_type
        WHEN 'touch_up' THEN 'Touch-Up Cleaning'
        WHEN 'regular' THEN 'Regular Cleaning'
        WHEN 'deep' THEN 'Deep Cleaning'
        ELSE 'Cleaning Service'
      END,
      p_is_historical
    );
    
    -- Insert celebration surcharge if applicable
    IF v_celebration_surcharge > 0 THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical, metadata)
      VALUES (
        p_booking_id,
        'cleaning_surcharge',
        'celebration',
        v_celebration_surcharge,
        'Celebration Surcharge',
        p_is_historical,
        jsonb_build_object('guest_count', v_booking.number_of_guests)
      );
    END IF;
  END IF;
  
  -- 3. PRODUCTION PACKAGE
  IF v_booking.package_cost > 0 AND v_booking.package != 'none' THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
    VALUES (
      p_booking_id,
      'production',
      v_booking.package::text,
      v_booking.package_cost,
      CASE v_booking.package
        WHEN 'basic' THEN 'Basic Production Package'
        WHEN 'led' THEN 'LED Production Package'
        WHEN 'workshop' THEN 'Workshop Production Package'
        ELSE 'Production Package'
      END,
      p_is_historical
    );
  END IF;
  
  -- 4. OPTIONAL SERVICES / ADD-ONS
  -- For historical, we only have the total - future bookings should have detailed breakdown
  IF v_booking.optional_services > 0 THEN
    -- Check for tablecloths specifically
    IF v_booking.tablecloths AND v_booking.tablecloth_quantity > 0 THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, quantity, unit_price, description, is_historical)
      VALUES (
        p_booking_id,
        'addon',
        'tablecloth',
        v_booking.tablecloth_quantity * 5.00, -- Assuming $5 per tablecloth
        v_booking.tablecloth_quantity,
        5.00,
        'Tablecloth Rental',
        p_is_historical
      );
      
      -- If there's remaining optional_services amount, add as misc
      IF v_booking.optional_services > (v_booking.tablecloth_quantity * 5.00) THEN
        INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
        VALUES (
          p_booking_id,
          'addon',
          'misc',
          v_booking.optional_services - (v_booking.tablecloth_quantity * 5.00),
          'Additional Add-ons',
          p_is_historical
        );
      END IF;
    ELSE
      -- No tablecloth breakdown, add total as misc
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
      VALUES (
        p_booking_id,
        'addon',
        'misc',
        v_booking.optional_services,
        'Optional Services',
        p_is_historical
      );
    END IF;
  END IF;
  
  -- 5. SETUP/BREAKDOWN FEE
  IF v_booking.setup_breakdown THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
    VALUES (
      p_booking_id,
      'addon',
      'setup_breakdown',
      150.00, -- Standard setup/breakdown fee
      'Setup & Breakdown Service',
      p_is_historical
    );
  END IF;
  
  -- 6. DISCOUNT
  IF COALESCE(v_booking.discount_amount, 0) > 0 THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical, metadata)
    VALUES (
      p_booking_id,
      'discount',
      COALESCE(v_booking.discount_code, 'manual'),
      -1 * v_booking.discount_amount, -- Negative for discount
      CASE 
        WHEN v_booking.discount_code IS NOT NULL THEN 'Discount: ' || v_booking.discount_code
        ELSE 'Discount Applied'
      END,
      p_is_historical,
      jsonb_build_object('code', v_booking.discount_code)
    );
  END IF;
  
  -- 7. TAXES AND FEES
  IF v_booking.taxes_fees > 0 THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
    VALUES (
      p_booking_id,
      'tax',
      'taxes_fees',
      v_booking.taxes_fees,
      'Taxes & Fees',
      p_is_historical
    );
  END IF;
  
END;
$$;

-- =====================================================
-- HELPER FUNCTIONS FOR REVENUE REPORTS
-- =====================================================

-- Get revenue breakdown by category for a date range
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
  WHERE b.event_date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY bri.item_category, bri.item_type
  ORDER BY bri.item_category, total_amount DESC;
$$;

-- Get revenue by booking segment (origin, type, event_type)
CREATE OR REPLACE FUNCTION public.get_revenue_by_segment(
  p_start_date date,
  p_end_date date,
  p_segment_by text DEFAULT 'booking_origin' -- 'booking_origin', 'event_type', 'booking_type', 'package'
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
      ROUND(SUM(bri.amount) / COUNT(DISTINCT b.id), 2) as avg_revenue
    FROM public.booking_revenue_items bri
    JOIN public.bookings b ON b.id = bri.booking_id
    WHERE b.event_date BETWEEN $1 AND $2
      AND b.status NOT IN (''cancelled'', ''declined'')
    GROUP BY b.%I
    ORDER BY total_revenue DESC',
    p_segment_by, p_segment_by
  ) USING p_start_date, p_end_date;
END;
$$;

-- Get daily revenue summary
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
    b.event_date as revenue_date,
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
  WHERE b.event_date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY b.event_date
  ORDER BY b.event_date;
$$;

-- Get monthly revenue summary
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
    TO_CHAR(b.event_date, 'YYYY-MM') as revenue_month,
    DATE_TRUNC('month', b.event_date)::date as year_month,
    SUM(bri.amount) as total_revenue,
    COUNT(DISTINCT b.id) as booking_count,
    SUM(CASE WHEN bri.item_category = 'baseline' THEN bri.amount ELSE 0 END) as baseline_revenue,
    SUM(CASE WHEN bri.item_category IN ('cleaning_base', 'cleaning_surcharge') THEN bri.amount ELSE 0 END) as cleaning_revenue,
    SUM(CASE WHEN bri.item_category = 'production' THEN bri.amount ELSE 0 END) as production_revenue,
    SUM(CASE WHEN bri.item_category = 'addon' THEN bri.amount ELSE 0 END) as addon_revenue
  FROM public.booking_revenue_items bri
  JOIN public.bookings b ON b.id = bri.booking_id
  WHERE b.event_date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('cancelled', 'declined')
  GROUP BY TO_CHAR(b.event_date, 'YYYY-MM'), DATE_TRUNC('month', b.event_date)
  ORDER BY year_month;
$$;

-- Get detailed line items for export
CREATE OR REPLACE FUNCTION public.get_revenue_line_items_export(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE(
  reservation_number text,
  event_date date,
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
  WHERE b.event_date BETWEEN p_start_date AND p_end_date
    AND b.status NOT IN ('cancelled', 'declined')
  ORDER BY b.event_date, b.reservation_number, bri.item_category;
$$;