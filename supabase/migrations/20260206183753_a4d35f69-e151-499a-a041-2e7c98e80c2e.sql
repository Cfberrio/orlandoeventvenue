
-- STEP 1: ADD COLUMNS
ALTER TABLE public.booking_revenue_items ADD COLUMN IF NOT EXISTS payment_date DATE;
ALTER TABLE public.booking_revenue_items ADD COLUMN IF NOT EXISTS payment_split TEXT CHECK (payment_split IN ('deposit', 'balance', 'full'));
CREATE INDEX IF NOT EXISTS idx_revenue_items_payment_date ON public.booking_revenue_items(payment_date);
CREATE INDEX IF NOT EXISTS idx_revenue_items_payment_split ON public.booking_revenue_items(payment_split);

-- STEP 2: DROP function with changed return type
DROP FUNCTION IF EXISTS public.get_revenue_line_items_export(date, date);

-- STEP 3: populate_booking_revenue_items
CREATE OR REPLACE FUNCTION public.populate_booking_revenue_items(p_booking_id uuid, p_is_historical boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_booking RECORD; v_deposit_date DATE; v_balance_date DATE;
  v_cleaning_type text; v_cleaning_base decimal(10,2); v_celebration_surcharge decimal(10,2);
BEGIN
  SELECT *, deposit_paid_at::date as deposit_date, balance_paid_at::date as balance_date INTO v_booking FROM public.bookings WHERE id = p_booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found: %', p_booking_id; END IF;
  IF v_booking.booking_origin = 'internal' THEN RETURN; END IF;
  DELETE FROM public.booking_revenue_items WHERE booking_id = p_booking_id;
  v_deposit_date := v_booking.deposit_date; v_balance_date := v_booking.balance_date;
  IF v_deposit_date IS NULL THEN RETURN; END IF;

  -- BASELINE
  IF v_booking.base_rental > 0 THEN
    INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
    VALUES (p_booking_id, 'baseline', v_booking.booking_type::text, ROUND(v_booking.base_rental*0.5,2), v_deposit_date, 'deposit', CASE WHEN v_booking.booking_type='daily' THEN 'Full Day Venue Rental (Deposit 50%)' ELSE 'Hourly Venue Rental (Deposit 50%)' END, p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id, item_category, item_type, amount, payment_date, payment_split, description, is_historical)
      VALUES (p_booking_id, 'baseline', v_booking.booking_type::text, ROUND(v_booking.base_rental*0.5,2), v_balance_date, 'balance', CASE WHEN v_booking.booking_type='daily' THEN 'Full Day Venue Rental (Balance 50%)' ELSE 'Hourly Venue Rental (Balance 50%)' END, p_is_historical);
    END IF;
  END IF;

  -- CLEANING
  IF v_booking.cleaning_fee > 0 THEN
    IF v_booking.cleaning_fee<=40 THEN v_cleaning_type:='touch_up'; v_cleaning_base:=40; v_celebration_surcharge:=v_booking.cleaning_fee-40;
    ELSIF v_booking.cleaning_fee<=80 THEN v_cleaning_type:='regular'; v_cleaning_base:=80; v_celebration_surcharge:=0;
    ELSIF v_booking.cleaning_fee=150 THEN v_cleaning_type:='deep'; v_cleaning_base:=150; v_celebration_surcharge:=0;
    ELSIF v_booking.cleaning_fee<150 THEN v_cleaning_type:='regular'; v_cleaning_base:=80; v_celebration_surcharge:=v_booking.cleaning_fee-80;
    ELSE v_cleaning_type:='deep'; v_cleaning_base:=150; v_celebration_surcharge:=v_booking.cleaning_fee-150;
    END IF;
    IF v_celebration_surcharge<0 THEN v_celebration_surcharge:=0; END IF;
    INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
    VALUES (p_booking_id,'cleaning_base',v_cleaning_type,ROUND(v_cleaning_base*0.5,2),v_deposit_date,'deposit',CASE v_cleaning_type WHEN 'touch_up' THEN 'Touch-Up Cleaning (Deposit 50%)' WHEN 'regular' THEN 'Regular Cleaning (Deposit 50%)' WHEN 'deep' THEN 'Deep Cleaning (Deposit 50%)' ELSE 'Cleaning (Deposit 50%)' END,p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
      VALUES (p_booking_id,'cleaning_base',v_cleaning_type,ROUND(v_cleaning_base*0.5,2),v_balance_date,'balance',CASE v_cleaning_type WHEN 'touch_up' THEN 'Touch-Up Cleaning (Balance 50%)' WHEN 'regular' THEN 'Regular Cleaning (Balance 50%)' WHEN 'deep' THEN 'Deep Cleaning (Balance 50%)' ELSE 'Cleaning (Balance 50%)' END,p_is_historical);
    END IF;
    IF v_celebration_surcharge>0 THEN
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical,metadata)
      VALUES (p_booking_id,'cleaning_surcharge','celebration',ROUND(v_celebration_surcharge*0.5,2),v_deposit_date,'deposit','Celebration Surcharge (Deposit 50%)',p_is_historical,jsonb_build_object('guest_count',v_booking.number_of_guests));
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical,metadata)
        VALUES (p_booking_id,'cleaning_surcharge','celebration',ROUND(v_celebration_surcharge*0.5,2),v_balance_date,'balance','Celebration Surcharge (Balance 50%)',p_is_historical,jsonb_build_object('guest_count',v_booking.number_of_guests));
      END IF;
    END IF;
  END IF;

  -- PRODUCTION
  IF v_booking.package_cost>0 AND v_booking.package!='none' THEN
    INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
    VALUES (p_booking_id,'production',v_booking.package::text,ROUND(v_booking.package_cost*0.5,2),v_deposit_date,'deposit',CASE v_booking.package WHEN 'basic' THEN 'Basic Production (Deposit 50%)' WHEN 'led' THEN 'LED Production (Deposit 50%)' WHEN 'workshop' THEN 'Workshop Production (Deposit 50%)' ELSE 'Production (Deposit 50%)' END,p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
      VALUES (p_booking_id,'production',v_booking.package::text,ROUND(v_booking.package_cost*0.5,2),v_balance_date,'balance',CASE v_booking.package WHEN 'basic' THEN 'Basic Production (Balance 50%)' WHEN 'led' THEN 'LED Production (Balance 50%)' WHEN 'workshop' THEN 'Workshop Production (Balance 50%)' ELSE 'Production (Balance 50%)' END,p_is_historical);
    END IF;
  END IF;

  -- ADDONS
  IF v_booking.optional_services>0 THEN
    IF v_booking.tablecloths AND v_booking.tablecloth_quantity>0 THEN
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,quantity,unit_price,payment_date,payment_split,description,is_historical)
      VALUES (p_booking_id,'addon','tablecloth',ROUND((v_booking.tablecloth_quantity*5.00)*0.5,2),v_booking.tablecloth_quantity,5.00,v_deposit_date,'deposit','Tablecloth Rental (Deposit 50%)',p_is_historical);
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,quantity,unit_price,payment_date,payment_split,description,is_historical)
        VALUES (p_booking_id,'addon','tablecloth',ROUND((v_booking.tablecloth_quantity*5.00)*0.5,2),v_booking.tablecloth_quantity,5.00,v_balance_date,'balance','Tablecloth Rental (Balance 50%)',p_is_historical);
      END IF;
      IF v_booking.optional_services>(v_booking.tablecloth_quantity*5.00) THEN
        INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
        VALUES (p_booking_id,'addon','misc',ROUND((v_booking.optional_services-(v_booking.tablecloth_quantity*5.00))*0.5,2),v_deposit_date,'deposit','Additional Add-ons (Deposit 50%)',p_is_historical);
        IF v_balance_date IS NOT NULL THEN
          INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
          VALUES (p_booking_id,'addon','misc',ROUND((v_booking.optional_services-(v_booking.tablecloth_quantity*5.00))*0.5,2),v_balance_date,'balance','Additional Add-ons (Balance 50%)',p_is_historical);
        END IF;
      END IF;
    ELSE
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
      VALUES (p_booking_id,'addon','misc',ROUND(v_booking.optional_services*0.5,2),v_deposit_date,'deposit','Optional Services (Deposit 50%)',p_is_historical);
      IF v_balance_date IS NOT NULL THEN
        INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
        VALUES (p_booking_id,'addon','misc',ROUND(v_booking.optional_services*0.5,2),v_balance_date,'balance','Optional Services (Balance 50%)',p_is_historical);
      END IF;
    END IF;
  END IF;

  -- SETUP
  IF v_booking.setup_breakdown THEN
    INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
    VALUES (p_booking_id,'addon','setup_breakdown',75.00,v_deposit_date,'deposit','Setup & Breakdown (Deposit 50%)',p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
      VALUES (p_booking_id,'addon','setup_breakdown',75.00,v_balance_date,'balance','Setup & Breakdown (Balance 50%)',p_is_historical);
    END IF;
  END IF;

  -- DISCOUNT
  IF COALESCE(v_booking.discount_amount,0)>0 THEN
    INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical,metadata)
    VALUES (p_booking_id,'discount',COALESCE(v_booking.discount_code,'manual'),ROUND(-1*v_booking.discount_amount*0.5,2),v_deposit_date,'deposit',CASE WHEN v_booking.discount_code IS NOT NULL THEN 'Discount: '||v_booking.discount_code||' (Deposit 50%)' ELSE 'Discount (Deposit 50%)' END,p_is_historical,jsonb_build_object('code',v_booking.discount_code));
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical,metadata)
      VALUES (p_booking_id,'discount',COALESCE(v_booking.discount_code,'manual'),ROUND(-1*v_booking.discount_amount*0.5,2),v_balance_date,'balance',CASE WHEN v_booking.discount_code IS NOT NULL THEN 'Discount: '||v_booking.discount_code||' (Balance 50%)' ELSE 'Discount (Balance 50%)' END,p_is_historical,jsonb_build_object('code',v_booking.discount_code));
    END IF;
  END IF;

  -- TAXES
  IF v_booking.taxes_fees>0 THEN
    INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
    VALUES (p_booking_id,'tax','taxes_fees',ROUND(v_booking.taxes_fees*0.5,2),v_deposit_date,'deposit','Taxes & Fees (Deposit 50%)',p_is_historical);
    IF v_balance_date IS NOT NULL THEN
      INSERT INTO public.booking_revenue_items (booking_id,item_category,item_type,amount,payment_date,payment_split,description,is_historical)
      VALUES (p_booking_id,'tax','taxes_fees',ROUND(v_booking.taxes_fees*0.5,2),v_balance_date,'balance','Taxes & Fees (Balance 50%)',p_is_historical);
    END IF;
  END IF;
END;
$$;

-- STEP 4: get_daily_revenue
CREATE OR REPLACE FUNCTION public.get_daily_revenue(p_start_date date, p_end_date date)
RETURNS TABLE(revenue_date date, total_revenue decimal, booking_count bigint, baseline_revenue decimal, cleaning_revenue decimal, production_revenue decimal, addon_revenue decimal, fee_revenue decimal, discount_amount decimal, tax_amount decimal)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bri.payment_date, SUM(bri.amount), COUNT(DISTINCT b.id),
    SUM(CASE WHEN bri.item_category='baseline' THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category IN ('cleaning_base','cleaning_surcharge') THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category='production' THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category='addon' THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category='fee' THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category='discount' THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category='tax' THEN bri.amount ELSE 0 END)
  FROM public.booking_revenue_items bri JOIN public.bookings b ON b.id=bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date AND bri.payment_date IS NOT NULL
    AND b.booking_origin!='internal' AND b.status NOT IN ('cancelled','declined')
  GROUP BY bri.payment_date ORDER BY 1;
$$;

-- STEP 5: get_monthly_revenue (fixed ORDER BY)
CREATE OR REPLACE FUNCTION public.get_monthly_revenue(p_start_date date, p_end_date date)
RETURNS TABLE(revenue_month text, year_month date, total_revenue decimal, booking_count bigint, baseline_revenue decimal, cleaning_revenue decimal, production_revenue decimal, addon_revenue decimal)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT TO_CHAR(bri.payment_date,'YYYY-MM'), DATE_TRUNC('month',bri.payment_date)::date,
    SUM(bri.amount), COUNT(DISTINCT b.id),
    SUM(CASE WHEN bri.item_category='baseline' THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category IN ('cleaning_base','cleaning_surcharge') THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category='production' THEN bri.amount ELSE 0 END),
    SUM(CASE WHEN bri.item_category='addon' THEN bri.amount ELSE 0 END)
  FROM public.booking_revenue_items bri JOIN public.bookings b ON b.id=bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date AND bri.payment_date IS NOT NULL
    AND b.booking_origin!='internal' AND b.status NOT IN ('cancelled','declined')
  GROUP BY 1, 2 ORDER BY 2;
$$;

-- STEP 6: get_revenue_by_category
CREATE OR REPLACE FUNCTION public.get_revenue_by_category(p_start_date date, p_end_date date)
RETURNS TABLE(category text, item_type text, total_amount decimal, item_count bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT bri.item_category, bri.item_type, SUM(bri.amount), COUNT(*)
  FROM public.booking_revenue_items bri JOIN public.bookings b ON b.id=bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date AND bri.payment_date IS NOT NULL
    AND b.booking_origin!='internal' AND b.status NOT IN ('cancelled','declined')
  GROUP BY 1,2 ORDER BY 1, SUM(bri.amount) DESC;
$$;

-- STEP 7: get_revenue_by_segment
CREATE OR REPLACE FUNCTION public.get_revenue_by_segment(p_start_date date, p_end_date date, p_segment_by text DEFAULT 'booking_origin')
RETURNS TABLE(segment text, total_revenue decimal, booking_count bigint, avg_revenue decimal)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY EXECUTE format(
    'SELECT b.%I::text, SUM(bri.amount), COUNT(DISTINCT b.id), ROUND(SUM(bri.amount)/NULLIF(COUNT(DISTINCT b.id),0),2)
    FROM public.booking_revenue_items bri JOIN public.bookings b ON b.id=bri.booking_id
    WHERE bri.payment_date BETWEEN $1 AND $2 AND bri.payment_date IS NOT NULL
      AND b.booking_origin!=''internal'' AND b.status NOT IN (''cancelled'',''declined'')
    GROUP BY b.%I ORDER BY SUM(bri.amount) DESC', p_segment_by, p_segment_by
  ) USING p_start_date, p_end_date;
END;
$$;

-- STEP 8: get_revenue_line_items_export (new return type)
CREATE FUNCTION public.get_revenue_line_items_export(p_start_date date, p_end_date date)
RETURNS TABLE(reservation_number text, event_date date, payment_date date, payment_split text, event_type text, booking_type text, booking_origin text, guest_name text, item_category text, item_type text, amount decimal, quantity integer, description text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.reservation_number, b.event_date, bri.payment_date, bri.payment_split,
    b.event_type, b.booking_type::text, b.booking_origin::text, b.full_name,
    bri.item_category, bri.item_type, bri.amount, bri.quantity, bri.description, bri.created_at
  FROM public.booking_revenue_items bri JOIN public.bookings b ON b.id=bri.booking_id
  WHERE bri.payment_date BETWEEN p_start_date AND p_end_date AND bri.payment_date IS NOT NULL
    AND b.booking_origin!='internal' AND b.status NOT IN ('cancelled','declined')
  ORDER BY bri.payment_date, b.reservation_number, bri.item_category;
$$;

-- STEP 9: BACKFILL
DO $$
DECLARE v_id uuid; v_count integer:=0; v_errors integer:=0;
BEGIN
  FOR v_id IN SELECT id FROM bookings WHERE booking_origin IN ('website','external') AND payment_status IN ('deposit_paid','fully_paid') AND deposit_paid_at IS NOT NULL AND status NOT IN ('cancelled','declined') ORDER BY event_date
  LOOP
    BEGIN PERFORM populate_booking_revenue_items(v_id, true); v_count:=v_count+1;
    EXCEPTION WHEN OTHERS THEN v_errors:=v_errors+1; END;
  END LOOP;
  RAISE NOTICE 'Backfill: % ok, % errors', v_count, v_errors;
END $$;
