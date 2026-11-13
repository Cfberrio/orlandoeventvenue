-- Phase 1B / M-21 (ClickUp 86e40ach2): coupons can expire and run out, and
-- the public validator cannot be used to guess codes at full speed.
--
-- Before: no expiry, no usage limit; personal codes stayed usable forever
-- (Luis D6 lists 8 already used + 4 guessable ones; deactivating them is his
-- call, not done here). validate_discount_code was public with no limit.
--
-- Now:
--   * expires_at / max_uses on discount_coupons (NULL = no limit, as today);
--   * a use = a booking with that code whose deposit (or full payment) was
--     paid; abandoned checkouts do not burn uses;
--   * the same rule runs in the public validator and in create-checkout's
--     server re-check (coupon_usable);
--   * the validator records attempts and stops answering after 15 failed
--     lookups from one IP in 15 minutes.

ALTER TABLE public.discount_coupons
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_uses integer;

DO $chk$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'discount_coupons_max_uses_check') THEN
    ALTER TABLE public.discount_coupons
      ADD CONSTRAINT discount_coupons_max_uses_check CHECK (max_uses IS NULL OR max_uses >= 1);
  END IF;
END
$chk$;

CREATE OR REPLACE FUNCTION public.coupon_paid_uses(p_code text)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT count(*)::int
  FROM public.bookings b
  WHERE upper(trim(b.discount_code)) = upper(trim(p_code))
    AND (b.deposit_paid_at IS NOT NULL OR b.balance_paid_at IS NOT NULL);
$function$;

-- NULL when usable, otherwise the reason (inactive / expired / used_up / not_found).
CREATE OR REPLACE FUNCTION public.coupon_unusable_reason(p_code text)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  c public.discount_coupons%ROWTYPE;
BEGIN
  SELECT * INTO c FROM public.discount_coupons WHERE upper(code) = upper(trim(p_code)) LIMIT 1;
  IF NOT FOUND THEN RETURN 'not_found'; END IF;
  IF NOT c.is_active THEN RETURN 'inactive'; END IF;
  IF c.expires_at IS NOT NULL AND c.expires_at <= now() THEN RETURN 'expired'; END IF;
  IF c.max_uses IS NOT NULL AND public.coupon_paid_uses(c.code) >= c.max_uses THEN RETURN 'used_up'; END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.coupon_paid_uses(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.coupon_unusable_reason(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.coupon_paid_uses(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coupon_unusable_reason(text) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.discount_code_attempts (
  id bigserial PRIMARY KEY,
  ip text NOT NULL,
  ok boolean NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS discount_code_attempts_ip_at_idx ON public.discount_code_attempts (ip, at DESC);
ALTER TABLE public.discount_code_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discount_code_attempts FROM anon, authenticated;

-- Same signature and columns as before (the booking page calls it).
CREATE OR REPLACE FUNCTION public.validate_discount_code(p_code text)
RETURNS TABLE(code text, discount_type text, discount_value numeric, applies_to text, applies_to_hourly boolean, applies_to_daily boolean)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_headers json;
  v_ip text;
  v_failed int;
  v_found boolean := false;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;
  v_ip := COALESCE(
    NULLIF(v_headers->>'cf-connecting-ip', ''),
    NULLIF(v_headers->>'x-real-ip', ''),
    -- last hop: the first x-forwarded-for value is client-controlled
    NULLIF(btrim(regexp_replace(COALESCE(v_headers->>'x-forwarded-for', ''), '^.*,', '')), ''),
    'unknown'
  );

  -- No client IP (internal call): never throttle, or every guest would share
  -- one bucket.
  SELECT count(*) INTO v_failed
  FROM public.discount_code_attempts a
  WHERE a.ip = v_ip AND NOT a.ok AND a.at > now() - interval '15 minutes';
  IF v_ip <> 'unknown' AND v_failed >= 15 THEN
    INSERT INTO public.discount_code_attempts (ip, ok) VALUES (v_ip, false);
    RETURN;
  END IF;

  IF length(trim(coalesce(p_code, ''))) BETWEEN 1 AND 64
     AND public.coupon_unusable_reason(p_code) IS NULL THEN
    RETURN QUERY
      SELECT c.code, c.discount_type::text, c.discount_value, c.applies_to, c.applies_to_hourly, c.applies_to_daily
      FROM public.discount_coupons c
      WHERE upper(c.code) = upper(trim(p_code))
      LIMIT 1;
    v_found := FOUND;
  END IF;

  INSERT INTO public.discount_code_attempts (ip, ok) VALUES (v_ip, v_found);
  DELETE FROM public.discount_code_attempts WHERE at < now() - interval '1 day';
END;
$function$;

GRANT EXECUTE ON FUNCTION public.validate_discount_code(text) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Codex review: counting paid uses alone lets several open checkouts pass the
-- limit together. create-checkout reserves a use per booking under a per-code
-- lock; open reservations (Stripe sessions live 24h) count against max_uses
-- until they are paid or go stale.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupon_reservations (
  booking_id uuid PRIMARY KEY REFERENCES public.bookings(id) ON DELETE CASCADE,
  code text NOT NULL,
  reserved_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coupon_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coupon_reservations FROM anon, authenticated;

-- NULL = reserved (or no limit); otherwise the reason it cannot be used.
CREATE OR REPLACE FUNCTION public.reserve_coupon_use(p_code text, p_booking_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_code text := upper(trim(p_code));
  v_reason text;
  v_max integer;
  v_open integer;
BEGIN
  PERFORM public._assert_admin_or_service();
  PERFORM pg_advisory_xact_lock(hashtext('oev_coupon:' || v_code));

  v_reason := public.coupon_unusable_reason(v_code);
  IF v_reason IS NOT NULL THEN
    RETURN v_reason;
  END IF;

  SELECT max_uses INTO v_max FROM public.discount_coupons WHERE upper(code) = v_code LIMIT 1;
  IF v_max IS NOT NULL THEN
    SELECT count(*) INTO v_open
    FROM public.coupon_reservations r
    JOIN public.bookings b ON b.id = r.booking_id
    WHERE r.code = v_code
      AND r.booking_id <> p_booking_id
      AND r.reserved_at > now() - interval '25 hours'
      AND b.deposit_paid_at IS NULL AND b.balance_paid_at IS NULL;
    IF public.coupon_paid_uses(v_code) + v_open >= v_max THEN
      RETURN 'used_up';
    END IF;
  END IF;

  INSERT INTO public.coupon_reservations (booking_id, code, reserved_at)
  VALUES (p_booking_id, v_code, now())
  ON CONFLICT (booking_id) DO UPDATE SET code = EXCLUDED.code, reserved_at = now();
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_coupon_use(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_coupon_use(text, uuid) TO service_role;
