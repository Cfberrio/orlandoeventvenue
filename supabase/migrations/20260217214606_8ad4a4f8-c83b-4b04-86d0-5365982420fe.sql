
-- Table to store leads captured from the $50 off popup
CREATE TABLE public.popup_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  preferred_event_date DATE,
  coupon_code TEXT DEFAULT 'SAVE50',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.popup_leads ENABLE ROW LEVEL SECURITY;

-- Anyone can submit (anon visitors)
CREATE POLICY "Anon can insert popup leads"
  ON public.popup_leads FOR INSERT TO anon, authenticated
  WITH CHECK (true);

-- Only admins can view leads
CREATE POLICY "Admin can read popup leads"
  ON public.popup_leads FOR SELECT TO authenticated
  USING (is_admin_or_staff(auth.uid()));
