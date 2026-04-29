-- Phase 5: Stripe Connect 80/20 split tracking
-- Records every successful platform-account customer payment that was split
-- via destination charges (transfer_data) to the connected account.
-- Designed to also support future separate-charges-and-transfers via transfer_id column.

CREATE TABLE IF NOT EXISTS public.stripe_connect_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Stripe identifiers
  stripe_event_id text,
  payment_intent_id text,
  charge_id text,
  checkout_session_id text,
  invoice_id text,                 -- Stripe invoice id (in.*)
  stripe_invoice_id text,          -- alias / future use
  transfer_id text,                -- populated only if a separate transfer is created (future)
  destination_account_id text NOT NULL DEFAULT 'acct_1T4iADFLbEEEatlj',

  -- OEV identifiers
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  booking_addon_invoice_id uuid REFERENCES public.booking_addon_invoices(id) ON DELETE SET NULL,
  internal_invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  reservation_number text,
  invoice_number text,

  -- Amounts
  currency text NOT NULL DEFAULT 'usd',
  gross_amount_cents integer NOT NULL,
  transfer_percent numeric(5,2) NOT NULL DEFAULT 20.00,
  transfer_amount_cents integer NOT NULL,
  platform_retained_amount_cents integer NOT NULL,

  -- Status: pending | succeeded | failed | skipped | reversed | needs_review
  status text NOT NULL DEFAULT 'succeeded',
  -- Mechanism used: 'destination_charge' (current) or 'separate_transfer' (future)
  mechanism text NOT NULL DEFAULT 'destination_charge',

  -- Error / debug
  error_code text,
  error_message text,
  attempts integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  CONSTRAINT stripe_connect_transfers_status_chk
    CHECK (status IN ('pending','succeeded','failed','skipped','reversed','needs_review')),
  CONSTRAINT stripe_connect_transfers_mechanism_chk
    CHECK (mechanism IN ('destination_charge','separate_transfer'))
);

-- Idempotency: prevent duplicate split rows per Stripe object
CREATE UNIQUE INDEX IF NOT EXISTS uq_sct_payment_intent
  ON public.stripe_connect_transfers (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sct_charge
  ON public.stripe_connect_transfers (charge_id)
  WHERE charge_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sct_transfer
  ON public.stripe_connect_transfers (transfer_id)
  WHERE transfer_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sct_event
  ON public.stripe_connect_transfers (stripe_event_id)
  WHERE stripe_event_id IS NOT NULL;

-- Lookup indexes
CREATE INDEX IF NOT EXISTS idx_sct_booking_id
  ON public.stripe_connect_transfers (booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sct_addon_invoice_id
  ON public.stripe_connect_transfers (booking_addon_invoice_id) WHERE booking_addon_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sct_internal_invoice_id
  ON public.stripe_connect_transfers (internal_invoice_id) WHERE internal_invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sct_status_created
  ON public.stripe_connect_transfers (status, created_at DESC);

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_sct_updated_at ON public.stripe_connect_transfers;
CREATE TRIGGER trg_sct_updated_at
BEFORE UPDATE ON public.stripe_connect_transfers
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- RLS: admins/staff read & manage; service role bypasses RLS naturally
ALTER TABLE public.stripe_connect_transfers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin/staff can view connect transfers"
  ON public.stripe_connect_transfers;
CREATE POLICY "Admin/staff can view connect transfers"
  ON public.stripe_connect_transfers
  FOR SELECT
  TO authenticated
  USING (public.is_admin_or_staff(auth.uid()));

DROP POLICY IF EXISTS "Admin/staff can manage connect transfers"
  ON public.stripe_connect_transfers;
CREATE POLICY "Admin/staff can manage connect transfers"
  ON public.stripe_connect_transfers
  FOR ALL
  TO authenticated
  USING (public.is_admin_or_staff(auth.uid()))
  WITH CHECK (public.is_admin_or_staff(auth.uid()));