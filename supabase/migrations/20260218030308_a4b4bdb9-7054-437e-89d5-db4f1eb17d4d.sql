
-- Add drip email tracking columns (table already exists from previous migration)
ALTER TABLE public.popup_leads
ADD COLUMN IF NOT EXISTS email_1_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_2_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_3_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_converted BOOLEAN DEFAULT false;

-- Policy for service role to update popup leads
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'popup_leads' AND policyname = 'Service role can update popup leads'
  ) THEN
    CREATE POLICY "Service role can update popup leads"
      ON public.popup_leads FOR UPDATE TO authenticated
      USING (is_admin_or_staff(auth.uid()));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_popup_leads_drip
  ON public.popup_leads (is_converted, email_1_sent_at, email_2_sent_at, email_3_sent_at)
  WHERE is_converted = false;

-- Insert SAVE50 coupon if not exists
INSERT INTO public.discount_coupons (code, discount_type, discount_value, applies_to, applies_to_hourly, applies_to_daily, is_active)
VALUES ('SAVE50', 'fixed_amount', 50, 'base_rental', true, true, true)
ON CONFLICT (code) DO NOTHING;
