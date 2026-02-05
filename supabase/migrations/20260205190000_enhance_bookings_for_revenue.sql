-- =====================================================
-- ENHANCE BOOKINGS TABLE FOR PRECISE REVENUE TRACKING
-- =====================================================
-- Add fields to bookings table to support detailed revenue tracking
-- without relying on inference from aggregated amounts
-- =====================================================

-- Add cleaning_type field
ALTER TABLE public.bookings
  ADD COLUMN cleaning_type text;

-- Add constraint for valid cleaning types
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_cleaning_type_check 
  CHECK (cleaning_type IN ('touch_up', 'regular', 'deep') OR cleaning_type IS NULL);

-- Add celebration_surcharge field
ALTER TABLE public.bookings
  ADD COLUMN celebration_surcharge decimal(10,2) DEFAULT 0;

-- Add addons_detail for structured add-on tracking
ALTER TABLE public.bookings
  ADD COLUMN addons_detail jsonb DEFAULT '[]'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN public.bookings.cleaning_type IS 
  'Type of cleaning: touch_up ($40), regular ($80), deep ($150). Set by admin during booking creation.';

COMMENT ON COLUMN public.bookings.celebration_surcharge IS 
  'Celebration surcharge amount ($20-$70 based on guest count). Entered manually by admin.';

COMMENT ON COLUMN public.bookings.addons_detail IS 
  'Structured array of add-ons: [{"type": "tablecloth", "quantity": 10, "amount": 50}, ...]. Auto-populated from add-on selections.';

-- Log the migration
DO $$
BEGIN
  RAISE NOTICE '[REVENUE-ENHANCE] Added cleaning_type, celebration_surcharge, addons_detail to bookings table';
  RAISE NOTICE '[REVENUE-ENHANCE] These fields enable precise revenue tracking without inference';
END $$;
