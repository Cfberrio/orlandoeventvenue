-- =====================================================
-- 1) EXTENDER BOOKINGS (TABLA CENTRAL, POCAS COLUMNAS)
-- =====================================================

-- Estado operativo del booking (lifecycle)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'pending';
COMMENT ON COLUMN public.bookings.lifecycle_status IS
  'Operational state: pending, confirmed, pre_event_ready, in_progress, post_event, closed_review_complete, cancelled';

-- Aclarar uso del status actual (no cambia datos, solo documenta)
COMMENT ON COLUMN public.bookings.status IS
  'Payment/booking state: pending_review, confirmed, cancelled, completed';

-- Origen del lead
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS lead_source TEXT NULL;
COMMENT ON COLUMN public.bookings.lead_source IS
  'Source: direct_site, instagram, trustedvenues_directory, referral, phone_call';

-- Pre-event checklist (solo flag + timestamp)
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pre_event_ready BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS pre_event_checklist_completed_at TIMESTAMPTZ NULL;

-- =====================================================
-- 2) EXTENDER BOOKING_ATTACHMENTS (FOTOS / ARCHIVOS)
-- =====================================================

ALTER TABLE public.booking_attachments
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';
ALTER TABLE public.booking_attachments
  ADD COLUMN IF NOT EXISTS description TEXT NULL;

COMMENT ON COLUMN public.booking_attachments.category IS
  'Category: contract, host_post_event, cleaning_before, cleaning_after, maintenance, other';

-- =====================================================
-- 3) VENUE CONFIG – INFO BÁSICA DEL VENUE
-- =====================================================

INSERT INTO public.venue_config (key, value, description) VALUES
  ('venue_name', '"OEV Event Space"', 'Public venue name'),
  ('venue_address', '""', 'Full venue address'),
  ('venue_capacity', '"150"', 'Maximum recommended guest capacity'),
  ('venue_rules', '""', 'Summary of key rules and policies for the venue'),
  ('default_event_duration_hours', '"4"', 'Default duration used when creating bookings'),
  ('minimum_booking_notice_hours', '"48"', 'Minimum hours in advance required to book')
ON CONFLICT (key) DO NOTHING;

-- =====================================================
-- 4) STAFF_MEMBERS (PERSONAL DEL VENUE / SISTEMA)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.staff_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name  TEXT NOT NULL,
  email      TEXT NULL,
  phone      TEXT NULL,
  role       TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.staff_members.role IS
  'Role: venue_admin, support, cleaner, maintenance, answering_service';

ALTER TABLE public.staff_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can view staff_members" ON public.staff_members
  FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin can manage staff_members" ON public.staff_members
  FOR ALL USING (has_role(auth.uid(), 'admin'));

-- =====================================================
-- 5) BOOKING_STAFF_ASSIGNMENTS (QUIÉN HACE QUÉ)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.booking_staff_assignments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  staff_id        UUID NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  assignment_role TEXT NOT NULL,
  notes           TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.booking_staff_assignments.assignment_role IS
  'Assignment role: manager_on_duty, support, door, cleaner, other';

ALTER TABLE public.booking_staff_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can view assignments" ON public.booking_staff_assignments
  FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can manage assignments" ON public.booking_staff_assignments
  FOR ALL USING (is_admin_or_staff(auth.uid()));

-- =====================================================
-- 6) BOOKING_EVENTS (MENSAJES, RECORDATORIOS, LLAMADAS)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.booking_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  channel     TEXT NULL,
  metadata    JSONB NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.booking_events.event_type IS
  'Event type: confirmation_sent, reminder_72h, reminder_24h, reminder_3h, post_event_link_sent, review_request_sent, call_received, call_transferred, etc.';
COMMENT ON COLUMN public.booking_events.channel IS
  'Channel: email, sms, call, system';

ALTER TABLE public.booking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can view booking_events" ON public.booking_events
  FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can manage booking_events" ON public.booking_events
  FOR ALL USING (is_admin_or_staff(auth.uid()));

-- =====================================================
-- 7) BOOKING_CLEANING_REPORTS (LIMPIEZA + CHECKLIST)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.booking_cleaning_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  cleaner_id      UUID NULL REFERENCES public.staff_members(id) ON DELETE SET NULL,
  scheduled_start TIMESTAMPTZ NULL,
  scheduled_end   TIMESTAMPTZ NULL,
  started_at      TIMESTAMPTZ NULL,
  completed_at    TIMESTAMPTZ NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
  floors_clean    BOOLEAN,
  restrooms_clean BOOLEAN,
  trash_removed   BOOLEAN,
  surfaces_clean  BOOLEAN,
  damage_found    BOOLEAN,
  damage_notes    TEXT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.booking_cleaning_reports.status IS
  'Status: pending, in_progress, completed, approved';

ALTER TABLE public.booking_cleaning_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can view cleaning_reports" ON public.booking_cleaning_reports
  FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can manage cleaning_reports" ON public.booking_cleaning_reports
  FOR ALL USING (is_admin_or_staff(auth.uid()));

-- =====================================================
-- 8) BOOKING_HOST_REPORTS (REPORTE DEL HOST)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.booking_host_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id      UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'submitted',
  notes           TEXT NULL,
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at     TIMESTAMPTZ NULL,
  reviewed_by_id  UUID NULL REFERENCES public.staff_members(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.booking_host_reports.status IS
  'Status: submitted, approved, rejected';

ALTER TABLE public.booking_host_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can view host_reports" ON public.booking_host_reports
  FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can manage host_reports" ON public.booking_host_reports
  FOR ALL USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Anyone can submit host_reports" ON public.booking_host_reports
  FOR INSERT WITH CHECK (true);

-- =====================================================
-- 9) BOOKING_REVIEWS (RESEÑAS DEL EVENTO)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.booking_reviews (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id    UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,
  rating        INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment       TEXT NULL,
  reviewer_name TEXT NULL,
  review_url    TEXT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.booking_reviews.source IS
  'Source: internal, google, directory';

ALTER TABLE public.booking_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can view reviews" ON public.booking_reviews
  FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can manage reviews" ON public.booking_reviews
  FOR ALL USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Anyone can submit reviews" ON public.booking_reviews
  FOR INSERT WITH CHECK (true);

-- =====================================================
-- 10) MAINTENANCE_TICKETS (DAÑOS / ISSUES)
-- =====================================================

CREATE TABLE IF NOT EXISTS public.maintenance_tickets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       UUID NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  title            TEXT NOT NULL,
  venue_area       TEXT NULL,
  issue_type       TEXT NULL,
  description      TEXT NULL,
  reported_by_role TEXT NULL,
  priority         TEXT NOT NULL DEFAULT 'medium',
  status           TEXT NOT NULL DEFAULT 'open',
  resolved_at      TIMESTAMPTZ NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.maintenance_tickets.venue_area IS
  'Area: kitchen, bathroom, main_hall, etc.';
COMMENT ON COLUMN public.maintenance_tickets.issue_type IS
  'Type: damage, missing_item, equipment_failure';
COMMENT ON COLUMN public.maintenance_tickets.reported_by_role IS
  'Reporter: admin, cleaner, host';
COMMENT ON COLUMN public.maintenance_tickets.priority IS
  'Priority: low, medium, high';
COMMENT ON COLUMN public.maintenance_tickets.status IS
  'Status: open, in_progress, resolved, dismissed';

ALTER TABLE public.maintenance_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin and staff can view maintenance_tickets" ON public.maintenance_tickets
  FOR SELECT USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Admin and staff can manage maintenance_tickets" ON public.maintenance_tickets
  FOR ALL USING (is_admin_or_staff(auth.uid()));

-- =====================================================
-- 11) INDEXES PARA PERFORMANCE
-- =====================================================

CREATE INDEX IF NOT EXISTS idx_bookings_lifecycle_status ON public.bookings(lifecycle_status);
CREATE INDEX IF NOT EXISTS idx_booking_events_booking_id ON public.booking_events(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_cleaning_reports_booking_id ON public.booking_cleaning_reports(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_host_reports_booking_id ON public.booking_host_reports(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_reviews_booking_id ON public.booking_reviews(booking_id);
CREATE INDEX IF NOT EXISTS idx_maintenance_tickets_booking_id ON public.maintenance_tickets(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_staff_assignments_booking_id ON public.booking_staff_assignments(booking_id);

-- =====================================================
-- 12) TRIGGERS PARA updated_at
-- =====================================================

CREATE TRIGGER update_staff_members_updated_at
  BEFORE UPDATE ON public.staff_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_booking_staff_assignments_updated_at
  BEFORE UPDATE ON public.booking_staff_assignments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_booking_cleaning_reports_updated_at
  BEFORE UPDATE ON public.booking_cleaning_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_booking_host_reports_updated_at
  BEFORE UPDATE ON public.booking_host_reports
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_maintenance_tickets_updated_at
  BEFORE UPDATE ON public.maintenance_tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();