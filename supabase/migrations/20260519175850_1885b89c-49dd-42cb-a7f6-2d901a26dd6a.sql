-- Singleton table for the current venue access/lockbox code
CREATE TABLE public.venue_access_code (
  id integer PRIMARY KEY DEFAULT 1,
  code text NOT NULL,
  label text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid,
  CONSTRAINT venue_access_code_singleton CHECK (id = 1)
);

-- Seed initial row with the current code
INSERT INTO public.venue_access_code (id, code, label)
VALUES (1, '02052026', 'Lockbox keypad')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.venue_access_code ENABLE ROW LEVEL SECURITY;

-- Only admin/staff can read or modify via direct table access
CREATE POLICY "Admin and staff can read venue_access_code"
  ON public.venue_access_code FOR SELECT
  USING (public.is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can update venue_access_code"
  ON public.venue_access_code FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Public RPC: validates a reservation_number against a non-cancelled booking
-- and returns the current access code. SECURITY DEFINER bypasses RLS so anon
-- can call it without exposing the table.
CREATE OR REPLACE FUNCTION public.get_access_code_for_reservation(
  p_reservation_number text
)
RETURNS TABLE(code text, label text, full_name text, event_date date)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
BEGIN
  IF p_reservation_number IS NULL OR length(trim(p_reservation_number)) = 0 THEN
    RAISE EXCEPTION 'reservation_number_required' USING ERRCODE = '22023';
  END IF;

  SELECT b.id, b.full_name, b.event_date, b.status
    INTO v_booking
  FROM public.bookings b
  WHERE upper(trim(b.reservation_number)) = upper(trim(p_reservation_number))
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservation_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.status IN ('cancelled', 'declined') THEN
    RAISE EXCEPTION 'reservation_inactive' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY
  SELECT vac.code, vac.label, v_booking.full_name, v_booking.event_date
  FROM public.venue_access_code vac
  WHERE vac.id = 1;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_access_code_for_reservation(text) TO anon, authenticated;