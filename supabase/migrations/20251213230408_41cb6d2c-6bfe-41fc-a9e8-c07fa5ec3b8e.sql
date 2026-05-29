-- Extend booking_host_reports table with guest confirmation fields and issue tracking
ALTER TABLE public.booking_host_reports 
ADD COLUMN IF NOT EXISTS guest_name text,
ADD COLUMN IF NOT EXISTS guest_email text,
ADD COLUMN IF NOT EXISTS guest_phone text,
ADD COLUMN IF NOT EXISTS guest_confirm_area_clean boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS guest_confirm_trash_bagged boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS guest_confirm_bathrooms_ok boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS guest_confirm_door_closed boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS issue_description text,
ADD COLUMN IF NOT EXISTS has_issue boolean DEFAULT false;

-- Allow public insert and update on booking_host_reports for guest submissions
CREATE POLICY "Anyone can submit host reports via reservation lookup" 
ON public.booking_host_reports 
FOR INSERT 
WITH CHECK (true);

CREATE POLICY "Anyone can update their host report" 
ON public.booking_host_reports 
FOR UPDATE 
USING (true);

-- Allow public select on bookings by reservation_number for guest lookup
CREATE POLICY "Anyone can lookup booking by reservation_number" 
ON public.bookings 
FOR SELECT 
USING (reservation_number IS NOT NULL);