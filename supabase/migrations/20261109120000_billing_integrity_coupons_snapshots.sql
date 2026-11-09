-- Billing integrity, part 1 (ClickUp 86e3zfnm0).
--
-- Backward compatible with the frontend and edge functions currently live:
-- the anon "read active coupons" policy stays until the new booking page
-- (which validates codes through validate_discount_code) is published; part 2
-- removes it.
--
-- 1. discount_coupons: row-level security ON (it was disabled by
--    20260117174909, leaving the table writable by the public anon key),
--    percent capped at 100, who-changed-what audit trail, and coupons that were
--    used on a booking can no longer be hard-deleted (archive instead).
-- 2. validate_discount_code(): the only way the public booking page reads a
--    coupon from now on — one code at a time, active only.
-- 3. booking_price_snapshots: append-only record of the exact price, discount
--    terms and fees a booking was charged under. Invoices, PDFs and balance
--    links read it, so a booking stays explainable after a code is edited.
-- 4. bookings.balance_session_id: lets the balance-link function expire the
--    previous Stripe session so two payable balance links never coexist.
-- 5. get_bar_package_rate() reads venue_pricing (same source as the booking
--    page) instead of hardcoded rates, so the stored bar subtotal can never
--    drift from what the guest was shown.
-- 6. Legacy codes that were hardcoded in the booking page (CHRIS, NANO, 199)
--    become visible, switchable rows. Same savings as before.
-- 7. Snapshot backfill for every upcoming booking, then MILITARYSERVICE is
--    corrected to the intended $100 off. OEV-JZHY9Z keeps its snapshot of the
--    100% terms it was actually charged under; its amounts are not touched.

-- ---------------------------------------------------------------------------
-- 1. discount_coupons hardening
-- ---------------------------------------------------------------------------

ALTER TABLE public.discount_coupons
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS updated_by uuid;

ALTER TABLE public.discount_coupons
  DROP CONSTRAINT IF EXISTS discount_coupons_percentage_max;
ALTER TABLE public.discount_coupons
  ADD CONSTRAINT discount_coupons_percentage_max
  CHECK (discount_type <> 'percentage' OR discount_value <= 100);

CREATE TABLE IF NOT EXISTS public.discount_coupon_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid,
  code text NOT NULL,
  action text NOT NULL CHECK (action IN ('insert', 'update', 'delete')),
  old_row jsonb,
  new_row jsonb,
  actor uuid,
  actor_role text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discount_coupon_audit_code ON public.discount_coupon_audit (upper(code), created_at DESC);
ALTER TABLE public.discount_coupon_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read coupon audit" ON public.discount_coupon_audit;
CREATE POLICY "Admin can read coupon audit"
  ON public.discount_coupon_audit FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.discount_coupons_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.code := upper(trim(NEW.code));
    NEW.created_by := COALESCE(NEW.created_by, auth.uid());
    NEW.updated_by := auth.uid();
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF upper(trim(NEW.code)) <> upper(trim(OLD.code)) THEN
      RAISE EXCEPTION 'COUPON_CODE_LOCKED: a code cannot be renamed; create a new code instead'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.code := OLD.code;
    NEW.created_by := OLD.created_by;
    NEW.updated_by := auth.uid();
    RETURN NEW;
  ELSE -- DELETE
    IF EXISTS (SELECT 1 FROM public.bookings b WHERE upper(b.discount_code) = upper(OLD.code)) THEN
      RAISE EXCEPTION 'COUPON_IN_USE: % was used on a booking; deactivate it instead of deleting', OLD.code
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS discount_coupons_guard ON public.discount_coupons;
CREATE TRIGGER discount_coupons_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.discount_coupons
  FOR EACH ROW EXECUTE FUNCTION public.discount_coupons_guard();

CREATE OR REPLACE FUNCTION public.discount_coupons_audit_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.discount_coupon_audit (coupon_id, code, action, old_row, new_row, actor, actor_role)
    VALUES (NEW.id, NEW.code, 'insert', NULL, to_jsonb(NEW), auth.uid(), current_setting('request.jwt.claim.role', true));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO public.discount_coupon_audit (coupon_id, code, action, old_row, new_row, actor, actor_role)
    VALUES (NEW.id, NEW.code, 'update', to_jsonb(OLD), to_jsonb(NEW), auth.uid(), current_setting('request.jwt.claim.role', true));
    RETURN NEW;
  ELSE
    INSERT INTO public.discount_coupon_audit (coupon_id, code, action, old_row, new_row, actor, actor_role)
    VALUES (OLD.id, OLD.code, 'delete', to_jsonb(OLD), NULL, auth.uid(), current_setting('request.jwt.claim.role', true));
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS discount_coupons_audit_log ON public.discount_coupons;
CREATE TRIGGER discount_coupons_audit_log
  AFTER INSERT OR UPDATE OR DELETE ON public.discount_coupons
  FOR EACH ROW EXECUTE FUNCTION public.discount_coupons_audit_log();

-- Policies: admins manage coupons; the public keeps read access to active
-- coupons ONLY until part 2 (needed by the booking page currently live).
DROP POLICY IF EXISTS "Admin full access to discount_coupons" ON public.discount_coupons;
CREATE POLICY "Admin full access to discount_coupons"
  ON public.discount_coupons FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'::app_role))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'::app_role));

ALTER TABLE public.discount_coupons ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- 2. Public code validation (one code, active only)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.validate_discount_code(p_code text)
RETURNS TABLE (
  code text,
  discount_type text,
  discount_value numeric,
  applies_to text,
  applies_to_hourly boolean,
  applies_to_daily boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT c.code, c.discount_type::text, c.discount_value, c.applies_to, c.applies_to_hourly, c.applies_to_daily
  FROM public.discount_coupons c
  WHERE upper(c.code) = upper(trim(p_code))
    AND c.is_active = true
    AND length(trim(coalesce(p_code, ''))) BETWEEN 1 AND 64
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.validate_discount_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_discount_code(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Price snapshots (append-only)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.booking_price_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (reason IN ('checkout', 'backfill', 'admin_correction')),
  coupon_id uuid,
  discount_code text,
  discount_type text CHECK (discount_type IS NULL OR discount_type IN ('percentage', 'fixed_amount')),
  discount_value numeric,
  discount_applies_to text CHECK (discount_applies_to IS NULL OR discount_applies_to IN ('base_rental', 'total')),
  discount_eligible_base numeric,
  discount_amount numeric NOT NULL DEFAULT 0,
  gross_subtotal numeric NOT NULL,
  total_amount numeric NOT NULL,
  deposit_amount numeric NOT NULL,
  balance_amount numeric NOT NULL,
  processing_fee_pct numeric,
  deposit_fee numeric,
  deposit_total_charged numeric,
  lines jsonb,
  pricing_rates jsonb,
  note text,
  created_by text NOT NULL DEFAULT 'system',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT booking_price_snapshots_arithmetic CHECK (
    abs(gross_subtotal - discount_amount - total_amount) <= 0.01
    AND abs(deposit_amount + balance_amount - total_amount) <= 0.01
  )
);
CREATE INDEX IF NOT EXISTS idx_booking_price_snapshots_booking ON public.booking_price_snapshots (booking_id, created_at DESC);

ALTER TABLE public.booking_price_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin can read price snapshots" ON public.booking_price_snapshots;
CREATE POLICY "Admin can read price snapshots"
  ON public.booking_price_snapshots FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.booking_price_snapshots_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'booking_price_snapshots is append-only; insert a new snapshot instead'
      USING ERRCODE = 'check_violation';
  END IF;
  -- DELETE: only allowed as part of deleting the booking itself (cascade).
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = OLD.booking_id) THEN
    RAISE EXCEPTION 'booking_price_snapshots is append-only'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS booking_price_snapshots_immutable ON public.booking_price_snapshots;
CREATE TRIGGER booking_price_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.booking_price_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.booking_price_snapshots_immutable();

-- ---------------------------------------------------------------------------
-- 4. Balance session tracking
-- ---------------------------------------------------------------------------

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS balance_session_id text;

-- ---------------------------------------------------------------------------
-- 5. Bar rates from venue_pricing
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_bar_package_rate(p_package text)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (SELECT vp.price FROM public.venue_pricing vp
      WHERE vp.item_key = p_package AND vp.category = 'bar_service' AND vp.is_active = true
      LIMIT 1),
    CASE p_package
      WHEN 'house_beer_wine' THEN 18.00
      WHEN 'essential_bar'   THEN 25.63
      WHEN 'signature_bar'   THEN 32.13
      WHEN 'bespoke_bar'     THEN 39.63
      ELSE 0.00
    END
  )::numeric;
$$;

-- ---------------------------------------------------------------------------
-- 6. Legacy hardcoded codes become rows (same savings as before)
-- ---------------------------------------------------------------------------

INSERT INTO public.discount_coupons (code, discount_type, discount_value, applies_to, applies_to_hourly, applies_to_daily, is_active)
VALUES
  ('CHRIS', 'percentage', 40, 'base_rental', true, false, true),
  ('NANO', 'percentage', 50, 'base_rental', true, true, true),
  ('199', 'fixed_amount', 199, 'base_rental', true, true, true)
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 7. Backfill snapshots for upcoming bookings, then correct MILITARYSERVICE
-- ---------------------------------------------------------------------------

INSERT INTO public.booking_price_snapshots (
  booking_id, reason, coupon_id, discount_code, discount_type, discount_value, discount_applies_to,
  discount_eligible_base, discount_amount, gross_subtotal, total_amount, deposit_amount, balance_amount,
  processing_fee_pct, deposit_fee, deposit_total_charged, note, created_by
)
SELECT
  b.id,
  'backfill',
  c.id,
  NULLIF(b.discount_code, ''),
  c.discount_type::text,
  c.discount_value,
  c.applies_to,
  CASE WHEN c.applies_to = 'total'
       THEN b.base_rental + b.cleaning_fee + b.package_cost + b.optional_services + COALESCE(b.bar_subtotal, 0) + COALESCE(b.taxes_fees, 0)
       WHEN c.id IS NOT NULL THEN b.base_rental END,
  COALESCE(b.discount_amount, 0),
  b.total_amount + COALESCE(b.discount_amount, 0),
  b.total_amount,
  b.deposit_amount,
  b.balance_amount,
  b.processing_fee_pct,
  b.deposit_fee,
  b.deposit_total_charged,
  'Backfilled from stored booking columns on 2026-11-09; coupon terms as configured at that moment.',
  'migration:20261109120000'
FROM public.bookings b
LEFT JOIN public.discount_coupons c ON upper(c.code) = upper(b.discount_code)
WHERE b.event_date >= CURRENT_DATE
  AND b.status <> 'cancelled'
  AND b.total_amount IS NOT NULL
  AND b.deposit_amount IS NOT NULL
  AND b.balance_amount IS NOT NULL
  AND abs(b.deposit_amount + b.balance_amount - b.total_amount) <= 0.01
  AND NOT EXISTS (SELECT 1 FROM public.booking_price_snapshots s WHERE s.booking_id = b.id);

-- Luis's report: MILITARYSERVICE was meant to be $100 off, not 100% off.
UPDATE public.discount_coupons
SET discount_type = 'fixed_amount', discount_value = 100
WHERE code = 'MILITARYSERVICE'
  AND discount_type = 'percentage'
  AND discount_value = 100;
