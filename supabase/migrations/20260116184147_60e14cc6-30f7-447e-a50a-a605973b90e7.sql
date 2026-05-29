-- Booking origins + policies

CREATE TYPE public.booking_origin AS ENUM ('website', 'internal', 'external');

CREATE TABLE public.booking_policies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_name TEXT UNIQUE NOT NULL,
  description TEXT,
  requires_payment BOOLEAN DEFAULT TRUE,
  send_deposit_emails BOOLEAN DEFAULT TRUE,
  send_balance_emails BOOLEAN DEFAULT TRUE,
  send_pre_event_30d BOOLEAN DEFAULT TRUE,
  send_pre_event_7d BOOLEAN DEFAULT TRUE,
  send_pre_event_1d BOOLEAN DEFAULT TRUE,
  include_host_report BOOLEAN DEFAULT TRUE,
  send_cleaning_report BOOLEAN DEFAULT TRUE,
  send_customer_confirmation BOOLEAN DEFAULT TRUE,
  requires_staff_assignment BOOLEAN DEFAULT FALSE,
  send_staff_assignment_emails BOOLEAN DEFAULT TRUE,
  auto_lifecycle_transitions BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO public.booking_policies (policy_name, description, requires_payment, send_deposit_emails, send_balance_emails, send_pre_event_30d, send_pre_event_7d, send_pre_event_1d, include_host_report, send_cleaning_report, send_customer_confirmation, requires_staff_assignment, send_staff_assignment_emails, auto_lifecycle_transitions) VALUES
('WEBSITE_FULL_FLOW', 'Full automation', TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, FALSE, TRUE, TRUE),
('INTERNAL_BLOCK_FLOW', 'Internal: no payments', FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, TRUE, FALSE, FALSE, FALSE, TRUE, FALSE),
('EXTERNAL_BLOCK_FLOW', 'External: block only', FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE, TRUE, FALSE);

ALTER TABLE public.bookings ADD COLUMN booking_origin public.booking_origin;
ALTER TABLE public.bookings ADD COLUMN policy_id UUID REFERENCES public.booking_policies(id);

UPDATE public.bookings SET booking_origin='internal', policy_id=(SELECT id FROM public.booking_policies WHERE policy_name='INTERNAL_BLOCK_FLOW') WHERE payment_status='invoiced';
UPDATE public.bookings SET booking_origin='website', policy_id=(SELECT id FROM public.booking_policies WHERE policy_name='WEBSITE_FULL_FLOW') WHERE booking_origin IS NULL;

ALTER TABLE public.bookings ALTER COLUMN booking_origin SET DEFAULT 'website';
ALTER TABLE public.bookings ALTER COLUMN booking_origin SET NOT NULL;
ALTER TABLE public.bookings ALTER COLUMN policy_id SET NOT NULL;

CREATE INDEX idx_bookings_booking_origin ON public.bookings(booking_origin);
CREATE INDEX idx_bookings_policy_id ON public.bookings(policy_id);

CREATE VIEW public.booking_custodial_staff AS 
SELECT bsa.booking_id, sm.id AS staff_id, sm.full_name AS staff_name, sm.email AS staff_email 
FROM public.booking_staff_assignments bsa 
JOIN public.staff_members sm ON bsa.staff_id=sm.id 
WHERE LOWER(bsa.assignment_role)='custodial' AND sm.is_active=TRUE;

CREATE TABLE public.stripe_event_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), 
  event_id TEXT UNIQUE NOT NULL, 
  event_type TEXT NOT NULL, 
  booking_id UUID REFERENCES public.bookings(id), 
  processed_at TIMESTAMPTZ DEFAULT now(), 
  metadata JSONB
);

CREATE INDEX idx_stripe_event_log_event_id ON public.stripe_event_log(event_id);

ALTER TABLE public.booking_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_event_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "view_policies" ON public.booking_policies FOR SELECT USING (true);
CREATE POLICY "admin_policies" ON public.booking_policies FOR ALL USING (has_role(auth.uid(),'admin'));
CREATE POLICY "admin_stripe_log" ON public.stripe_event_log FOR SELECT USING (is_admin_or_staff(auth.uid()));