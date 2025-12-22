-- Create availability_blocks table for internal bookings and blocking
CREATE TABLE public.availability_blocks (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('internal_admin', 'blackout', 'system')),
  booking_id UUID NULL REFERENCES public.bookings(id) ON DELETE SET NULL,
  block_type TEXT NOT NULL CHECK (block_type IN ('daily', 'hourly')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  start_time TIME NULL,
  end_time TIME NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Constraints
  CONSTRAINT daily_block_no_times CHECK (
    block_type != 'daily' OR (start_time IS NULL AND end_time IS NULL)
  ),
  CONSTRAINT hourly_block_has_times CHECK (
    block_type != 'hourly' OR (start_time IS NOT NULL AND end_time IS NOT NULL)
  ),
  CONSTRAINT hourly_block_same_day CHECK (
    block_type != 'hourly' OR start_date = end_date
  ),
  CONSTRAINT end_date_after_start CHECK (end_date >= start_date)
);

-- Create indexes for performance
CREATE INDEX idx_availability_blocks_dates ON public.availability_blocks(start_date, end_date);
CREATE INDEX idx_availability_blocks_booking ON public.availability_blocks(booking_id);
CREATE INDEX idx_availability_blocks_source ON public.availability_blocks(source);

-- Enable RLS
ALTER TABLE public.availability_blocks ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Admin and staff can manage availability_blocks"
ON public.availability_blocks
FOR ALL
USING (is_admin_or_staff(auth.uid()));

CREATE POLICY "Everyone can view availability_blocks for availability checks"
ON public.availability_blocks
FOR SELECT
USING (true);

-- Add comment
COMMENT ON TABLE public.availability_blocks IS 'Stores time blocks for internal bookings, blackouts, and system reservations';