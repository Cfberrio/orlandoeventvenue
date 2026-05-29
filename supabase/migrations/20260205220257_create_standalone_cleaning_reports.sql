-- =====================================================
-- CREATE standalone_cleaning_reports TABLE
-- =====================================================
-- Purpose: Store cleaning reports for standalone assignments (not linked to bookings)
-- Similar structure to booking_cleaning_reports but for venue prep/maintenance tasks

CREATE TABLE IF NOT EXISTS public.standalone_cleaning_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.booking_staff_assignments(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES public.staff_members(id),
  cleaner_name TEXT NOT NULL,
  cleaner_role TEXT NOT NULL,
  
  -- Checklist (10 items - same as booking_cleaning_reports)
  clean_check_floors_swept_mopped BOOLEAN DEFAULT false,
  clean_check_bathrooms_cleaned BOOLEAN DEFAULT false,
  clean_check_kitchen_cleaned BOOLEAN DEFAULT false,
  clean_check_trash_removed BOOLEAN DEFAULT false,
  clean_check_equipment_stored BOOLEAN DEFAULT false,
  clean_check_tables_chairs_arranged BOOLEAN DEFAULT false,
  clean_check_lights_off BOOLEAN DEFAULT false,
  clean_check_office_door_locked BOOLEAN DEFAULT false,
  clean_check_front_door_locked BOOLEAN DEFAULT false,
  clean_check_deep_cleaning_done BOOLEAN DEFAULT false,
  
  -- Media uploads (JSON arrays with Supabase Storage URLs)
  media_front_door JSONB DEFAULT '[]'::jsonb,
  media_main_area JSONB DEFAULT '[]'::jsonb,
  media_rack JSONB DEFAULT '[]'::jsonb,
  media_bathrooms JSONB DEFAULT '[]'::jsonb,
  media_kitchen JSONB DEFAULT '[]'::jsonb,
  media_deep_cleaning JSONB DEFAULT '[]'::jsonb,
  
  -- Issues & Inventory
  issues_found BOOLEAN DEFAULT false,
  issues_notes TEXT,
  inventory_update_needed BOOLEAN DEFAULT false,
  inventory_items JSONB DEFAULT '[]'::jsonb,
  damage_found BOOLEAN DEFAULT false,
  damage_description TEXT,
  
  -- Status & timestamps
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_standalone_cleaning_reports_assignment 
  ON public.standalone_cleaning_reports(assignment_id);

CREATE INDEX IF NOT EXISTS idx_standalone_cleaning_reports_cleaner 
  ON public.standalone_cleaning_reports(cleaner_id);

CREATE INDEX IF NOT EXISTS idx_standalone_cleaning_reports_status 
  ON public.standalone_cleaning_reports(status);

CREATE INDEX IF NOT EXISTS idx_standalone_cleaning_reports_created 
  ON public.standalone_cleaning_reports(created_at);

-- Enable RLS
ALTER TABLE public.standalone_cleaning_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies

-- Admin can do everything
CREATE POLICY "Admin full access to standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR ALL
  USING (has_role(auth.uid(), 'admin'));

-- Staff can view their own reports
CREATE POLICY "Staff can view own standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR SELECT
  USING (cleaner_id = auth.uid());

-- Staff can create their own reports
CREATE POLICY "Staff can create own standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR INSERT
  WITH CHECK (cleaner_id = auth.uid());

-- Staff can update their own reports
CREATE POLICY "Staff can update own standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR UPDATE
  USING (cleaner_id = auth.uid());

-- Trigger for updated_at timestamp
CREATE TRIGGER set_standalone_cleaning_reports_updated_at
  BEFORE UPDATE ON public.standalone_cleaning_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE public.standalone_cleaning_reports IS 
  'Cleaning reports for standalone assignments (venue prep, maintenance) not linked to bookings';

COMMENT ON COLUMN public.standalone_cleaning_reports.assignment_id IS 
  'Links to booking_staff_assignments where booking_id IS NULL';

COMMENT ON COLUMN public.standalone_cleaning_reports.media_main_area IS 
  'Main area photos - at least 1 is MANDATORY for report completion';

COMMENT ON COLUMN public.standalone_cleaning_reports.status IS 
  'Report status: pending (not submitted) or completed (submitted)';

-- Add column to track reminder emails sent
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.booking_staff_assignments.reminder_sent_at IS 
  'Timestamp when reminder email was sent (for standalone assignments)';
