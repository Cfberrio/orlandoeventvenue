-- =====================================================
-- CREATE standalone_cleaning_reports TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.standalone_cleaning_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES public.booking_staff_assignments(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES public.staff_members(id),
  cleaner_name TEXT NOT NULL,
  cleaner_role TEXT NOT NULL,
  
  -- Checklist (10 items)
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
  
  -- Media uploads (JSON arrays)
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_standalone_cleaning_reports_assignment 
  ON public.standalone_cleaning_reports(assignment_id);
CREATE INDEX IF NOT EXISTS idx_standalone_cleaning_reports_cleaner 
  ON public.standalone_cleaning_reports(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_standalone_cleaning_reports_status 
  ON public.standalone_cleaning_reports(status);

-- Enable RLS
ALTER TABLE public.standalone_cleaning_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admin full access to standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR ALL
  USING (has_role(auth.uid(), 'admin'));

CREATE POLICY "Staff can view own standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR SELECT
  USING (cleaner_id = auth.uid());

CREATE POLICY "Staff can create own standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR INSERT
  WITH CHECK (cleaner_id = auth.uid());

CREATE POLICY "Staff can update own standalone cleaning reports"
  ON public.standalone_cleaning_reports FOR UPDATE
  USING (cleaner_id = auth.uid());

-- Trigger for updated_at
CREATE TRIGGER set_standalone_cleaning_reports_updated_at
  BEFORE UPDATE ON public.standalone_cleaning_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Add reminder_sent_at to booking_staff_assignments
ALTER TABLE public.booking_staff_assignments
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;