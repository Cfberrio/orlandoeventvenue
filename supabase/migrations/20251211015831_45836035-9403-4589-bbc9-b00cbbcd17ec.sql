-- Add new columns to booking_cleaning_reports for the enhanced cleaning report form
ALTER TABLE public.booking_cleaning_reports 
ADD COLUMN IF NOT EXISTS cleaner_name text,
ADD COLUMN IF NOT EXISTS cleaner_role text,
ADD COLUMN IF NOT EXISTS clean_issues_notes text,
ADD COLUMN IF NOT EXISTS inventory_update_needed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS inventory_items jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS media_front_door jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS media_main_area jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS media_rack jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS media_bathrooms jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS media_kitchen jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS media_deep_cleaning jsonb DEFAULT '[]'::jsonb,
ADD COLUMN IF NOT EXISTS clean_check_floors boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_bathrooms boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_kitchen boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_trash_removed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_equipment_stored boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_tables_chairs_positioned boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_lights_off boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_office_door_closed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_door_locked boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS clean_check_deep_cleaning_done boolean DEFAULT false;

-- Create storage bucket for cleaning report media
INSERT INTO storage.buckets (id, name, public) 
VALUES ('cleaning-media', 'cleaning-media', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies for cleaning media bucket
CREATE POLICY "Staff can upload cleaning media"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'cleaning-media' AND auth.uid() IS NOT NULL);

CREATE POLICY "Anyone can view cleaning media"
ON storage.objects FOR SELECT
USING (bucket_id = 'cleaning-media');

CREATE POLICY "Staff can delete their uploads"
ON storage.objects FOR DELETE
USING (bucket_id = 'cleaning-media' AND auth.uid() IS NOT NULL);

-- Add RLS policy for staff to view their assigned bookings
CREATE POLICY "Staff can view their assigned bookings"
ON public.bookings FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.booking_staff_assignments bsa
    JOIN public.staff_members sm ON sm.id = bsa.staff_id
    JOIN public.user_roles ur ON ur.user_id = auth.uid()
    WHERE bsa.booking_id = bookings.id
    AND ur.role IN ('admin', 'staff')
  )
  OR is_admin_or_staff(auth.uid())
);

-- Staff can view cleaning reports for their assigned bookings
CREATE POLICY "Staff can view their cleaning reports"
ON public.booking_cleaning_reports FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.booking_staff_assignments bsa
    JOIN public.staff_members sm ON sm.id = bsa.staff_id
    WHERE bsa.booking_id = booking_cleaning_reports.booking_id
  )
  OR is_admin_or_staff(auth.uid())
);

-- Staff can update cleaning reports for their assigned bookings
CREATE POLICY "Staff can update their cleaning reports"
ON public.booking_cleaning_reports FOR UPDATE
USING (
  EXISTS (
    SELECT 1 FROM public.booking_staff_assignments bsa
    WHERE bsa.booking_id = booking_cleaning_reports.booking_id
  )
  OR is_admin_or_staff(auth.uid())
);