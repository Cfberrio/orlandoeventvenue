
DROP POLICY IF EXISTS "Service role can update popup leads" ON public.popup_leads;

CREATE POLICY "Anyone can mark popup leads as converted"
  ON public.popup_leads FOR UPDATE TO anon, authenticated
  WITH CHECK (is_converted = true);

CREATE POLICY "Admin can fully update popup leads"
  ON public.popup_leads FOR UPDATE TO authenticated
  USING (is_admin_or_staff(auth.uid()));
