-- Migration: Add support for internal booking 1-day reminders
-- This enables tracking reminders sent for each availability_block occurrence

-- Create table to track reminders sent for availability blocks
CREATE TABLE IF NOT EXISTS public.availability_block_reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  block_id UUID NOT NULL REFERENCES public.availability_blocks(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reminder_type TEXT NOT NULL, -- '1d_before', future: '2h_before', etc.
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  channel TEXT, -- 'email', 'sms', 'ghl'
  status TEXT NOT NULL DEFAULT 'sent', -- 'sent', 'failed', 'pending'
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Prevent duplicate reminders for same block + type
  UNIQUE(block_id, reminder_type)
);

-- Indexes for performance
CREATE INDEX idx_block_reminders_block_id ON public.availability_block_reminders(block_id);
CREATE INDEX idx_block_reminders_booking_id ON public.availability_block_reminders(booking_id);
CREATE INDEX idx_block_reminders_sent_at ON public.availability_block_reminders(sent_at);
CREATE INDEX idx_block_reminders_status ON public.availability_block_reminders(status);
CREATE INDEX idx_block_reminders_reminder_type ON public.availability_block_reminders(reminder_type);

-- Updated_at trigger
CREATE TRIGGER set_availability_block_reminders_updated_at
  BEFORE UPDATE ON public.availability_block_reminders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

-- RLS policies
ALTER TABLE public.availability_block_reminders ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admin users can do everything with block reminders"
  ON public.availability_block_reminders
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid() AND role = 'admin'
    )
  );

-- Staff can view their assigned booking reminders
CREATE POLICY "Staff can view reminders for their bookings"
  ON public.availability_block_reminders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.booking_staff_assignments bsa
      WHERE bsa.booking_id = availability_block_reminders.booking_id
        AND bsa.staff_id IN (
          SELECT id FROM public.staff WHERE user_id = auth.uid()
        )
    )
  );

-- Service role (edge functions) full access
CREATE POLICY "Service role full access to block reminders"
  ON public.availability_block_reminders
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Add comment for documentation
COMMENT ON TABLE public.availability_block_reminders IS 
  'Tracks reminders sent for individual availability block occurrences. ' ||
  'Used for internal bookings that have recurring blocks.';

COMMENT ON COLUMN public.availability_block_reminders.reminder_type IS 
  'Type of reminder: 1d_before = 1 day before event';

COMMENT ON COLUMN public.availability_block_reminders.channel IS 
  'Delivery channel: email, sms, ghl (GoHighLevel)';
