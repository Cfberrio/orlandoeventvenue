-- Table to store additional package/service invoices for existing bookings
CREATE TABLE public.booking_addon_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  package TEXT NOT NULL DEFAULT 'none',
  package_start_time TEXT,
  package_end_time TEXT,
  package_cost NUMERIC NOT NULL DEFAULT 0,
  setup_breakdown BOOLEAN NOT NULL DEFAULT false,
  tablecloths BOOLEAN NOT NULL DEFAULT false,
  tablecloth_quantity INTEGER NOT NULL DEFAULT 0,
  optional_services_cost NUMERIC NOT NULL DEFAULT 0,
  total_amount NUMERIC NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_url TEXT,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  CONSTRAINT valid_payment_status CHECK (payment_status IN ('pending', 'paid', 'expired'))
);

ALTER TABLE public.booking_addon_invoices ENABLE ROW LEVEL SECURITY;

-- Admin/staff can do everything
CREATE POLICY "Admin can manage addon invoices"
  ON public.booking_addon_invoices
  FOR ALL TO authenticated
  USING (is_admin_or_staff(auth.uid()));

-- Index for looking up invoices by booking
CREATE INDEX idx_addon_invoices_booking_id ON public.booking_addon_invoices (booking_id);
