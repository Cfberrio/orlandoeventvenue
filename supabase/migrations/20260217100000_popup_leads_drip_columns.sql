-- Add drip email tracking columns to popup_leads
ALTER TABLE public.popup_leads
ADD COLUMN IF NOT EXISTS email_1_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_2_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS email_3_sent_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS is_converted BOOLEAN DEFAULT false;

-- Allow service role to update popup_leads (for Edge Functions updating sent_at timestamps)
CREATE POLICY "Service role can update popup leads"
  ON public.popup_leads FOR UPDATE TO authenticated
  USING (is_admin_or_staff(auth.uid()));

-- Index for efficient drip processing queries
CREATE INDEX IF NOT EXISTS idx_popup_leads_drip
  ON public.popup_leads (is_converted, email_1_sent_at, email_2_sent_at, email_3_sent_at)
  WHERE is_converted = false;
