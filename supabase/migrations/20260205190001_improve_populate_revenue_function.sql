-- =====================================================
-- IMPROVE populate_booking_revenue_items FUNCTION
-- =====================================================
-- Update function to use direct fields (cleaning_type, celebration_surcharge)
-- instead of inferring from amounts
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
      v_booking.booking_type::text,
      v_booking.base_rental,
      CASE 
        WHEN v_booking.booking_type = 'daily' THEN 'Full Day Venue Rental'
        ELSE 'Hourly Venue Rental'
      END,
      p_is_historical
    );
  END IF;
  
  -- 2. CLEANING FEE BREAKDOWN (IMPROVED)
  IF v_booking.cleaning_fee > 0 THEN
    -- Use cleaning_type directly if available (new bookings)
    IF v_booking.cleaning_type IS NOT NULL THEN
      v_cleaning_type := v_booking.cleaning_type;
      
      -- Determine base pay based on type
      v_cleaning_base := CASE v_booking.cleaning_type
        WHEN 'touch_up' THEN 40
        WHEN 'regular' THEN 80
        WHEN 'deep' THEN 150
        ELSE v_booking.cleaning_fee
      END;
      
      -- Celebration surcharge comes directly from field
      v_celebration_surcharge := COALESCE(v_booking.celebration_surcharge, 0);
      
    ELSE
      -- Fallback for historical bookings: infer from amount
      IF v_booking.cleaning_fee <= 40 THEN
        v_cleaning_type := 'touch_up';
        v_cleaning_base := 40;
        v_celebration_surcharge := GREATEST(v_booking.cleaning_fee - 40, 0);
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
      
      -- Ensure non-negative surcharge
      IF v_celebration_surcharge < 0 THEN
        v_celebration_surcharge := 0;
      END IF;
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
  
  -- 4. OPTIONAL SERVICES / ADD-ONS (IMPROVED)
  IF v_booking.optional_services > 0 THEN
    -- Check if we have detailed addon breakdown
    IF v_booking.addons_detail IS NOT NULL AND jsonb_array_length(v_booking.addons_detail) > 0 THEN
      -- Use detailed breakdown from addons_detail
      DECLARE
        addon_item jsonb;
      BEGIN
        FOR addon_item IN SELECT * FROM jsonb_array_elements(v_booking.addons_detail)
        LOOP
          INSERT INTO public.booking_revenue_items (
            booking_id, item_category, item_type, amount, quantity, unit_price, description, is_historical
          )
          VALUES (
            p_booking_id,
            'addon',
            addon_item->>'type',
            (addon_item->>'amount')::decimal,
            COALESCE((addon_item->>'quantity')::integer, 1),
            COALESCE((addon_item->>'unit_price')::decimal, (addon_item->>'amount')::decimal),
            COALESCE(addon_item->>'description', addon_item->>'type'),
            p_is_historical
          );
        END LOOP;
      END;
    ELSE
      -- Fallback for historical/simple bookings
      -- Check for tablecloths specifically
      IF v_booking.tablecloths AND v_booking.tablecloth_quantity > 0 THEN
        INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, quantity, unit_price, description, is_historical)
        VALUES (
          p_booking_id,
          'addon',
          'tablecloth',
          v_booking.tablecloth_quantity * 5.00,
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
        -- No breakdown available, add total as misc
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
  END IF;
  
  -- 5. SETUP/BREAKDOWN FEE (Fixed at $150)
  IF v_booking.setup_breakdown THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, description, is_historical)
    VALUES (
      p_booking_id,
      'addon',
      'setup_breakdown',
      150.00,
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
      -1 * v_booking.discount_amount,
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

-- Update function comment
COMMENT ON FUNCTION public.populate_booking_revenue_items(uuid, boolean) IS 
  'Populates booking_revenue_items from a booking. Uses cleaning_type and celebration_surcharge fields directly when available, falls back to inference for historical bookings. Updated 2026-02-05 to use explicit fields.';

-- Log completion
DO $$
BEGIN
  RAISE NOTICE '[REVENUE-ENHANCE] populate_booking_revenue_items function updated successfully';
  RAISE NOTICE '[REVENUE-ENHANCE] Now uses explicit cleaning_type and celebration_surcharge fields';
END $$;
