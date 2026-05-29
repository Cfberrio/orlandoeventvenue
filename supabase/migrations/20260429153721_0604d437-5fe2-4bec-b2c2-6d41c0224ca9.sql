-- =========================================================
-- PHASE 1: BAR SERVICE - DATABASE ONLY
-- =========================================================

-- ---------- STEP 1: Add bar service columns to bookings ----------
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS bar_package text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS bar_package_label text,
  ADD COLUMN IF NOT EXISTS bar_guest_count integer,
  ADD COLUMN IF NOT EXISTS bar_rate_per_guest numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bar_subtotal numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bar_vendor_id uuid,
  ADD COLUMN IF NOT EXISTS bar_vendor_assignment_id uuid,
  ADD COLUMN IF NOT EXISTS bar_vendor_assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS bar_customer_contacted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bar_customer_contacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS bar_customer_contacted_by uuid,
  ADD COLUMN IF NOT EXISTS bar_client_phone_released boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bar_client_phone_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS bar_internal_notes text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_bar_vendor_id_fkey') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_bar_vendor_id_fkey
      FOREIGN KEY (bar_vendor_id) REFERENCES public.staff_members(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_bar_vendor_assignment_id_fkey') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_bar_vendor_assignment_id_fkey
      FOREIGN KEY (bar_vendor_assignment_id) REFERENCES public.booking_staff_assignments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_bar_customer_contacted_by_fkey') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_bar_customer_contacted_by_fkey
      FOREIGN KEY (bar_customer_contacted_by) REFERENCES public.staff_members(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ---------- STEP 2: Check constraints on bookings ----------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_bar_package_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_bar_package_check
      CHECK (bar_package IN ('none','house_beer_wine','essential_bar','signature_bar','bespoke_bar'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_bar_guest_count_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_bar_guest_count_check
      CHECK (bar_guest_count IS NULL OR bar_guest_count >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_bar_rate_per_guest_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_bar_rate_per_guest_check
      CHECK (bar_rate_per_guest >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_bar_subtotal_check') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_bar_subtotal_check
      CHECK (bar_subtotal >= 0);
  END IF;
END $$;

-- ---------- STEP 3: Helper functions ----------
CREATE OR REPLACE FUNCTION public.get_bar_package_rate(p_package text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_package
    WHEN 'house_beer_wine' THEN 18.00
    WHEN 'essential_bar'   THEN 25.63
    WHEN 'signature_bar'   THEN 32.13
    WHEN 'bespoke_bar'     THEN 39.63
    ELSE 0.00
  END::numeric;
$$;

CREATE OR REPLACE FUNCTION public.get_bar_package_label(p_package text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE p_package
    WHEN 'house_beer_wine' THEN 'House Beer & Wine'
    WHEN 'essential_bar'   THEN 'Essential Bar'
    WHEN 'signature_bar'   THEN 'Signature Bar'
    WHEN 'bespoke_bar'     THEN 'Bespoke Bar'
    ELSE NULL
  END;
$$;

-- ---------- STEP 4: Sync trigger ----------
CREATE OR REPLACE FUNCTION public.sync_booking_bar_service_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.bar_package IS NULL THEN
    NEW.bar_package := 'none';
  END IF;

  IF NEW.bar_package = 'none' THEN
    NEW.bar_package_label             := NULL;
    NEW.bar_guest_count               := NULL;
    NEW.bar_rate_per_guest            := 0;
    NEW.bar_subtotal                  := 0;
    NEW.bar_vendor_id                 := NULL;
    NEW.bar_vendor_assignment_id      := NULL;
    NEW.bar_vendor_assigned_at        := NULL;
    NEW.bar_customer_contacted        := false;
    NEW.bar_customer_contacted_at     := NULL;
    NEW.bar_customer_contacted_by     := NULL;
    NEW.bar_client_phone_released     := false;
    NEW.bar_client_phone_released_at  := NULL;
  ELSE
    NEW.bar_package_label  := public.get_bar_package_label(NEW.bar_package);
    NEW.bar_rate_per_guest := public.get_bar_package_rate(NEW.bar_package);
    IF NEW.bar_guest_count IS NULL THEN
      NEW.bar_guest_count := NEW.number_of_guests;
    END IF;
    NEW.bar_subtotal := ROUND(COALESCE(NEW.bar_guest_count, 0) * NEW.bar_rate_per_guest, 2);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_booking_bar_service_fields ON public.bookings;
CREATE TRIGGER trg_sync_booking_bar_service_fields
BEFORE INSERT OR UPDATE OF bar_package, bar_guest_count, number_of_guests
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.sync_booking_bar_service_fields();

-- ---------- STEP 5: Extend venue_pricing constraints + seed bar packages ----------
ALTER TABLE public.venue_pricing
  DROP CONSTRAINT IF EXISTS venue_pricing_category_check;
ALTER TABLE public.venue_pricing
  ADD CONSTRAINT venue_pricing_category_check
  CHECK (category = ANY (ARRAY['rental','package','service','fee','bar_service']));

ALTER TABLE public.venue_pricing
  DROP CONSTRAINT IF EXISTS venue_pricing_price_unit_check;
ALTER TABLE public.venue_pricing
  ADD CONSTRAINT venue_pricing_price_unit_check
  CHECK (price_unit = ANY (ARRAY['per_hour','per_unit','flat','percentage','per_guest']));

INSERT INTO public.venue_pricing (category, item_key, label, description, price, price_unit, sort_order, is_active)
VALUES
  ('bar_service','house_beer_wine','House Beer & Wine','House beer and wine bar package.',18.00,'per_guest',10,true),
  ('bar_service','essential_bar','Essential Bar','Essential bar service package.',25.63,'per_guest',20,true),
  ('bar_service','signature_bar','Signature Bar','Signature bar service package. Most Popular.',32.13,'per_guest',30,true),
  ('bar_service','bespoke_bar','Bespoke Bar','Bespoke bar service package.',39.63,'per_guest',40,true)
ON CONFLICT (item_key) DO UPDATE SET
  category    = EXCLUDED.category,
  label       = EXCLUDED.label,
  description = EXCLUDED.description,
  price       = EXCLUDED.price,
  price_unit  = EXCLUDED.price_unit,
  sort_order  = EXCLUDED.sort_order,
  is_active   = EXCLUDED.is_active,
  updated_at  = now();

-- ---------- STEP 7: booking_staff_assignments extensions ----------
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS customer_contact_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_contacted boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_contacted_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_contacted_by uuid,
  ADD COLUMN IF NOT EXISTS customer_contact_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS customer_phone_released boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS customer_phone_released_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'booking_staff_assignments_customer_contacted_by_fkey') THEN
    ALTER TABLE public.booking_staff_assignments
      ADD CONSTRAINT booking_staff_assignments_customer_contacted_by_fkey
      FOREIGN KEY (customer_contacted_by) REFERENCES public.staff_members(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE public.booking_staff_assignments
  DROP CONSTRAINT IF EXISTS booking_staff_assignments_assignment_type_check;
ALTER TABLE public.booking_staff_assignments
  ADD CONSTRAINT booking_staff_assignments_assignment_type_check
  CHECK (assignment_type = ANY (ARRAY['cleaning','production','setup','support','other','bar_service']));

-- ---------- STEP 8: Pre-Event Ready gate ----------
CREATE OR REPLACE FUNCTION public.enforce_bar_pre_event_ready_gate()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_moving_to_pre_event boolean := false;
BEGIN
  IF NEW.lifecycle_status = 'pre_event_ready' AND COALESCE(OLD.lifecycle_status,'') <> 'pre_event_ready' THEN
    v_moving_to_pre_event := true;
  END IF;
  IF NEW.pre_event_ready = 'true' AND COALESCE(OLD.pre_event_ready,'false') <> 'true' THEN
    v_moving_to_pre_event := true;
  END IF;

  IF v_moving_to_pre_event AND NEW.bar_package IS NOT NULL AND NEW.bar_package <> 'none' THEN
    IF NEW.bar_vendor_id IS NULL OR NEW.bar_customer_contacted IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot move to Pre-Event Ready. Bar service is selected but vendor contact is not confirmed. Assign a bar vendor and wait for client contact confirmation.'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bar_pre_event_ready_gate ON public.bookings;
CREATE TRIGGER trg_enforce_bar_pre_event_ready_gate
BEFORE UPDATE OF lifecycle_status, pre_event_ready, bar_package, bar_vendor_id, bar_customer_contacted
ON public.bookings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_bar_pre_event_ready_gate();

-- ---------- STEP 9: booking_revenue_items category extension ----------
ALTER TABLE public.booking_revenue_items
  DROP CONSTRAINT IF EXISTS booking_revenue_items_item_category_check;
ALTER TABLE public.booking_revenue_items
  ADD CONSTRAINT booking_revenue_items_item_category_check
  CHECK (item_category = ANY (ARRAY[
    'baseline','cleaning_base','cleaning_surcharge','production',
    'addon','fee','discount','tax','bar_service'
  ]));

-- ---------- STEP 11: Indexes ----------
CREATE INDEX IF NOT EXISTS idx_bookings_bar_package
  ON public.bookings(bar_package);
CREATE INDEX IF NOT EXISTS idx_bookings_bar_vendor_id
  ON public.bookings(bar_vendor_id);
CREATE INDEX IF NOT EXISTS idx_bookings_bar_customer_contacted
  ON public.bookings(bar_customer_contacted);
CREATE INDEX IF NOT EXISTS idx_bookings_bar_vendor_assignment_id
  ON public.bookings(bar_vendor_assignment_id);
CREATE INDEX IF NOT EXISTS idx_bsa_bar_vendor_partial
  ON public.booking_staff_assignments(staff_id, booking_id)
  WHERE assignment_role = 'Bar Vendor' AND assignment_type = 'bar_service';

-- ---------- STEP 12: Debug view ----------
DROP VIEW IF EXISTS public.v_bar_service_bookings;
CREATE VIEW public.v_bar_service_bookings
WITH (security_invoker = true)
AS
SELECT
  b.id                              AS booking_id,
  b.reservation_number,
  b.event_date,
  b.start_time,
  b.end_time,
  b.full_name,
  b.email,
  b.phone,
  b.number_of_guests,
  b.bar_package,
  b.bar_package_label,
  b.bar_guest_count,
  b.bar_rate_per_guest,
  b.bar_subtotal,
  b.bar_vendor_id,
  sm.full_name                      AS bar_vendor_name,
  sm.email                          AS bar_vendor_email,
  b.bar_customer_contacted,
  b.bar_customer_contacted_at,
  b.bar_client_phone_released,
  b.lifecycle_status,
  b.pre_event_ready
FROM public.bookings b
LEFT JOIN public.staff_members sm ON sm.id = b.bar_vendor_id
WHERE b.bar_package IS NOT NULL AND b.bar_package <> 'none';